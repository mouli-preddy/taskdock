import { getIcon, Sparkles, Loader2 } from '../utils/icons.js';

export interface DGrepNLInputCallbacks {
  onGenerateKQL: (prompt: string, columns: string[]) => void;
  onKQLGenerated: (kql: string, explanation: string) => void;
}

export class DGrepNLInput {
  private wrapper: HTMLElement;
  private input!: HTMLInputElement;
  private submitBtn!: HTMLButtonElement;
  private toggle!: HTMLInputElement;
  private explanationEl!: HTMLElement;
  private callbacks: DGrepNLInputCallbacks;
  private loading = false;
  private enabled = true;

  constructor(parent: HTMLElement, callbacks: DGrepNLInputCallbacks) {
    this.callbacks = callbacks;
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'dgrep-nl-wrapper';
    this.render();
    parent.appendChild(this.wrapper);
  }

  private render(): void {
    const row = document.createElement('div');
    row.className = 'dgrep-nl-input-container';

    // AI toggle
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'dgrep-nl-toggle';
    this.toggle = document.createElement('input');
    this.toggle.type = 'checkbox';
    this.toggle.checked = true;
    this.toggle.addEventListener('change', () => {
      this.enabled = this.toggle.checked;
      this.input.disabled = !this.enabled;
      this.submitBtn.disabled = !this.enabled;
      row.classList.toggle('dgrep-nl-disabled', !this.enabled);
    });
    const toggleSpan = document.createElement('span');
    toggleSpan.textContent = 'AI';
    toggleLabel.appendChild(this.toggle);
    toggleLabel.appendChild(toggleSpan);

    // Input wrapper (icon + input)
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'dgrep-nl-input-wrapper';

    const icon = document.createElement('span');
    icon.className = 'dgrep-nl-icon';
    icon.innerHTML = getIcon(Sparkles, 14);

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'dgrep-nl-input';
    this.input.placeholder = 'Ask AI... (e.g. "show errors with timeout")';
    this.input.autocomplete = 'off';
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !this.loading && this.enabled) {
        this.handleSubmit();
      }
    });

    inputWrapper.appendChild(icon);
    inputWrapper.appendChild(this.input);

    // Submit button
    this.submitBtn = document.createElement('button');
    this.submitBtn.className = 'btn btn-sm btn-secondary dgrep-nl-submit';
    this.submitBtn.innerHTML = `${getIcon(Sparkles, 12)} KQL`;
    this.submitBtn.title = 'Generate KQL from natural language';
    this.submitBtn.addEventListener('click', () => {
      if (!this.loading && this.enabled) this.handleSubmit();
    });

    // Explanation area (below the row)
    this.explanationEl = document.createElement('div');
    this.explanationEl.className = 'dgrep-nl-explanation hidden';

    row.appendChild(toggleLabel);
    row.appendChild(inputWrapper);
    row.appendChild(this.submitBtn);

    this.wrapper.appendChild(row);
    this.wrapper.appendChild(this.explanationEl);
  }

  private handleSubmit(): void {
    const prompt = this.input.value.trim();
    if (!prompt) return;

    this.setLoading(true);
    this.callbacks.onGenerateKQL(prompt, this.getColumns());
  }

  setLoading(loading: boolean): void {
    this.loading = loading;
    this.submitBtn.disabled = loading;
    this.input.disabled = loading;
    if (loading) {
      this.submitBtn.innerHTML = `${getIcon(Loader2, 12, 'animate-spin')} ...`;
      this.explanationEl.classList.add('hidden');
    } else {
      this.submitBtn.innerHTML = `${getIcon(Sparkles, 12)} KQL`;
    }
  }

  setResult(kql: string, explanation: string): void {
    this.setLoading(false);
    if (explanation) {
      this.explanationEl.textContent = explanation;
      this.explanationEl.classList.remove('hidden');
    }
    this.callbacks.onKQLGenerated(kql, explanation);
  }

  setError(message: string): void {
    this.setLoading(false);
    this.explanationEl.textContent = message;
    this.explanationEl.classList.remove('hidden');
    this.explanationEl.classList.add('dgrep-nl-error');
    setTimeout(() => {
      this.explanationEl.classList.remove('dgrep-nl-error');
    }, 3000);
  }

  setColumns(columns: string[]): void {
    this.input.dataset.columns = JSON.stringify(columns);
  }

  getColumns(): string[] {
    try {
      return JSON.parse(this.input.dataset.columns || '[]');
    } catch {
      return [];
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getElement(): HTMLElement {
    return this.wrapper;
  }
}
