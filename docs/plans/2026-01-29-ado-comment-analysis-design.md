# ADO Comment Analysis Feature Design

## Overview

Add an "Analyze" button to the ADO Comments Panel that sends active comments to an AI agent for recommendations. Comments are enriched with actionable UI for fixes, replies, and clarifications.

## Requirements

1. **Analyze Button**: Header button analyzes all active ADO comments not yet analyzed
2. **Three Recommendation Types**:
   - **Fix**: Valid issue requiring code changes - shows suggested fix + "Apply Fix" button
   - **Reply**: Comment needs acknowledgment/response - shows draft reply + "Post to ADO"
   - **Clarify**: Comment is unclear or disagreed with - shows clarifying question + "Post to ADO"
3. **Persistence**: Analysis persisted to disk, survives restarts, with refresh option per comment
4. **Integration**: Fix recommendations flow through existing Apply Changes queue

---

## Data Model

**New Types** (in `src/shared/types.ts`):

```typescript
type AnalysisRecommendation = 'fix' | 'reply' | 'clarify';

interface CommentAnalysis {
  threadId: number;                    // ADO thread ID
  recommendation: AnalysisRecommendation;
  reasoning: string;                   // Why this recommendation

  // For 'fix' recommendations
  fixDescription?: string;             // What needs to be fixed
  suggestedCode?: string;              // Code snippet showing fix

  // For 'reply' and 'clarify' recommendations
  suggestedMessage?: string;           // Draft reply/question

  analyzedAt: string;                  // ISO timestamp
  analyzedBy: string;                  // Provider used (claude-sdk, etc.)
}

interface PRCommentAnalyses {
  prId: number;
  organization: string;
  project: string;
  analyses: CommentAnalysis[];
  lastUpdated: string;
}
```

**Storage Location**: `{appDataPath}/reviews/{org}/{project}/{prId}/comment-analyses.json`

---

## Service Layer

**New Service**: `src/main/ai/comment-analysis-service.ts`

```typescript
class CommentAnalysisService {
  // Load/save analyses for a PR
  loadAnalyses(prId: number, org: string, project: string): PRCommentAnalyses
  saveAnalyses(analyses: PRCommentAnalyses): void

  // Core analysis
  analyzeComments(
    threads: CommentThread[],
    context: { prId: number; org: string; project: string; repoPath: string },
    provider: AIProviderType,
    onProgress: (status: string) => void
  ): Promise<CommentAnalysis[]>

  // Single comment re-analysis (refresh)
  reanalyzeComment(threadId: number, ...): Promise<CommentAnalysis>

  // Clear analysis for a thread
  clearAnalysis(prId: number, threadId: number): void
}
```

**Integration with ReviewExecutorService**:
- Reuses existing executor factory to get the appropriate AI provider
- Builds prompt with file content, comment text, and analysis instructions
- Parses structured JSON response into `CommentAnalysis` objects

**IPC Bridge** (new methods):
- `analyzeAdoComments(threadIds: number[])` - Trigger analysis
- `getCommentAnalyses(prId: number)` - Load persisted analyses
- `reanalyzeComment(threadId: number)` - Refresh single analysis
- `postAdoReply(threadId: number, content: string)` - Post reply/clarify to ADO
- `onCommentAnalysisProgress(callback)` - Progress events

---

## UI Changes

### CommentsPanel Header

- **Analyze Button**: "Analyze (N)" where N = unanalyzed active comments
- Disabled when no comments to analyze or analysis in progress
- Shows spinner during analysis

### Inline Analysis Section (per thread)

**For Fix Recommendations**:
```
┌─────────────────────────────────────────────────┐
│ 💡 Recommendation: FIX                    [↻]   │
│ ─────────────────────────────────────────────── │
│ The null check is missing before accessing...   │
│                                                 │
│ Suggested fix:                                  │
│ ┌─────────────────────────────────────────────┐ │
│ │ if (user && user.name) {                    │ │
│ │   console.log(user.name);                   │ │
│ │ }                                           │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ [Apply Fix]  Additional instructions: [____]   │
└─────────────────────────────────────────────────┘
```

**For Reply/Clarify Recommendations**:
```
┌─────────────────────────────────────────────────┐
│ 💬 Recommendation: REPLY                  [↻]   │
│ ─────────────────────────────────────────────── │
│ This comment requests a style change...         │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ Good point! I've updated the variable...    │ │
│ └─────────────────────────────────────────────┘ │
│ [Edit] [Post to ADO]                            │
└─────────────────────────────────────────────────┘
```

- **Refresh Button** `[↻]`: Re-analyze individual comment
- **Edit Mode**: Textarea becomes editable, buttons change to `[Cancel] [Post to ADO]`

---

## Apply Fix Flow

When user clicks "Apply Fix":

1. Build enriched prompt combining:
   - Original reviewer comment text
   - AI analysis reasoning
   - Suggested code fix

2. Queue item created:
```typescript
{
  source: 'ado',
  sourceId: threadId.toString(),
  filePath: thread.threadContext.filePath,
  lineNumber: thread.threadContext.rightFileStart.line,
  commentContent: buildFixPrompt(thread, analysis),
  customMessage: userAdditionalInstructions
}
```

3. Existing `ApplyChangesService` processes the queue
4. On success: `FixTrackerService` marks thread as fixed
5. UI shows "Fixed" badge (existing behavior)

No changes needed to `ApplyChangesService` - we provide richer `commentContent`.

---

## Reply/Clarify Posting Flow

**Edit Mode**:
- Click "Edit" → textarea becomes editable
- Buttons change to: `[Cancel] [Post to ADO]`
- Escape key cancels, preserves original suggestion

**Posting**:
```typescript
// In ado-service.ts
async postThreadReply(threadId: number, content: string, prId: number): Promise<Comment>
```

**Flow**:
1. User clicks "Post to ADO"
2. IPC call to `postThreadReply()`
3. ADO API creates reply comment
4. Success: Collapse analysis, show "Replied ✓" indicator
5. Thread refreshes to show new reply

**Error Handling**:
- Show inline error if post fails
- Keep textarea content (don't lose edits)
- Retry button appears

---

## AI Prompt Structure

```markdown
# Analyze PR Review Comments

You are analyzing review comments on a pull request. For each comment, provide a recommendation.

## Context
- Repository: {repoPath}
- PR: #{prId}

## Comments to Analyze

### Comment Thread #{threadId}
**File**: {filePath}:{lineNumber}
**Reviewer**: {authorName}
**Status**: {threadStatus}

**Comment**:
{commentContent}

**Code Context** (lines {startLine}-{endLine}):
```{language}
{codeSnippet}
```

---

## Instructions

For each comment, respond with JSON:
```json
{
  "threadId": 123,
  "recommendation": "fix" | "reply" | "clarify",
  "reasoning": "Brief explanation of why this recommendation",
  "fixDescription": "What needs to be fixed (if fix)",
  "suggestedCode": "Code snippet (if fix)",
  "suggestedMessage": "Draft reply text (if reply/clarify)"
}
```

**Recommendation Guidelines**:
- **fix**: Comment identifies a valid issue that should be addressed in code
- **reply**: Comment is resolved, asks a question, or needs acknowledgment
- **clarify**: Comment is unclear, you disagree, or need more context
```

---

## Files to Create/Modify

### New Files
- `src/main/ai/comment-analysis-service.ts` - Core analysis service
- `src/shared/analysis-types.ts` - Type definitions (or add to types.ts)
- `src/renderer/styles/comment-analysis.css` - Analysis section styles

### Modified Files
- `src/shared/types.ts` - Add analysis types
- `src/main/main.ts` - Register IPC handlers
- `src/preload/preload.ts` - Expose IPC methods
- `src/renderer/components/comments-panel.ts` - Add Analyze button and inline UI
- `src/main/ado/ado-service.ts` - Add postThreadReply method

---

## Implementation Order

1. Add types to `src/shared/types.ts`
2. Create `CommentAnalysisService` with persistence
3. Add IPC bridge methods
4. Add "Analyze" button to CommentsPanel header
5. Implement inline analysis rendering
6. Wire up Apply Fix to existing queue
7. Implement Reply/Clarify edit and post flow
8. Add CSS styles
9. Test end-to-end flow
