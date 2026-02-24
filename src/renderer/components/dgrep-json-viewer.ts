const MAX_STRING_LENGTH = 10000;
const MAX_DEPTH = 10;

export class DGrepJsonViewer {
  private container: HTMLElement;
  private row: Record<string, any> | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'dgrep-json-viewer';
    parent.appendChild(this.container);
  }

  setData(row: Record<string, any>): void {
    this.row = row;
    this.render();
  }

  destroy(): void {
    this.container.remove();
  }

  private render(): void {
    if (!this.row) {
      this.container.innerHTML = '';
      return;
    }

    this.container.innerHTML = `
      <div class="dgrep-json-toolbar">
        <button class="btn btn-xs btn-ghost dgrep-json-expand-all">Expand All</button>
        <button class="btn btn-xs btn-ghost dgrep-json-collapse-all">Collapse All</button>
        <button class="btn btn-xs btn-ghost dgrep-json-copy-all" title="Copy entire row as JSON">Copy All</button>
      </div>
      <div class="dgrep-json-tree"></div>
    `;

    const tree = this.container.querySelector('.dgrep-json-tree')!;
    tree.appendChild(this.buildNode(this.row, 0));

    this.container.querySelector('.dgrep-json-expand-all')?.addEventListener('click', () => {
      this.container.querySelectorAll('.dgrep-json-children.collapsed').forEach(el => {
        el.classList.remove('collapsed');
      });
      this.container.querySelectorAll('.dgrep-json-toggle').forEach(el => {
        el.textContent = '\u25BC';
      });
    });

    this.container.querySelector('.dgrep-json-collapse-all')?.addEventListener('click', () => {
      this.container.querySelectorAll('.dgrep-json-children').forEach(el => {
        el.classList.add('collapsed');
      });
      this.container.querySelectorAll('.dgrep-json-toggle').forEach(el => {
        el.textContent = '\u25B6';
      });
    });

    this.container.querySelector('.dgrep-json-copy-all')?.addEventListener('click', () => {
      const json = JSON.stringify(this.row, null, 2);
      navigator.clipboard.writeText(json);
      const btn = this.container.querySelector('.dgrep-json-copy-all') as HTMLElement;
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1000);
      }
    });
  }

  private buildNode(value: any, depth: number): HTMLElement {
    if (depth > MAX_DEPTH) {
      const span = document.createElement('span');
      span.className = 'dgrep-json-val dgrep-json-null';
      span.textContent = '"[max depth]"';
      return span;
    }

    // Try to auto-parse string values that contain JSON
    if (typeof value === 'string') {
      const parsed = this.tryParseJson(value);
      if (parsed !== undefined) {
        value = parsed;
      }
    }

    if (value === null || value === undefined) {
      return this.createLeaf('null', 'dgrep-json-null');
    }

    if (typeof value === 'boolean') {
      return this.createLeaf(String(value), 'dgrep-json-boolean');
    }

    if (typeof value === 'number') {
      return this.createLeaf(String(value), 'dgrep-json-number');
    }

    if (typeof value === 'string') {
      const display = value.length > MAX_STRING_LENGTH
        ? value.slice(0, MAX_STRING_LENGTH) + '...[truncated]'
        : value;
      return this.createLeaf(`"${this.escapeJsonString(display)}"`, 'dgrep-json-string');
    }

    if (Array.isArray(value)) {
      return this.buildCollapsible(value, depth, true);
    }

    if (typeof value === 'object') {
      return this.buildCollapsible(value, depth, false);
    }

    return this.createLeaf(String(value), 'dgrep-json-string');
  }

  private createLeaf(text: string, className: string): HTMLElement {
    const span = document.createElement('span');
    span.className = `dgrep-json-val ${className}`;
    span.textContent = text;
    return span;
  }

  private buildCollapsible(obj: any, depth: number, isArray: boolean): HTMLElement {
    const entries = isArray ? obj.map((v: any, i: number) => [String(i), v]) : Object.entries(obj);
    const wrapper = document.createElement('div');
    wrapper.className = 'dgrep-json-node';

    const header = document.createElement('div');
    header.className = 'dgrep-json-header';

    const toggle = document.createElement('span');
    toggle.className = 'dgrep-json-toggle';
    toggle.textContent = '\u25BC';

    const bracket = document.createElement('span');
    bracket.className = 'dgrep-json-bracket';
    bracket.textContent = isArray ? `Array(${entries.length})` : `Object{${entries.length}}`;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-xs btn-ghost dgrep-json-copy-node';
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy this subtree as JSON';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const json = JSON.stringify(obj, null, 2);
      navigator.clipboard.writeText(json);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1000);
    });

    header.appendChild(toggle);
    header.appendChild(bracket);
    header.appendChild(copyBtn);

    const children = document.createElement('div');
    children.className = 'dgrep-json-children';

    for (const [key, val] of entries) {
      const row = document.createElement('div');
      row.className = 'dgrep-json-entry';
      row.style.paddingLeft = `${(depth + 1) * 16}px`;

      const keySpan = document.createElement('span');
      keySpan.className = 'dgrep-json-key';
      keySpan.textContent = isArray ? `[${key}]: ` : `${key}: `;

      row.appendChild(keySpan);
      row.appendChild(this.buildNode(val, depth + 1));
      children.appendChild(row);
    }

    header.addEventListener('click', () => {
      children.classList.toggle('collapsed');
      toggle.textContent = children.classList.contains('collapsed') ? '\u25B6' : '\u25BC';
    });

    wrapper.appendChild(header);
    wrapper.appendChild(children);
    return wrapper;
  }

  private tryParseJson(str: string): any | undefined {
    if (str.length < 2) return undefined;
    const first = str[0];
    if (first !== '{' && first !== '[') return undefined;
    try {
      return JSON.parse(str);
    } catch {
      return undefined;
    }
  }

  private escapeJsonString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }
}
