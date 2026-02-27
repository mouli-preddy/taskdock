import { escapeHtml } from '../../utils/html-utils.js';
import { getIcon, ChevronRight } from '../../utils/icons.js';

interface EventData {
  type: string;
  entries: Array<Record<string, unknown>>;
}

export class CfvRawEventsPanel {
  private container: HTMLElement;
  private events: EventData[] = [];
  private selectedType: string = '';

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setData(rawFiles: Record<string, unknown>) {
    this.events = [];

    // Extract event data from raw files
    for (const [name, data] of Object.entries(rawFiles)) {
      if (!data || typeof data !== 'object') continue;

      if (name === 'events_qoe') {
        const entries = this.extractEntries(data as Record<string, unknown>);
        if (entries.length > 0) {
          this.events.push({ type: 'mdss_qoe', entries });
        }
      } else if (name === 'callSummary') {
        this.events.push({ type: 'callSummary', entries: [data as Record<string, unknown>] });
      } else if (name === 'chatAssistant') {
        this.events.push({ type: 'chatAssistant', entries: [data as Record<string, unknown>] });
      }
    }

    if (this.events.length > 0 && !this.selectedType) {
      this.selectedType = this.events[0].type;
    }

    this.render();
  }

  private extractEntries(data: Record<string, unknown>): Array<Record<string, unknown>> {
    // CFV events can be nested in various structures
    if (Array.isArray(data)) return data;
    if (data.events && Array.isArray(data.events)) return data.events;
    if (data.data && Array.isArray(data.data)) return data.data;
    if (data.results && Array.isArray(data.results)) return data.results;
    return [data];
  }

  private render() {
    if (this.events.length === 0) {
      this.container.innerHTML = `
        <div class="cfv-no-data">
          <p>No raw event data available</p>
          <p style="font-size:11px;color:var(--text-tertiary)">
            Currently only mdss_qoe events are fetched. Other event types (26 total) can be added in a future update.
          </p>
        </div>
      `;
      return;
    }

    const selectedEvents = this.events.find(e => e.type === this.selectedType);

    this.container.innerHTML = `
      <div class="cfv-raw-events">
        <div class="cfv-raw-events-header">
          <select class="cfv-raw-events-select" id="cfvEventTypeSelect">
            ${this.events.map(e => `
              <option value="${escapeHtml(e.type)}" ${e.type === this.selectedType ? 'selected' : ''}>
                ${escapeHtml(e.type)}
              </option>
            `).join('')}
          </select>
          <span class="cfv-raw-events-count">
            ${selectedEvents ? `${selectedEvents.entries.length} entries` : ''}
          </span>
        </div>
        <div class="cfv-raw-events-body" id="cfvEventsList"></div>
      </div>
    `;

    this.renderEntries(selectedEvents?.entries ?? []);
    this.attachEventListeners();
  }

  private renderEntries(entries: Array<Record<string, unknown>>) {
    const list = this.container.querySelector('#cfvEventsList');
    if (!list) return;

    if (entries.length === 0) {
      list.innerHTML = '<div class="cfv-no-data" style="height:100px"><p>No entries</p></div>';
      return;
    }

    list.innerHTML = entries.map((entry, idx) => {
      // Show a brief preview of the entry
      const keys = Object.keys(entry);
      const preview = keys.slice(0, 3).map(k => `${k}`).join(', ');
      const previewSuffix = keys.length > 3 ? ` +${keys.length - 3} more` : '';

      return `
        <div class="cfv-json-entry" data-idx="${idx}">
          <div class="cfv-json-entry-header">
            ${getIcon(ChevronRight, 12)}
            <span>Entry ${idx + 1}</span>
            <span style="color:var(--text-tertiary);font-size:11px;margin-left:auto">
              ${escapeHtml(preview + previewSuffix)} (${keys.length} fields)
            </span>
          </div>
          <div class="cfv-json-entry-body">
            <div class="cfv-json-tree">${this.renderJsonTree(entry)}</div>
          </div>
        </div>
      `;
    }).join('');

    // Toggle expand
    list.querySelectorAll('.cfv-json-entry-header').forEach(header => {
      header.addEventListener('click', () => {
        const entry = header.closest('.cfv-json-entry');
        entry?.classList.toggle('expanded');
      });
    });
  }

  private renderJsonTree(obj: unknown, depth = 0): string {
    if (obj === null || obj === undefined) {
      return `<span class="cfv-json-null">null</span>`;
    }

    if (typeof obj === 'string') {
      const truncated = obj.length > 200 ? obj.slice(0, 200) + '...' : obj;
      return `<span class="cfv-json-string">"${escapeHtml(truncated)}"</span>`;
    }

    if (typeof obj === 'number') {
      return `<span class="cfv-json-number">${obj}</span>`;
    }

    if (typeof obj === 'boolean') {
      return `<span class="cfv-json-bool">${obj}</span>`;
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) return '<span class="cfv-json-null">[]</span>';
      if (depth > 3) return `<span class="cfv-json-null">[${obj.length} items]</span>`;

      return `[<div style="padding-left:16px">${
        obj.slice(0, 20).map((item, i) =>
          `<div>${i}: ${this.renderJsonTree(item, depth + 1)}${i < obj.length - 1 ? ',' : ''}</div>`
        ).join('')
      }${obj.length > 20 ? `<div>... +${obj.length - 20} more</div>` : ''}</div>]`;
    }

    if (typeof obj === 'object') {
      const entries = Object.entries(obj as Record<string, unknown>);
      if (entries.length === 0) return '<span class="cfv-json-null">{}</span>';
      if (depth > 3) return `<span class="cfv-json-null">{${entries.length} fields}</span>`;

      return `{<div style="padding-left:16px">${
        entries.slice(0, 50).map(([key, value], i) =>
          `<div><span class="cfv-json-key">"${escapeHtml(key)}"</span>: ${this.renderJsonTree(value, depth + 1)}${i < entries.length - 1 ? ',' : ''}</div>`
        ).join('')
      }${entries.length > 50 ? `<div>... +${entries.length - 50} more fields</div>` : ''}</div>}`;
    }

    return escapeHtml(String(obj));
  }

  private attachEventListeners() {
    const select = this.container.querySelector('#cfvEventTypeSelect') as HTMLSelectElement;
    if (select) {
      select.addEventListener('change', () => {
        this.selectedType = select.value;
        const selectedEvents = this.events.find(e => e.type === this.selectedType);
        this.renderEntries(selectedEvents?.entries ?? []);

        // Update count
        const count = this.container.querySelector('.cfv-raw-events-count');
        if (count && selectedEvents) {
          count.textContent = `${selectedEvents.entries.length} entries`;
        }
      });
    }
  }

  dispose() {}
}
