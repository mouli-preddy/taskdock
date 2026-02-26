import { escapeHtml } from '../utils/html-utils.js';
import { Sparkles, ChevronDown, ChevronRight, ArrowLeft } from '../utils/icons.js';
import { iconHtml } from '../utils/icons.js';
import { marked } from 'marked';
import type { DGrepAISummary, DGrepPatternTrend } from '../../shared/dgrep-ai-types.js';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#f85149',
  error: '#f85149',
  warning: '#e5a100',
  info: '#58a6ff',
};

const TREND_ARROWS: Record<string, string> = {
  increasing: '\u2191',
  decreasing: '\u2193',
  stable: '\u2192',
  periodic: '\u223F',
  stopped: '\u2717',
};

export class DGrepAISummaryPanel {
  private container: HTMLElement;
  private el: HTMLElement;
  private visible = false;
  private collapsed = false;
  private loading = false;
  private progressLines: string[] = [];
  private cachedSummary: DGrepAISummary | null = null;
  private cachedSessionId: string | null = null;
  private contentHeight = 300;
  private detailView = false;
  private issueFilterSeverities: Set<string> = new Set(['critical', 'error']);
  private selectedLevel: 'quick' | 'standard' | 'detailed' | 'custom' = 'standard';
  private selectedCustomPrompt = '';

  onSummarize: ((columns: string[], rows: any[], patterns?: string[]) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.container = parent;
    this.el = document.createElement('div');
    this.el.className = 'dgrep-ai-summary';
    this.el.style.display = 'none';
    this.container.appendChild(this.el);
    this.render();
  }

  show() {
    this.visible = true;
    this.el.style.display = '';
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  summarize(columns: string[], rows: any[], patterns?: string[]) {
    if (this.loading) return;
    this.loading = true;
    this.progressLines = [];
    this.cachedSummary = null;
    this.collapsed = false;
    this.detailView = false;
    this.show();
    this.renderLoading();
    if (this.onSummarize) {
      this.onSummarize(columns, rows, patterns);
    }
  }

  handleSummaryProgress(text: string) {
    if (!text) return;
    // Streaming deltas arrive as individual tokens (words/fragments).
    // Accumulate into the current line; only start a new line on newlines or tool-use markers.
    const isToolUse = text.startsWith('[');
    if (isToolUse) {
      this.progressLines.push(text.trim());
    } else if (text.includes('\n')) {
      const parts = text.split('\n');
      // Append first part to current line
      if (this.progressLines.length > 0 && !this.progressLines[this.progressLines.length - 1].startsWith('[')) {
        this.progressLines[this.progressLines.length - 1] += parts[0];
      } else if (parts[0].trim()) {
        this.progressLines.push(parts[0]);
      }
      // Remaining parts become new lines
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part) this.progressLines.push(part);
      }
    } else {
      // Append to last non-tool line, or start a new one
      if (this.progressLines.length > 0 && !this.progressLines[this.progressLines.length - 1].startsWith('[')) {
        this.progressLines[this.progressLines.length - 1] += text;
      } else {
        this.progressLines.push(text);
      }
    }
    if (this.progressLines.length > 50) {
      this.progressLines = this.progressLines.slice(-50);
    }
    this.updateProgressDisplay();
  }

  handleSummaryComplete(summary: DGrepAISummary) {
    this.loading = false;
    this.cachedSummary = summary;
    this.detailView = false;
    this.renderComplete(summary);
  }

  handleSummaryError(error: string) {
    this.loading = false;
    const content = this.el.querySelector('.dgrep-ai-summary-content') as HTMLElement;
    if (content) {
      content.innerHTML = `<div class="dgrep-ai-summary-error">Error: ${escapeHtml(error)}</div>`;
    }
  }

  setSessionId(sessionId: string) {
    if (sessionId !== this.cachedSessionId) {
      this.cachedSummary = null;
      this.cachedSessionId = sessionId;
    }
  }

  getCachedSummary(): DGrepAISummary | null {
    return this.cachedSummary;
  }

  private render() {
    this.el.innerHTML = `
      <div class="dgrep-ai-summary-resize"></div>
      <div class="dgrep-ai-summary-header">
        <div class="dgrep-ai-summary-header-left">
          <button class="btn btn-ghost btn-xs dgrep-ai-summary-toggle">
            ${iconHtml(ChevronDown, { size: 14 })}
          </button>
          <span class="dgrep-ai-summary-title">
            ${iconHtml(Sparkles, { size: 14 })} AI Summary
          </span>
        </div>
        <div class="dgrep-ai-summary-header-right">
          <select class="dgrep-ai-analysis-level">
            <option value="quick">Quick (3-5)</option>
            <option value="standard">Standard (5-10)</option>
            <option value="detailed">Detailed (all)</option>
            <option value="custom">Custom...</option>
          </select>
          <button class="btn btn-xs btn-primary dgrep-ai-summarize-btn">
            ${iconHtml(Sparkles, { size: 12 })} Summarize
          </button>
        </div>
      </div>
      <div class="dgrep-ai-custom-prompt" style="display:none;">
        <input type="text" class="dgrep-ai-custom-prompt-input" placeholder="Focus on... (e.g. timeout errors, meeting join failures)" />
      </div>
      <div class="dgrep-ai-summary-content" style="max-height:${this.contentHeight}px">
        <div class="dgrep-ai-summary-empty">Click "Summarize" to analyze the current log results with AI.</div>
      </div>
    `;
    this.attachListeners();
  }

  private attachListeners() {
    const toggleBtn = this.el.querySelector('.dgrep-ai-summary-toggle');
    toggleBtn?.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.updateCollapsed();
    });

    const header = this.el.querySelector('.dgrep-ai-summary-header');
    header?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.dgrep-ai-summarize-btn') || target.closest('.dgrep-ai-analysis-level')) return;
      this.collapsed = !this.collapsed;
      this.updateCollapsed();
    });

    const summarizeBtn = this.el.querySelector('.dgrep-ai-summarize-btn');
    summarizeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.el.dispatchEvent(new CustomEvent('request-summarize', { bubbles: true }));
    });

    // Analysis level dropdown — store value immediately on change
    const levelSelect = this.el.querySelector('.dgrep-ai-analysis-level') as HTMLSelectElement;
    if (levelSelect) levelSelect.value = this.selectedLevel; // set DOM property, no HTML attribute
    const customPromptEl = this.el.querySelector('.dgrep-ai-custom-prompt') as HTMLElement;
    levelSelect?.addEventListener('change', () => {
      this.selectedLevel = (levelSelect.value || 'standard') as 'quick' | 'standard' | 'detailed' | 'custom';
      if (customPromptEl) {
        customPromptEl.style.display = this.selectedLevel === 'custom' ? '' : 'none';
      }
    });

    // Resize handle
    const resizeHandle = this.el.querySelector('.dgrep-ai-summary-resize') as HTMLElement;
    if (resizeHandle) {
      let startY = 0;
      let startHeight = 0;
      const onMouseMove = (e: MouseEvent) => {
        const delta = startY - e.clientY;
        this.contentHeight = Math.max(100, Math.min(800, startHeight + delta));
        const content = this.el.querySelector('.dgrep-ai-summary-content') as HTMLElement;
        if (content) content.style.maxHeight = `${this.contentHeight}px`;
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startY = e.clientY;
        startHeight = this.contentHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    }
  }

  getAnalysisLevel(): { level: 'quick' | 'standard' | 'detailed' | 'custom'; customPrompt?: string } {
    if (this.selectedLevel === 'custom') {
      const input = this.el.querySelector('.dgrep-ai-custom-prompt-input') as HTMLInputElement;
      return { level: 'custom', customPrompt: input?.value || this.selectedCustomPrompt || '' };
    }
    return { level: this.selectedLevel };
  }

  private updateCollapsed() {
    const content = this.el.querySelector('.dgrep-ai-summary-content') as HTMLElement;
    const customPrompt = this.el.querySelector('.dgrep-ai-custom-prompt') as HTMLElement;
    const toggleBtn = this.el.querySelector('.dgrep-ai-summary-toggle');
    if (content) content.style.display = this.collapsed ? 'none' : '';
    if (customPrompt && this.collapsed) customPrompt.style.display = 'none';
    if (toggleBtn) {
      toggleBtn.innerHTML = this.collapsed
        ? iconHtml(ChevronRight, { size: 14 })
        : iconHtml(ChevronDown, { size: 14 });
    }
  }

  private renderLoading() {
    const content = this.el.querySelector('.dgrep-ai-summary-content') as HTMLElement;
    if (!content) return;
    content.innerHTML = `<div class="dgrep-ai-summary-progress"></div>`;
  }

  private updateProgressDisplay() {
    const loadingEl = this.el.querySelector('.dgrep-ai-loading');
    if (loadingEl) loadingEl.remove();

    let progressEl = this.el.querySelector('.dgrep-ai-summary-progress') as HTMLElement;
    if (!progressEl) {
      const content = this.el.querySelector('.dgrep-ai-summary-content') as HTMLElement;
      if (!content) return;
      progressEl = document.createElement('div');
      progressEl.className = 'dgrep-ai-summary-progress';
      content.appendChild(progressEl);
    }
    progressEl.innerHTML = this.progressLines
      .map(line => {
        const isToolUse = line.startsWith('[');
        const cls = isToolUse ? 'dgrep-ai-progress-line dgrep-ai-progress-tool' : 'dgrep-ai-progress-line';
        return `<div class="${cls}">${escapeHtml(line.substring(0, 500))}</div>`;
      })
      .join('');
    progressEl.scrollTop = progressEl.scrollHeight;
  }

  private renderComplete(summary: DGrepAISummary) {
    const content = this.el.querySelector('.dgrep-ai-summary-content') as HTMLElement;
    if (!content) return;

    let html = '';

    // Issues list with severity filter pills
    const issues = summary.issues;
    if (issues && issues.length > 0) {
      // Count by severity
      const sevCounts: Record<string, number> = {};
      for (const issue of issues) {
        sevCounts[issue.severity] = (sevCounts[issue.severity] || 0) + 1;
      }

      // Sort: by severity order (critical > error > warning > info), then by occurrences desc
      const sevOrder: Record<string, number> = { critical: 0, error: 1, warning: 2, info: 3 };
      const sorted = [...issues].sort((a, b) => {
        const sevDiff = (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9);
        if (sevDiff !== 0) return sevDiff;
        return b.occurrences - a.occurrences;
      });

      // Filter pills
      const allSevs = ['critical', 'error', 'warning', 'info'];
      html += '<div class="dgrep-ai-issues-section">';
      html += '<div class="dgrep-ai-issues-header">';
      html += '<span class="dgrep-ai-summary-bar-label">Issues Found</span>';
      html += '<div class="dgrep-ai-issue-filters">';
      for (const sev of allSevs) {
        const count = sevCounts[sev] || 0;
        if (count === 0) continue;
        const active = this.issueFilterSeverities.has(sev);
        const color = SEVERITY_COLORS[sev] || '#6e7681';
        html += `<button class="dgrep-ai-issue-filter-pill${active ? ' active' : ''}" data-severity="${sev}" style="--pill-color:${color}">
          ${sev} (${count})
        </button>`;
      }
      html += '</div></div>';

      // Filtered issue rows
      const filtered = sorted.filter(i => this.issueFilterSeverities.has(i.severity));
      for (const issue of filtered) {
        const color = SEVERITY_COLORS[issue.severity] || '#6e7681';
        html += `<div class="dgrep-ai-issue-row" data-issue-path="${escapeHtml(issue.detailedAnalysisPath || '')}">
          <div class="dgrep-ai-issue-header">
            <span class="dgrep-ai-issue-severity" style="background:${color}">${issue.severity.toUpperCase()}</span>
            <span class="dgrep-ai-issue-title">${escapeHtml(issue.title)}</span>
            <span class="dgrep-ai-issue-count">${issue.occurrences} occurrence${issue.occurrences !== 1 ? 's' : ''}</span>
          </div>
          <div class="dgrep-ai-issue-cause">${escapeHtml(issue.briefRootCause)}</div>
          ${issue.detailedAnalysisPath ? '<button class="btn btn-ghost btn-xs dgrep-ai-issue-details-btn">View Details</button>' : ''}
        </div>`;
      }
      if (filtered.length === 0) {
        html += '<div class="dgrep-ai-summary-empty">No issues match the selected filters.</div>';
      }
      html += '</div>';
    }

    // Error breakdown bar
    if (summary.errorBreakdown && summary.errorBreakdown.length > 0) {
      html += this.renderErrorBreakdown(summary.errorBreakdown);
    }

    // Top patterns
    if (summary.topPatterns && summary.topPatterns.length > 0) {
      html += this.renderTopPatterns(summary.topPatterns);
    }

    // Narrative
    if (summary.narrative) {
      html += `<div class="dgrep-ai-summary-narrative">${this.renderMarkdown(summary.narrative)}</div>`;
    }

    // Recommendations
    const recommendations = (summary as any).recommendations;
    if (recommendations && Array.isArray(recommendations) && recommendations.length > 0) {
      html += '<div class="dgrep-ai-summary-recommendations">';
      html += '<div class="dgrep-ai-summary-bar-label">Recommendations</div>';
      html += '<ul>';
      for (const rec of recommendations) {
        html += `<li>${escapeHtml(rec)}</li>`;
      }
      html += '</ul></div>';
    }

    // Stats footer
    html += `<div class="dgrep-ai-summary-stats">
      Analyzed ${(summary.totalRowsAnalyzed || 0).toLocaleString()} rows
      ${summary.timeRange ? ` | ${summary.timeRange.start} - ${summary.timeRange.end}` : ''}
    </div>`;

    content.innerHTML = html;
    this.attachIssueDetailListeners();
  }

  private attachIssueDetailListeners() {
    // Detail view buttons
    this.el.querySelectorAll('.dgrep-ai-issue-details-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const row = (btn as HTMLElement).closest('.dgrep-ai-issue-row') as HTMLElement;
        const filePath = row?.dataset.issuePath;
        if (!filePath) return;
        await this.showDetailView(filePath);
      });
    });

    // Severity filter pills
    this.el.querySelectorAll('.dgrep-ai-issue-filter-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        const sev = (pill as HTMLElement).dataset.severity;
        if (!sev) return;
        if (this.issueFilterSeverities.has(sev)) {
          this.issueFilterSeverities.delete(sev);
        } else {
          this.issueFilterSeverities.add(sev);
        }
        // Re-render with updated filters
        if (this.cachedSummary) this.renderComplete(this.cachedSummary);
      });
    });
  }

  private async showDetailView(filePath: string) {
    const content = this.el.querySelector('.dgrep-ai-summary-content') as HTMLElement;
    if (!content) return;

    content.innerHTML = `<div class="dgrep-ai-detail-loading">Loading analysis...</div>`;

    try {
      const mdContent = await (window as any).electronAPI?.dgrepAIReadFile?.(filePath);
      if (!mdContent) {
        content.innerHTML = `<div class="dgrep-ai-summary-error">Could not read file</div>`;
        return;
      }

      this.detailView = true;
      content.innerHTML = `
        <div class="dgrep-ai-detail-view">
          <button class="btn btn-ghost btn-xs dgrep-ai-detail-back">
            ${iconHtml(ArrowLeft, { size: 14 })} Back to Summary
          </button>
          <div class="dgrep-ai-detail-content">
            ${this.renderMarkdown(mdContent)}
          </div>
        </div>
      `;

      content.querySelector('.dgrep-ai-detail-back')?.addEventListener('click', () => {
        this.detailView = false;
        if (this.cachedSummary) this.renderComplete(this.cachedSummary);
      });
    } catch (err: any) {
      content.innerHTML = `<div class="dgrep-ai-summary-error">Error: ${escapeHtml(err?.message || 'Failed to load')}</div>`;
    }
  }

  private renderErrorBreakdown(breakdown: DGrepAISummary['errorBreakdown']): string {
    const total = breakdown.reduce((sum, b) => sum + b.count, 0);
    if (total === 0) return '';

    const barWidth = 400;
    let html = '<div class="dgrep-ai-summary-bar-section">';
    html += '<div class="dgrep-ai-summary-bar-label">Error Breakdown</div>';
    html += `<svg class="dgrep-ai-summary-bar" width="100%" height="24" viewBox="0 0 ${barWidth} 24">`;

    let x = 0;
    for (const item of breakdown) {
      const w = (item.count / total) * barWidth;
      const color = SEVERITY_COLORS[item.severity] || '#6e7681';
      html += `<rect x="${x}" y="2" width="${w}" height="20" rx="3" fill="${color}" opacity="0.85">
        <title>${escapeHtml(item.errorType)}: ${item.count} (${Math.round((item.count / total) * 100)}%)</title>
      </rect>`;
      x += w;
    }
    html += '</svg>';

    html += '<div class="dgrep-ai-summary-bar-legend">';
    for (const item of breakdown) {
      const pct = Math.round((item.count / total) * 100);
      const color = SEVERITY_COLORS[item.severity] || '#6e7681';
      html += `<span class="dgrep-ai-summary-legend-item">
        <span class="dgrep-ai-summary-legend-dot" style="background:${color}"></span>
        ${escapeHtml(item.errorType)} (${pct}%)
      </span>`;
    }
    html += '</div></div>';

    return html;
  }

  private renderTopPatterns(patterns: DGrepPatternTrend[]): string {
    const top5 = patterns.slice(0, 5);
    let html = '<div class="dgrep-ai-summary-patterns">';
    html += '<div class="dgrep-ai-summary-patterns-label">Top Patterns</div>';

    for (const p of top5) {
      const arrow = TREND_ARROWS[p.trend] || '';
      const trendClass = p.trend === 'increasing' ? 'trend-up' : p.trend === 'decreasing' ? 'trend-down' : 'trend-stable';
      html += `<div class="dgrep-ai-summary-pattern-row">
        <span class="dgrep-ai-summary-pattern-count">${p.count.toLocaleString()}</span>
        <span class="dgrep-ai-summary-pattern-text">${escapeHtml(p.pattern)}</span>
        <span class="dgrep-ai-summary-pattern-trend ${trendClass}">${arrow} ${p.trend}</span>
        <span class="dgrep-ai-summary-pattern-pct">${p.percentage.toFixed(1)}%</span>
      </div>`;
    }
    html += '</div>';
    return html;
  }

  private renderMarkdown(text: string): string {
    try {
      return marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
    } catch {
      return escapeHtml(text);
    }
  }
}
