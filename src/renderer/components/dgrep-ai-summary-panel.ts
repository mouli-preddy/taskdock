import { escapeHtml } from '../utils/html-utils.js';
import { Sparkles, ChevronDown, ChevronRight, ArrowLeft } from '../utils/icons.js';
import { iconHtml } from '../utils/icons.js';
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
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      this.progressLines.push(line);
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
            <option value="standard" selected>Standard (5-10)</option>
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

    // Analysis level dropdown
    const levelSelect = this.el.querySelector('.dgrep-ai-analysis-level') as HTMLSelectElement;
    const customPromptEl = this.el.querySelector('.dgrep-ai-custom-prompt') as HTMLElement;
    levelSelect?.addEventListener('change', () => {
      if (customPromptEl) {
        customPromptEl.style.display = levelSelect.value === 'custom' ? '' : 'none';
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
    const select = this.el.querySelector('.dgrep-ai-analysis-level') as HTMLSelectElement;
    const level = (select?.value || 'standard') as 'quick' | 'standard' | 'detailed' | 'custom';
    if (level === 'custom') {
      const input = this.el.querySelector('.dgrep-ai-custom-prompt-input') as HTMLInputElement;
      return { level, customPrompt: input?.value || '' };
    }
    return { level };
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
    let html = escapeHtml(text);
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => `<pre><code>${code}</code></pre>`);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold/italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Lists
    html = html.replace(/^[\s]*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    // Paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = `<p>${html}</p>`;
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/(?<!>)\n(?!<)/g, '<br>');
    // Clean up headers inside paragraphs
    html = html.replace(/<p><(h[234])>/g, '<$1>');
    html = html.replace(/<\/(h[234])><\/p>/g, '</$1>');
    return html;
  }
}
