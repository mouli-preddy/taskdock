// src/renderer/components/plugin-tab-renderer.ts
import { Toast } from './toast.js';
import { getIcon } from '../utils/icons.js';
import type {
  PluginUI,
  PluginComponent,
  LoadedPlugin,
  TableColumn,
} from '../../shared/plugin-types.js';

export class PluginTabRenderer {
  private container: HTMLElement;
  private plugin: LoadedPlugin;
  private componentData: Map<string, any> = new Map();
  private selectedRows: Map<string, any> = new Map();
  private triggerCallback: ((triggerId: string, input?: any) => void) | null = null;

  constructor(container: HTMLElement, plugin: LoadedPlugin) {
    this.container = container;
    this.plugin = plugin;
  }

  onTrigger(callback: (triggerId: string, input?: any) => void) {
    this.triggerCallback = callback;
  }

  /** Render the full plugin UI */
  render(): void {
    if (!this.plugin.ui) {
      this.container.innerHTML = `<div class="plugin-empty">
        <p>This plugin has no UI definition.</p>
      </div>`;
      return;
    }
    this.container.innerHTML = '';
    const el = this.renderComponent(this.plugin.ui.layout);
    this.container.appendChild(el);
  }

  /** Update a component's data by ID */
  updateComponent(componentId: string, data: any): void {
    this.componentData.set(componentId, data);
    const el = this.container.querySelector(`[data-plugin-component-id="${componentId}"]`);
    if (el) {
      const component = this.findComponentDef(this.plugin.ui?.layout, componentId);
      if (component) {
        const newEl = this.renderComponent(component);
        el.replaceWith(newEl);
      }
    }
  }

  private renderComponent(def: PluginComponent): HTMLElement {
    switch (def.type) {
      case 'table': return this.renderTable(def);
      case 'detail-panel': return this.renderDetailPanel(def);
      case 'card': return this.renderCard(def);
      case 'split-panel': return this.renderSplitPanel(def);
      case 'button-group': return this.renderButtonGroup(def);
      case 'status-badge': return this.renderStatusBadge(def);
      case 'key-value': return this.renderKeyValue(def);
      case 'timeline': return this.renderTimeline(def);
      case 'tabs': return this.renderTabs(def);
      case 'form': return this.renderForm(def);
      case 'markdown': return this.renderMarkdown(def);
      case 'empty-state': return this.renderEmptyState(def);
      case 'header': return this.renderHeader(def);
      default:
        const el = document.createElement('div');
        el.textContent = `Unknown component: ${(def as any).type}`;
        return el;
    }
  }

  private renderTable(def: any): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'plugin-table-wrapper';
    if (def.id) wrapper.dataset.pluginComponentId = def.id;

    const data = (def.id ? this.componentData.get(def.id) : null) || [];
    const rows = Array.isArray(data) ? data : [];

    if (rows.length === 0) {
      wrapper.innerHTML = `<div class="plugin-table-empty">No data</div>`;
      return wrapper;
    }

    const table = document.createElement('table');
    table.className = 'plugin-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const col of def.columns) {
      const th = document.createElement('th');
      th.textContent = col.label || col.key;
      if (col.width) th.style.width = `${col.width}px`;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.className = 'plugin-table-row';
      if (def.onRowClick) {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => {
          this.selectedRows.set(def.id, row);
          tbody.querySelectorAll('.selected').forEach(r => r.classList.remove('selected'));
          tr.classList.add('selected');
          this.triggerCallback?.(def.onRowClick, { selectedRow: row });
        });
      }

      for (const col of def.columns) {
        const td = document.createElement('td');
        const value = row[col.key];

        if (col.component === 'status-badge' && col.colorMap) {
          const badge = document.createElement('span');
          badge.className = 'plugin-status-badge';
          badge.textContent = String(value ?? '');
          badge.style.backgroundColor = col.colorMap[String(value)] || 'var(--text-secondary)';
          td.appendChild(badge);
        } else {
          td.textContent = String(value ?? '');
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
  }

  private renderDetailPanel(def: any): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'plugin-detail-panel';
    if (def.id) panel.dataset.pluginComponentId = def.id;

    const data = def.id ? this.componentData.get(def.id) : null;

    for (const section of def.sections || []) {
      const sectionEl = this.renderComponent(this.resolveTemplates(section, data));
      panel.appendChild(sectionEl);
    }
    return panel;
  }

  private renderCard(def: any): HTMLElement {
    const card = document.createElement('div');
    card.className = 'plugin-card';
    if (def.id) card.dataset.pluginComponentId = def.id;

    if (def.label) {
      const label = document.createElement('div');
      label.className = 'plugin-card-label';
      label.textContent = def.label;
      card.appendChild(label);
    }

    const content = document.createElement('div');
    content.className = 'plugin-card-content';
    if (def.renderAs === 'markdown') {
      content.innerHTML = this.escapeHtml(def.content || '');
    } else {
      content.textContent = def.content || '';
    }
    card.appendChild(content);
    return card;
  }

  private renderSplitPanel(def: any): HTMLElement {
    const split = document.createElement('div');
    split.className = 'plugin-split-panel';
    if (def.id) split.dataset.pluginComponentId = def.id;

    const direction = def.direction || 'horizontal';
    split.style.display = 'flex';
    split.style.flexDirection = direction === 'vertical' ? 'column' : 'row';
    split.style.height = '100%';

    const [leftSize, rightSize] = def.sizes || [50, 50];

    const left = document.createElement('div');
    left.className = 'plugin-split-left';
    left.style.flex = `0 0 ${leftSize}%`;
    left.style.overflow = 'auto';
    if (def.children[0]) left.appendChild(this.renderComponent(def.children[0]));

    const right = document.createElement('div');
    right.className = 'plugin-split-right';
    right.style.flex = `0 0 ${rightSize}%`;
    right.style.overflow = 'auto';
    if (def.children[1]) right.appendChild(this.renderComponent(def.children[1]));

    split.appendChild(left);
    split.appendChild(right);
    return split;
  }

  private renderButtonGroup(def: any): HTMLElement {
    const group = document.createElement('div');
    group.className = 'plugin-button-group';
    if (def.id) group.dataset.pluginComponentId = def.id;

    for (const btn of def.buttons || []) {
      const button = document.createElement('button');
      button.className = `plugin-btn ${btn.variant ? `plugin-btn-${btn.variant}` : ''}`;
      button.innerHTML = `${btn.icon ? `<span class="plugin-btn-icon">${this.escapeHtml(btn.icon)}</span>` : ''}${this.escapeHtml(btn.label)}`;
      button.addEventListener('click', () => {
        this.triggerCallback?.(btn.action);
      });
      group.appendChild(button);
    }
    return group;
  }

  private renderStatusBadge(def: any): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'plugin-status-badge';
    if (def.id) badge.dataset.pluginComponentId = def.id;
    badge.textContent = def.value || '';
    if (def.colorMap?.[def.value]) {
      badge.style.backgroundColor = def.colorMap[def.value];
    }
    return badge;
  }

  private renderKeyValue(def: any): HTMLElement {
    const kv = document.createElement('div');
    kv.className = 'plugin-key-value';
    if (def.id) kv.dataset.pluginComponentId = def.id;

    const data = def.id ? this.componentData.get(def.id) : null;
    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        const row = document.createElement('div');
        row.className = 'plugin-kv-row';
        row.innerHTML = `<span class="plugin-kv-key">${this.escapeHtml(key)}</span><span class="plugin-kv-value">${this.escapeHtml(String(value))}</span>`;
        kv.appendChild(row);
      }
    }
    return kv;
  }

  private renderTimeline(def: any): HTMLElement {
    const tl = document.createElement('div');
    tl.className = 'plugin-timeline';
    if (def.id) tl.dataset.pluginComponentId = def.id;

    const data = def.id ? this.componentData.get(def.id) : null;
    const items = Array.isArray(data) ? data : [];

    for (const item of items) {
      const entry = document.createElement('div');
      entry.className = 'plugin-timeline-entry';
      entry.innerHTML = `
        <div class="plugin-timeline-dot"></div>
        <div class="plugin-timeline-content">
          <div class="plugin-timeline-time">${this.escapeHtml(String(item.time || item.timestamp || ''))}</div>
          <div class="plugin-timeline-title">${this.escapeHtml(String(item.title || ''))}</div>
          <div class="plugin-timeline-desc">${this.escapeHtml(String(item.description || ''))}</div>
        </div>`;
      tl.appendChild(entry);
    }
    return tl;
  }

  private renderTabs(def: any): HTMLElement {
    const tabs = document.createElement('div');
    tabs.className = 'plugin-tabs';
    if (def.id) tabs.dataset.pluginComponentId = def.id;

    const tabBar = document.createElement('div');
    tabBar.className = 'plugin-tabs-bar';

    const contentArea = document.createElement('div');
    contentArea.className = 'plugin-tabs-content';

    (def.items || []).forEach((item: any, i: number) => {
      const tab = document.createElement('button');
      tab.className = `plugin-tab-btn ${i === 0 ? 'active' : ''}`;
      tab.textContent = item.label;
      tab.addEventListener('click', () => {
        tabBar.querySelectorAll('.plugin-tab-btn').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        contentArea.innerHTML = '';
        if (item.content) contentArea.appendChild(this.renderComponent(item.content));
      });
      tabBar.appendChild(tab);
    });

    if (def.items?.[0]?.content) {
      contentArea.appendChild(this.renderComponent(def.items[0].content));
    }

    tabs.appendChild(tabBar);
    tabs.appendChild(contentArea);
    return tabs;
  }

  private renderForm(def: any): HTMLElement {
    const form = document.createElement('div');
    form.className = 'plugin-form';
    if (def.id) form.dataset.pluginComponentId = def.id;

    for (const field of def.fields || []) {
      const group = document.createElement('div');
      group.className = 'plugin-form-group';
      group.innerHTML = `
        <label class="plugin-form-label">${this.escapeHtml(field.label)}</label>
        <input class="plugin-form-input" type="${field.type || 'text'}" data-key="${this.escapeHtml(field.key)}" ${field.required ? 'required' : ''} />`;
      form.appendChild(group);
    }

    if (def.onSubmit) {
      const btn = document.createElement('button');
      btn.className = 'plugin-btn';
      btn.textContent = 'Submit';
      btn.addEventListener('click', () => {
        const values: Record<string, any> = {};
        form.querySelectorAll('.plugin-form-input').forEach((input: any) => {
          values[input.dataset.key] = input.value;
        });
        this.triggerCallback?.(def.onSubmit, values);
      });
      form.appendChild(btn);
    }
    return form;
  }

  private renderMarkdown(def: any): HTMLElement {
    const md = document.createElement('div');
    md.className = 'plugin-markdown';
    if (def.id) md.dataset.pluginComponentId = def.id;
    md.textContent = def.content || '';
    return md;
  }

  private renderEmptyState(def: any): HTMLElement {
    const empty = document.createElement('div');
    empty.className = 'plugin-empty-state';
    if (def.id) empty.dataset.pluginComponentId = def.id;
    empty.innerHTML = `
      <div class="plugin-empty-title">${this.escapeHtml(def.title)}</div>
      <div class="plugin-empty-desc">${this.escapeHtml(def.description || '')}</div>
      ${def.action ? `<button class="plugin-btn plugin-empty-action">${this.escapeHtml(def.action.label)}</button>` : ''}`;
    if (def.action) {
      empty.querySelector('.plugin-empty-action')?.addEventListener('click', () => {
        this.triggerCallback?.(def.action.trigger);
      });
    }
    return empty;
  }

  private renderHeader(def: any): HTMLElement {
    const header = document.createElement('div');
    header.className = 'plugin-header';
    if (def.id) header.dataset.pluginComponentId = def.id;
    header.innerHTML = `
      <h2 class="plugin-header-title">${this.escapeHtml(def.title || '')}</h2>
      ${def.subtitle ? `<div class="plugin-header-subtitle">${this.escapeHtml(def.subtitle)}</div>` : ''}`;
    return header;
  }

  /** Replace {{property}} templates with data values */
  private resolveTemplates(component: any, data: any): any {
    if (!data) return component;
    const str = JSON.stringify(component);
    const resolved = str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = data[key];
      return val !== undefined ? String(val) : '';
    });
    return JSON.parse(resolved);
  }

  /** Find a component definition by ID (recursive) */
  private findComponentDef(component: PluginComponent | undefined, id: string): PluginComponent | null {
    if (!component) return null;
    if ((component as any).id === id) return component;
    if ('children' in component && Array.isArray((component as any).children)) {
      for (const child of (component as any).children) {
        const found = this.findComponentDef(child, id);
        if (found) return found;
      }
    }
    if ('sections' in component && Array.isArray((component as any).sections)) {
      for (const section of (component as any).sections) {
        const found = this.findComponentDef(section, id);
        if (found) return found;
      }
    }
    if ('items' in component && Array.isArray((component as any).items)) {
      for (const item of (component as any).items) {
        if (item.content) {
          const found = this.findComponentDef(item.content, id);
          if (found) return found;
        }
      }
    }
    return null;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
