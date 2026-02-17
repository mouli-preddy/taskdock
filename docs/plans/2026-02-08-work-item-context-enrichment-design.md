# Work Item Context Enrichment for AI Reviews

## Problem

AI review executors currently lack visibility into the work items linked to a PR. Without acceptance criteria, related items, and team discussion context, reviews can only evaluate code quality in isolation — they can't verify whether the PR actually delivers what was specified.

## Solution

When a PR context is created, fetch linked work items from ADO and write `context/work-items.json` alongside the existing `pr.json`, `files.json`, and `comments.json`. The review prompt references this file so AI executors can use requirements, acceptance criteria, and team decisions to inform their reviews.

## Data Flow

```
PR opened in TaskDock
  │
  ├─ [existing] Fetch PR metadata → context/pr.json
  ├─ [existing] Fetch comment threads → context/comments.json
  ├─ [existing] Fetch file contents → original/, modified/, diffs/
  │
  └─ [NEW] Fetch linked work items:
       1. GET /pullRequests/{prId}/workitems → work item IDs
       2. GET /wit/workitems?ids=... → full details + relations
       3. GET /wit/workitems/{id}/comments → discussion per item
       4. Batch-resolve relation titles
       5. Write → context/work-items.json
```

Work item fetching is **best-effort** — if it fails (permissions, network, etc.), log a warning and continue. The review still works without work item context.

## Context Directory Structure

```
{contextPath}/context/
├── pr.json              # existing — PR metadata
├── files.json           # existing — changed files manifest
├── comments.json        # existing — ADO comment threads
└── work-items.json      # NEW — linked work item data
```

## work-items.json Schema

```json
{
  "fetchedAt": "2026-02-08T10:30:00Z",
  "workItems": [
    {
      "id": 1234,
      "type": "User Story",
      "title": "As a user I want to...",
      "state": "Active",
      "priority": 2,
      "assignedTo": "Jane Doe",
      "description": "Full HTML description from System.Description",
      "acceptanceCriteria": "Content from Microsoft.VSTS.Common.AcceptanceCriteria",
      "tags": "api, backend",
      "areaPath": "Project\\Team",
      "iterationPath": "Project\\Sprint 5",
      "relations": [
        {
          "type": "Parent",
          "id": 1200,
          "title": "Feature: Authentication redesign"
        },
        {
          "type": "Child",
          "id": 1235,
          "title": "Task: Add unit tests"
        },
        {
          "type": "Related",
          "id": 999,
          "title": "Bug: Login timeout"
        }
      ],
      "comments": [
        {
          "author": "John Smith",
          "date": "2026-02-07T15:00:00Z",
          "text": "Make sure we handle the edge case where..."
        }
      ]
    }
  ]
}
```

### Field Notes

- **acceptanceCriteria**: Extracted from `Microsoft.VSTS.Common.AcceptanceCriteria` — the most valuable signal for AI reviewers to verify PR delivers what was specified
- **relations**: Flattened to `{type, id, title}` — enough context without fetching the entire graph. Type names resolved via `RELATION_TYPE_NAMES` map
- **comments**: Plain text from work item discussion — captures team decisions and edge cases
- **description**: Kept as HTML — AI models handle HTML fine and it preserves formatting

## Implementation Changes

### 1. `src/main/ado-api.ts` — New API method

Add `getPullRequestWorkItemRefs(org, project, repoId, prId)`:
- Calls `GET /{org}/{project}/_apis/git/repositories/{repoId}/pullRequests/{prId}/workitems`
- Returns `number[]` of linked work item IDs

### 2. `src/main/ai/review-context-service.ts` — Fetch and write work items

Both `ensurePRContext` and `ensurePRContextWithFetch` get an optional work item fetcher callback:

```typescript
workItemFetcher?: {
  getLinkedWorkItemIds: (prId: number) => Promise<number[]>;
  getWorkItems: (ids: number[]) => Promise<WorkItem[]>;
  getWorkItemComments: (id: number) => Promise<WorkItemComment[]>;
}
```

After writing the existing context files, call the fetcher and write `context/work-items.json`. Wrapped in try/catch — failure is non-fatal.

### 3. `src/main/terminal/review-prompt.ts` — Reference new file

In the context section (both inline and file-path variants), add:
```
- Work items: ${contextPath}/context/work-items.json (linked requirements, acceptance criteria, and team discussion)
```

Update task instructions to include: "Read work-items.json to understand requirements and acceptance criteria."

### 4. Caller changes

`ai-review-service.ts` and `walkthrough-service.ts` already have access to the ADO client. Pass a work item fetcher callback when calling context creation methods.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No linked work items | Write `{ fetchedAt, workItems: [] }` — AI sees empty list |
| Token lacks WI permissions | Log warning, skip work items — review continues |
| Cross-project relations | Skip — resolving cross-project work items needs different API scope |
| Large descriptions | No truncation — file is on disk, not inlined in prompt |
| Context reuse | Cached with context — reused if `lastCommitId` matches |
| Context refresh | Re-fetched when PR is updated (new commits) |

## Cache Invalidation

Bump `CONTEXT_VERSION` to force re-creation of all contexts on first deploy. After that, the existing `lastCommitId` check handles staleness.

## Files Changed

| File | Change |
|------|--------|
| `src/main/ado-api.ts` | Add `getPullRequestWorkItemRefs()` |
| `src/main/ai/review-context-service.ts` | Add work item fetching + writing |
| `src/main/terminal/review-prompt.ts` | Reference `work-items.json` in prompts |
| `src/main/ai/ai-review-service.ts` | Pass work item fetcher to context service |
| `src/main/ai/walkthrough-service.ts` | Pass work item fetcher to context service |
