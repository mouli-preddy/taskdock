import { escapeHtml } from '../utils/html-utils.js';
import { BrainCircuit, X, Loader2 } from '../utils/icons.js';
import { iconHtml } from '../utils/icons.js';
import { marked } from 'marked';
import type { DGrepRootCauseAnalysis } from '../../shared/dgrep-ai-types.js';

const CONFIDENCE_LABELS: Record<string, { label: string; color: string }> = {
  high: { label: 'High Confidence', color: '#3fb950' },
  medium: { label: 'Medium Confidence', color: '#e5a100' },
  low: { label: 'Low Confidence', color: '#f85149' },
};

const RELEVANCE_COLORS: Record<string, string> = {
  direct: '#f85149',
  contributing: '#e5a100',
  context: '#6e7681',
};

export class DGrepRCAPanel {
  private container: HTMLElement;
  private el: HTMLElement;
  private visible = false;
  private loading = false;
  private progressSteps: string[] = [];

  onAnalyze: ((targetRow: any, contextRows: any[], columns: string[], searchParams?: any) => void) | null = null;
  onNavigateToRow: ((rowIndex: number) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.container = parent;
    this.el = document.createElement('div');
    this.el.className = 'dgrep-rca-panel';
    this.el.style.display = 'none';
    this.container.appendChild(this.el);
  }

  show() {
    this.visible = true;
    this.el.style.display = '';
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
    this.reset();
  }

  analyze(targetRow: any, contextRows: any[], columns: string[], searchParams?: any) {
    if (this.loading) return;
    this.reset();
    this.loading = true;
    this.show();
    this.renderLoading();
    if (this.onAnalyze) {
      this.onAnalyze(targetRow, contextRows, columns, searchParams);
    }
  }

  /** Agent progress text */
  handleRCAProgress(text: string) {
    if (!text) return;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      this.progressSteps.push(line);
    }
    if (this.progressSteps.length > 20) {
      this.progressSteps = this.progressSteps.slice(-20);
    }
    this.updateProgress();
  }

  /** Complete analysis arrived */
  handleRCAComplete(analysis: DGrepRootCauseAnalysis) {
    this.loading = false;
    this.renderComplete(analysis);
  }

  /** Handle error */
  handleRCAError(error: string) {
    this.loading = false;
    this.el.innerHTML = `
      <div class="dgrep-rca-header">
        <span class="dgrep-rca-title">${iconHtml(BrainCircuit, { size: 14 })} Root Cause Analysis</span>
        <button class="btn btn-ghost btn-xs dgrep-rca-close">${iconHtml(X, { size: 14 })}</button>
      </div>
      <div class="dgrep-rca-content">
        <div class="dgrep-rca-error">Error: ${escapeHtml(error)}</div>
      </div>
    `;
    this.attachCloseListener();
  }

  private reset() {
    this.loading = false;
    this.progressSteps = [];
  }

  private renderLoading() {
    this.el.innerHTML = `
      <div class="dgrep-rca-header">
        <span class="dgrep-rca-title">${iconHtml(BrainCircuit, { size: 14 })} Root Cause Analysis</span>
        <button class="btn btn-ghost btn-xs dgrep-rca-close">${iconHtml(X, { size: 14 })}</button>
      </div>
      <div class="dgrep-rca-content">
        <div class="dgrep-rca-progress"></div>
        <div class="dgrep-ai-loading">
          <span class="dgrep-ai-loading-dots">Analyzing error context</span>
        </div>
        <div class="dgrep-rca-narrative-area"></div>
      </div>
    `;
    this.attachCloseListener();
  }

  private attachCloseListener() {
    const closeBtn = this.el.querySelector('.dgrep-rca-close');
    closeBtn?.addEventListener('click', () => this.hide());
  }

  private updateProgress() {
    const progressEl = this.el.querySelector('.dgrep-rca-progress') as HTMLElement;
    if (!progressEl) return;

    progressEl.innerHTML = this.progressSteps.map(step =>
      `<div class="dgrep-rca-progress-step">
        ${iconHtml(Loader2, { size: 12, class: 'animate-spin' })}
        <span>${escapeHtml(step)}</span>
      </div>`
    ).join('');
  }

  private renderComplete(analysis: DGrepRootCauseAnalysis) {
    const confidenceLevel = analysis.confidence >= 0.7 ? 'high' : analysis.confidence >= 0.4 ? 'medium' : 'low';
    const conf = CONFIDENCE_LABELS[confidenceLevel];

    let html = `
      <div class="dgrep-rca-header">
        <span class="dgrep-rca-title">${iconHtml(BrainCircuit, { size: 14 })} Root Cause Analysis</span>
        <div class="dgrep-rca-header-right">
          <span class="dgrep-rca-confidence" style="color:${conf.color}">${conf.label} (${Math.round(analysis.confidence * 100)}%)</span>
          <span class="dgrep-rca-severity dgrep-rca-severity-${analysis.severity}">${analysis.severity.toUpperCase()}</span>
          <button class="btn btn-ghost btn-xs dgrep-rca-close">${iconHtml(X, { size: 14 })}</button>
        </div>
      </div>
      <div class="dgrep-rca-content">
    `;

    // Root cause narrative
    html += `<div class="dgrep-rca-narrative">${this.renderMarkdown(analysis.rootCause)}</div>`;

    // Evidence timeline
    if (analysis.evidenceTimeline && analysis.evidenceTimeline.length > 0) {
      html += '<div class="dgrep-rca-timeline-section">';
      html += '<div class="dgrep-rca-section-label">Evidence Timeline</div>';
      html += '<div class="dgrep-rca-timeline">';
      for (const ev of analysis.evidenceTimeline) {
        const dotColor = RELEVANCE_COLORS[ev.relevance] || '#6e7681';
        html += `<div class="dgrep-rca-evidence" data-row-index="${ev.rowIndex}">
          <div class="dgrep-rca-evidence-dot" style="background:${dotColor}"></div>
          <div class="dgrep-rca-evidence-content">
            <span class="dgrep-rca-evidence-time">${escapeHtml(ev.timestamp)}</span>
            <span class="dgrep-rca-evidence-desc">${escapeHtml(ev.description)}</span>
            <span class="dgrep-rca-evidence-relevance">${ev.relevance}</span>
          </div>
        </div>`;
      }
      html += '</div></div>';
    }

    // Linked rows
    if (analysis.linkedRows && analysis.linkedRows.length > 0) {
      html += '<div class="dgrep-rca-linked-section">';
      html += '<div class="dgrep-rca-section-label">Related Rows</div>';
      html += '<div class="dgrep-rca-linked-rows">';
      for (const idx of analysis.linkedRows) {
        html += `<button class="btn btn-ghost btn-xs dgrep-rca-linked-row" data-row-index="${idx}">Row #${idx}</button>`;
      }
      html += '</div></div>';
    }

    // Recommendation
    if (analysis.recommendation) {
      html += `<div class="dgrep-rca-recommendation-section">
        <div class="dgrep-rca-section-label">Recommendation</div>
        <div class="dgrep-rca-recommendation">${this.renderMarkdown(analysis.recommendation)}</div>
      </div>`;
    }

    // Code references (from agent with source repo access)
    const codeRefs = (analysis as any).codeReferences;
    if (codeRefs && Array.isArray(codeRefs) && codeRefs.length > 0) {
      html += '<div class="dgrep-rca-code-refs-section">';
      html += '<div class="dgrep-rca-section-label">Code References</div>';
      html += '<div class="dgrep-rca-code-refs">';
      for (const ref of codeRefs) {
        html += `<div class="dgrep-rca-code-ref"><code>${escapeHtml(String(ref))}</code></div>`;
      }
      html += '</div></div>';
    }

    // Additional findings
    if (analysis.additionalFindings) {
      html += `<div class="dgrep-rca-findings-section">
        <div class="dgrep-rca-section-label">Additional Findings</div>
        <div class="dgrep-rca-findings">${this.renderMarkdown(analysis.additionalFindings)}</div>
      </div>`;
    }

    html += '</div>';
    this.el.innerHTML = html;

    this.attachCloseListener();
    this.attachRowNavigation();
  }

  private attachRowNavigation() {
    // Evidence timeline rows
    this.el.querySelectorAll('.dgrep-rca-evidence[data-row-index]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt((el as HTMLElement).dataset.rowIndex || '-1', 10);
        if (idx >= 0 && this.onNavigateToRow) {
          this.onNavigateToRow(idx);
        }
      });
    });

    // Linked row buttons
    this.el.querySelectorAll('.dgrep-rca-linked-row[data-row-index]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt((el as HTMLElement).dataset.rowIndex || '-1', 10);
        if (idx >= 0 && this.onNavigateToRow) {
          this.onNavigateToRow(idx);
        }
      });
    });
  }

  private renderMarkdown(text: string): string {
    try {
      return marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
    } catch {
      return escapeHtml(text);
    }
  }
}
