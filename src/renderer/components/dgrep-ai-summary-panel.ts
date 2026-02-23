import { escapeHtml } from '../utils/html-utils.js';
import { Sparkles, ChevronDown, ChevronRight } from '../utils/icons.js';
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
    this.show();
    this.renderLoading();
    if (this.onSummarize) {
      this.onSummarize(columns, rows, patterns);
    }
  }

  /** Called by app.ts when agent progress text arrives */
  handleSummaryProgress(text: string) {
    if (!text) return;
    // Show the latest progress line from the agent
    const trimmed = text.trim();
    if (trimmed) {
      this.progressLines.push(trimmed);
      // Keep only last 5 lines
      if (this.progressLines.length > 5) {
        this.progressLines = this.progressLines.slice(-5);
      }
    }
    this.updateProgressDisplay();
  }

  /** Called when the full summary is ready */
  handleSummaryComplete(summary: DGrepAISummary) {
    this.loading = false;
    this.cachedSummary = summary;
    this.narrativeBuffer = summary.narrative;
    this.renderComplete(summary);
  }

  /** Called on error */
  handleSummaryError(error: string) {
    this.loading = false;
    const content = this.el.querySelector('.dgrep-ai-summary-content') as HTMLElement;
    if (content) {
      content.innerHTML = `<div class="dgrep-ai-summary-error">Error: ${escapeHtml(error)}</div>`;
    }
  }

  /** Cache the sessionId so we can skip re-summarizing */
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
      <div class="dgrep-ai-summary-header">
        <div class="dgrep-ai-summary-header-left">
          <button class="btn btn-ghost btn-xs dgrep-ai-summary-toggle">
            ${iconHtml(ChevronDown, { size: 14 })}
          </button>
          <span class="dgrep-ai-summary-title">
            ${iconHtml(Sparkles, { size: 14 })} AI Summary
          </span>
        </div>
        <button class="btn btn-xs btn-primary dgrep-ai-summarize-btn">
          ${iconHtml(Sparkles, { size: 12 })} Summarize
        </button>
      </div>
      <div class="dgrep-ai-summary-content">
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
      if ((e.target as HTMLElement).closest('.dgrep-ai-summarize-btn')) return;
      this.collapsed = !this.collapsed;
      this.updateCollapsed();
    });

    // The summarize button click is handled externally via onSummarize callback
    // It's triggered by the parent component that has access to columns/rows
    const summarizeBtn = this.el.querySelector('.dgrep-ai-summarize-btn');
    summarizeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      // The parent component should call summarize() with actual data
      // This button just serves as a visual trigger
      this.el.dispatchEvent(new CustomEvent('request-summarize', { bubbles: true }));
    });
  }

  private updateCollapsed() {
    const content = this.el.querySelector('.dgrep-ai-summary-content') as HTMLElement;
    const toggleBtn = this.el.querySelector('.dgrep-ai-summary-toggle');
    if (content) {
      content.style.display = this.collapsed ? 'none' : '';
    }
    if (toggleBtn) {
      toggleBtn.innerHTML = this.collapsed
        ? iconHtml(ChevronRight, { size: 14 })
        : iconHtml(ChevronDown, { size: 14 });
    }
  }

  private renderLoading() {
    const content = this.el.querySelector('.dgrep-ai-summary-content') as HTMLElement;
    if (!content) return;
    content.innerHTML = `
      <div class="dgrep-ai-loading">
        <span class="dgrep-ai-loading-dots">Analyzing logs</span>
      </div>
      <div class="dgrep-ai-summary-progress"></div>
    `;
  }

  private updateProgressDisplay() {
    let progressEl = this.el.querySelector('.dgrep-ai-summary-progress') as HTMLElement;
    if (!progressEl) {
      const content = this.el.querySelector('.dgrep-ai-summary-content') as HTMLElement;
      if (!content) return;
      progressEl = document.createElement('div');
      progressEl.className = 'dgrep-ai-summary-progress';
      content.appendChild(progressEl);
    }
    // Show scrolling status lines from the agent
    progressEl.innerHTML = this.progressLines
      .map(line => `<div class="dgrep-ai-progress-line">${escapeHtml(line.substring(0, 200))}</div>`)
      .join('');
    progressEl.scrollTop = progressEl.scrollHeight;
  }

  private renderComplete(summary: DGrepAISummary) {
    const content = this.el.querySelector('.dgrep-ai-summary-content') as HTMLElement;
    if (!content) return;

    let html = '';

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

    // Legend
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
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => `<pre><code>${code}</code></pre>`);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/^[\s]*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = `<p>${html}</p>`;
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/(?<!>)\n(?!<)/g, '<br>');
    return html;
  }
}
