/**
 * Walkthrough Renderer
 * Shared rendering logic for walkthrough overlay and popout window
 */

import type { CodeWalkthrough, WalkthroughStep } from '../../shared/ai-types.js';
import {
  renderMarkdown,
  renderDiagramToElement,
} from '../utils/markdown-renderer.js';
import { escapeHtml } from '../utils/html-utils.js';
import {
  iconHtml,
  FileText,
  LayoutGrid,
} from '../utils/icons.js';

/**
 * Render a walkthrough step as HTML (synchronous, markdown loaded async)
 */
export function renderStepHtml(step: WalkthroughStep): string {
  const fileName = step.filePath.split('/').pop() || step.filePath;

  return `
    <div class="walkthrough-step">
      <h3 class="walkthrough-step-title">${escapeHtml(step.title)}</h3>

      <div class="walkthrough-step-location"
           data-file="${step.filePath}"
           data-line="${step.startLine}">
        ${iconHtml(FileText, { size: 14 })}
        <span class="walkthrough-file">${fileName}</span>
        <span class="walkthrough-line">:${step.startLine}${step.endLine !== step.startLine ? `-${step.endLine}` : ''}</span>
      </div>

      <div class="walkthrough-step-description markdown-content" data-markdown="${encodeURIComponent(step.description)}">
        <div class="loading-markdown">Loading...</div>
      </div>

      ${step.diagram ? `
        <div class="walkthrough-step-diagram mermaid-diagram" data-diagram="${encodeURIComponent(step.diagram)}">
          <div class="loading-diagram">Loading diagram...</div>
        </div>
      ` : ''}

      ${step.relatedFiles && step.relatedFiles.length > 0 ? `
        <div class="walkthrough-related">
          <span class="walkthrough-related-label">Related files:</span>
          ${step.relatedFiles.map(f => `
            <span class="walkthrough-related-file" data-file="${f}">
              ${f.split('/').pop()}
            </span>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render the walkthrough summary page as HTML
 */
export function renderSummaryHtml(walkthrough: CodeWalkthrough): string {
  const hasArchDiagram = walkthrough.architectureDiagram;

  return `
    <div class="walkthrough-summary">
      <h3>Summary</h3>
      <div class="walkthrough-summary-text markdown-content" data-markdown="${encodeURIComponent(walkthrough.summary || '')}">
        <div class="loading-markdown">Loading...</div>
      </div>

      ${hasArchDiagram ? `
        <div class="walkthrough-architecture-diagram">
          <h4>
            ${iconHtml(LayoutGrid, { size: 16 })}
            Architecture Overview
          </h4>
          <div class="mermaid-diagram" data-diagram="${encodeURIComponent(walkthrough.architectureDiagram || '')}">
            <div class="loading-diagram">Loading diagram...</div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Async render markdown and mermaid content within a container element.
 * Call this after inserting HTML from renderStepHtml/renderSummaryHtml into the DOM.
 */
export async function renderMarkdownInContainer(container: HTMLElement): Promise<void> {
  // Render markdown content
  const markdownElements = container.querySelectorAll('.markdown-content[data-markdown]');
  for (const el of markdownElements) {
    const markdown = decodeURIComponent((el as HTMLElement).dataset.markdown || '');
    if (markdown) {
      try {
        const html = await renderMarkdown(markdown);
        el.innerHTML = html;
      } catch (error) {
        console.error('Failed to render markdown:', error);
        el.innerHTML = `<p>${escapeHtml(markdown)}</p>`;
      }
    }
  }

  // Render mermaid diagrams
  const diagramElements = container.querySelectorAll('.mermaid-diagram[data-diagram]');
  for (const el of diagramElements) {
    const diagramCode = decodeURIComponent((el as HTMLElement).dataset.diagram || '');
    if (diagramCode) {
      try {
        const normalizedCode = diagramCode.replace(/\\n/g, '\n');
        await renderDiagramToElement(normalizedCode, el as HTMLElement);
      } catch (error) {
        console.error('Failed to render diagram:', error);
        el.innerHTML = `<div class="mermaid-error">Failed to render diagram</div>`;
      }
    }
  }
}
