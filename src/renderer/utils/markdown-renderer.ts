/**
 * Markdown Renderer with Mermaid Diagram Support
 * Uses marked.js for markdown and mermaid.js for diagrams
 */

import { marked } from 'marked';
import mermaid from 'mermaid';

// Track if mermaid is initialized
let mermaidInitialized = false;

/**
 * Initialize mermaid with theme settings
 */
export function initializeMermaid(): void {
  if (mermaidInitialized) return;

  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      // Primary colors with high contrast text
      primaryColor: '#3b82f6',
      primaryTextColor: '#ffffff',
      primaryBorderColor: '#60a5fa',

      // Secondary/tertiary colors
      secondaryColor: '#374151',
      secondaryTextColor: '#f3f4f6',
      secondaryBorderColor: '#6b7280',
      tertiaryColor: '#1f2937',
      tertiaryTextColor: '#f9fafb',
      tertiaryBorderColor: '#4b5563',

      // General colors
      lineColor: '#9ca3af',
      textColor: '#f3f4f6',
      background: '#111827',
      mainBkg: '#1f2937',
      nodeBorder: '#4b5563',
      clusterBkg: '#374151',
      clusterBorder: '#6b7280',
      titleColor: '#f9fafb',
      edgeLabelBackground: '#374151',

      // Node text - ensure high contrast
      nodeTextColor: '#ffffff',

      // Flowchart specific
      defaultLinkColor: '#9ca3af',

      // Note colors
      noteBkgColor: '#fef3c7',
      noteTextColor: '#92400e',
      noteBorderColor: '#f59e0b',

      // Actor/sequence colors
      actorBkg: '#3b82f6',
      actorTextColor: '#ffffff',
      actorBorder: '#60a5fa',
      actorLineColor: '#9ca3af',
      signalColor: '#f3f4f6',
      signalTextColor: '#f3f4f6',
      labelBoxBkgColor: '#374151',
      labelBoxBorderColor: '#6b7280',
      labelTextColor: '#f3f4f6',
      loopTextColor: '#f3f4f6',
    },
    flowchart: {
      htmlLabels: true,
      curve: 'basis',
    },
    sequence: {
      diagramMarginX: 10,
      diagramMarginY: 10,
      actorMargin: 50,
      width: 150,
      height: 65,
    },
  });

  mermaidInitialized = true;
}

// Counter for unique diagram IDs
let diagramCounter = 0;

/**
 * Strip markdown code fences from mermaid code if present
 */
function stripMermaidFences(code: string): string {
  // Remove ```mermaid at the start and ``` at the end
  let cleaned = code.trim();

  // Handle ```mermaid or ``` at the beginning
  if (cleaned.startsWith('```mermaid')) {
    cleaned = cleaned.slice('```mermaid'.length);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice('```'.length);
  }

  // Handle ``` at the end
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }

  return cleaned.trim();
}

/**
 * Render a mermaid diagram to SVG
 */
export async function renderMermaidDiagram(code: string): Promise<string> {
  initializeMermaid();

  // Strip code fences if present
  const cleanCode = stripMermaidFences(code);
  const id = `mermaid-diagram-${diagramCounter++}`;

  try {
    const { svg } = await mermaid.render(id, cleanCode);
    return svg;
  } catch (error) {
    console.error('Mermaid render error:', error);
    return `<div class="mermaid-error">
      <span class="error-icon">&#9888;</span>
      <span>Failed to render diagram</span>
      <pre>${escapeHtml(cleanCode)}</pre>
    </div>`;
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Helper to render inline tokens to text
 */
function renderTokensToText(tokens: any[]): string {
  return tokens.map(token => {
    if (token.type === 'text') return escapeHtml(token.text || token.raw || '');
    if (token.type === 'codespan') return `<code>${escapeHtml(token.text)}</code>`;
    if (token.type === 'strong') return `<strong>${renderTokensToText(token.tokens || [])}</strong>`;
    if (token.type === 'em') return `<em>${renderTokensToText(token.tokens || [])}</em>`;
    if (token.type === 'link') return `<a href="${token.href}">${renderTokensToText(token.tokens || [])}</a>`;
    if (token.tokens) return renderTokensToText(token.tokens);
    return escapeHtml(token.raw || token.text || '');
  }).join('');
}

/**
 * Custom marked renderer that handles mermaid code blocks
 */
function createMarkedRenderer() {
  return {
    code({ text, lang }: { text: string; lang?: string }): string {
      if (lang === 'mermaid') {
        // Return a placeholder that will be replaced with the actual diagram
        const placeholder = `__MERMAID_PLACEHOLDER_${diagramCounter}__`;
        return `<div class="mermaid-container" data-mermaid="${encodeURIComponent(text)}" data-placeholder="${placeholder}">${placeholder}</div>`;
      }

      // Regular code block with syntax highlighting
      const language = lang || 'plaintext';
      const escapedCode = escapeHtml(text);
      return `<pre class="code-block"><code class="language-${language}">${escapedCode}</code></pre>`;
    },

    // Style links to open in new tab
    link({ href, title, tokens, text }: { href: string; title?: string | null; tokens: any[]; text: string }): string {
      const linkText = tokens ? renderTokensToText(tokens) : escapeHtml(text || '');
      let out = `<a href="${href}" target="_blank" rel="noopener noreferrer"`;
      if (title) {
        out += ` title="${title}"`;
      }
      out += `>${linkText}</a>`;
      return out;
    },

    // Add anchor links to headings
    heading({ tokens, depth, text }: { tokens: any[]; depth: number; text: string }): string {
      const headingText = tokens ? renderTokensToText(tokens) : escapeHtml(text || '');
      return `<h${depth} class="md-heading">${headingText}</h${depth}>`;
    },
  };
}

// Configure marked with custom renderer
marked.use({ renderer: createMarkedRenderer() });

/**
 * Render markdown to HTML (synchronous, mermaid diagrams need post-processing)
 */
export function renderMarkdownSync(markdown: string): string {
  if (!markdown) return '';

  try {
    return marked.parse(markdown) as string;
  } catch (error) {
    console.error('Markdown parse error:', error);
    return `<p>${escapeHtml(markdown)}</p>`;
  }
}

/**
 * Render markdown to HTML with mermaid diagram support (async)
 * This processes the HTML and replaces mermaid placeholders with actual diagrams
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  if (!markdown) return '';

  // First pass: render markdown
  let html = renderMarkdownSync(markdown);

  // Second pass: find and render mermaid diagrams
  const mermaidPattern = /<div class="mermaid-container" data-mermaid="([^"]+)" data-placeholder="([^"]+)">[^<]+<\/div>/g;
  const matches = [...html.matchAll(mermaidPattern)];

  for (const match of matches) {
    const [fullMatch, encodedCode, placeholder] = match;
    const code = decodeURIComponent(encodedCode);
    const svg = await renderMermaidDiagram(code);
    // Wrap with expand button
    const diagramHtml = `
      <div class="mermaid-container">
        <button class="mermaid-expand-btn" title="Expand diagram" data-mermaid-svg="${encodeURIComponent(svg)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9"></polyline>
            <polyline points="9 21 3 21 3 15"></polyline>
            <line x1="21" y1="3" x2="14" y2="10"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
        </button>
        <div class="mermaid-diagram">${svg}</div>
      </div>
    `;
    html = html.replace(fullMatch, diagramHtml);
  }

  return html;
}

/**
 * Render markdown into a DOM element with mermaid support
 */
export async function renderMarkdownToElement(
  markdown: string,
  element: HTMLElement
): Promise<void> {
  const html = await renderMarkdown(markdown);
  element.innerHTML = html;

  // Attach expand button click handlers
  element.querySelectorAll('.mermaid-expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const svg = decodeURIComponent((btn as HTMLElement).dataset.mermaidSvg || '');
      if (svg) {
        showMermaidModal(svg);
      }
    });
  });
}

/**
 * Show a modal with an expanded mermaid diagram
 */
function showMermaidModal(svg: string): void {
  // Remove existing modal if any
  const existingModal = document.getElementById('mermaid-modal');
  if (existingModal) {
    existingModal.remove();
  }

  // Create modal
  const modal = document.createElement('div');
  modal.id = 'mermaid-modal';
  modal.className = 'mermaid-modal';
  modal.innerHTML = `
    <div class="mermaid-modal-backdrop"></div>
    <div class="mermaid-modal-content">
      <div class="mermaid-modal-header">
        <span class="mermaid-modal-title">Diagram</span>
        <div class="mermaid-modal-controls">
          <button class="mermaid-modal-zoom-out" title="Zoom out">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </button>
          <span class="mermaid-modal-zoom-level">400%</span>
          <button class="mermaid-modal-zoom-in" title="Zoom in">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="11" y1="8" x2="11" y2="14"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </button>
          <button class="mermaid-modal-reset" title="Reset zoom">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
            </svg>
          </button>
          <button class="mermaid-modal-close" title="Close (Esc)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
      <div class="mermaid-modal-body">
        <div class="mermaid-modal-diagram" style="transform: translate(0px, 0px) scale(4);">
          ${svg}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // State
  const zoomStep = 0.25;
  const minZoom = 0.25;
  const maxZoom = 10; // 1000% max zoom
  let zoomLevel = 4; // Start at 400% zoom
  let panX = 0;
  let panY = 0;

  // Pan state
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartPosX = 0;
  let panStartPosY = 0;

  const diagramEl = modal.querySelector('.mermaid-modal-diagram') as HTMLElement;
  const bodyEl = modal.querySelector('.mermaid-modal-body') as HTMLElement;
  const zoomLevelEl = modal.querySelector('.mermaid-modal-zoom-level') as HTMLElement;

  const updateTransform = () => {
    diagramEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    zoomLevelEl.textContent = `${Math.round(zoomLevel * 100)}%`;
  };

  // Apply initial transform
  updateTransform();

  // Close handlers
  const closeModal = () => {
    modal.classList.add('closing');
    document.removeEventListener('keydown', keyHandler);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    setTimeout(() => modal.remove(), 150);
  };

  modal.querySelector('.mermaid-modal-backdrop')?.addEventListener('click', closeModal);
  modal.querySelector('.mermaid-modal-close')?.addEventListener('click', closeModal);

  // Zoom handlers
  modal.querySelector('.mermaid-modal-zoom-in')?.addEventListener('click', () => {
    zoomLevel = Math.min(maxZoom, zoomLevel + zoomStep);
    updateTransform();
  });

  modal.querySelector('.mermaid-modal-zoom-out')?.addEventListener('click', () => {
    zoomLevel = Math.max(minZoom, zoomLevel - zoomStep);
    updateTransform();
  });

  modal.querySelector('.mermaid-modal-reset')?.addEventListener('click', () => {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    updateTransform();
  });

  // Keyboard handler
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
    } else if (e.key === '+' || e.key === '=') {
      zoomLevel = Math.min(maxZoom, zoomLevel + zoomStep);
      updateTransform();
    } else if (e.key === '-') {
      zoomLevel = Math.max(minZoom, zoomLevel - zoomStep);
      updateTransform();
    } else if (e.key === '0') {
      zoomLevel = 1;
      panX = 0;
      panY = 0;
      updateTransform();
    }
  };
  document.addEventListener('keydown', keyHandler);

  // Mouse wheel zoom
  bodyEl?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = (e as WheelEvent).deltaY > 0 ? -zoomStep : zoomStep;
    zoomLevel = Math.max(minZoom, Math.min(maxZoom, zoomLevel + delta));
    updateTransform();
  });

  // Pan handlers
  const handleMouseDown = (e: MouseEvent) => {
    // Only pan with left mouse button and not on controls
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.mermaid-modal-header')) return;

    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPosX = panX;
    panStartPosY = panY;
    bodyEl.style.cursor = 'grabbing';
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isPanning) return;

    const deltaX = e.clientX - panStartX;
    const deltaY = e.clientY - panStartY;
    panX = panStartPosX + deltaX;
    panY = panStartPosY + deltaY;
    updateTransform();
  };

  const handleMouseUp = () => {
    if (isPanning) {
      isPanning = false;
      bodyEl.style.cursor = 'grab';
    }
  };

  bodyEl?.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  // Animate in
  requestAnimationFrame(() => {
    modal.classList.add('open');
  });
}

/**
 * Render a standalone mermaid diagram into an element with expand button
 */
export async function renderDiagramToElement(
  code: string,
  element: HTMLElement
): Promise<void> {
  const svg = await renderMermaidDiagram(code);

  // Wrap with expand button
  element.innerHTML = `
    <button class="mermaid-expand-btn" title="Expand diagram" data-mermaid-svg="${encodeURIComponent(svg)}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 3 21 3 21 9"></polyline>
        <polyline points="9 21 3 21 3 15"></polyline>
        <line x1="21" y1="3" x2="14" y2="10"></line>
        <line x1="3" y1="21" x2="10" y2="14"></line>
      </svg>
    </button>
    <div class="mermaid-diagram-inner">${svg}</div>
  `;

  // Attach expand button click handler
  const expandBtn = element.querySelector('.mermaid-expand-btn');
  expandBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    showMermaidModal(svg);
  });
}
