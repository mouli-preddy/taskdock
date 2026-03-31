import { marked } from 'marked';
import { escapeHtml } from './html-utils.js';

export function renderMarkdown(text: string): string {
  try {
    return marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
  } catch {
    return `<pre style="white-space:pre-wrap;word-break:break-word;">${escapeHtml(text)}</pre>`;
  }
}
