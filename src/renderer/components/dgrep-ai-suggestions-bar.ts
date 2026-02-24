import { escapeHtml } from '../utils/html-utils.js';
import { Sparkles } from '../utils/icons.js';
import { iconHtml } from '../utils/icons.js';

export class DGrepAISuggestionsBar {
  private container: HTMLElement;
  private el: HTMLElement;
  private suggestions: string[] = [];

  onSuggestionClick: ((suggestion: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.container = parent;
    this.el = document.createElement('div');
    this.el.className = 'dgrep-ai-suggestions-bar';
    this.el.style.display = 'none';
    this.container.appendChild(this.el);
  }

  setSuggestions(suggestions: string[]) {
    this.suggestions = suggestions;
    if (suggestions.length === 0) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = '';
    this.render();
  }

  clear() {
    this.suggestions = [];
    this.el.style.display = 'none';
    this.el.innerHTML = '';
  }

  private render() {
    let html = `<span class="dgrep-ai-suggestions-label">${iconHtml(Sparkles, { size: 12 })} Suggestions:</span>`;
    for (const s of this.suggestions) {
      html += `<button class="dgrep-ai-suggestion-chip">${escapeHtml(s)}</button>`;
    }
    this.el.innerHTML = html;

    this.el.querySelectorAll('.dgrep-ai-suggestion-chip').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        if (this.onSuggestionClick && this.suggestions[i]) {
          this.onSuggestionClick(this.suggestions[i]);
        }
      });
    });
  }
}
