import type { WorkItem, SavedQuery } from '../../shared/workitem-types.js';
import { WORK_ITEM_TYPE_COLORS, WORK_ITEM_STATE_COLORS } from '../../shared/workitem-types.js';
import { escapeHtml, formatTimeAgo } from '../utils/html-utils.js';
import { getIcon, RefreshCw, User, Plus, Download, Search, Edit, Trash2, LayoutGrid, Cloud, ExternalLink, Activity, AlertTriangle, GripVertical } from '../utils/icons.js';

const ACTIVE_ORDER_KEY = 'taskdock:active-item-order';

export type WorkItemViewType = 'assigned' | 'created' | 'custom' | 'active';

interface WorkItemGroup {
  type: string;
  items: WorkItem[];
  totalCount: number;
}

const ALL_EXCLUDABLE_STATES = ['Closed', 'Resolved', 'Done', 'Removed', 'Abandoned'];
const ALL_SELECTABLE_TYPES = ['Bug', 'Task', 'User Story', 'Feature', 'Requirement', 'Epic', 'Issue', 'Impediment', 'Test Case', 'Test Plan', 'Test Suite'];
const DEFAULT_INCLUDED_TYPES = ['Bug', 'Task', 'Feature', 'Requirement'];

export class WorkItemsListView {
  private container: HTMLElement;
  private workItems: WorkItem[] = [];
  private groupedItems: WorkItemGroup[] = [];
  private activeTypeTab = '';
  private isGroupedMode = false;
  private savedQueries: SavedQuery[] = [];
  private activeView: WorkItemViewType = 'active';
  private activeQueryId: string | null = null;
  private loading = false;
  private activeIncidents: any[] = [];
  private activeItemOrder: string[] = [];
  private draggedKey: string | null = null;
  private showAllItems = false;
  private excludedStates: string[] = ['Closed', 'Resolved', 'Done', 'Removed', 'Abandoned'];
  private showAllTypes = false;
  private includedTypes: string[] = [...DEFAULT_INCLUDED_TYPES];

  private onSelectCallback: ((item: WorkItem) => void) | null = null;
  private onRefreshCallback: (() => void) | null = null;
  private onNewQueryCallback: (() => void) | null = null;
  private onImportAdoQueryCallback: (() => void) | null = null;
  private onEditQueryCallback: ((query: SavedQuery) => void) | null = null;
  private onDeleteQueryCallback: ((queryId: string) => void) | null = null;
  private onRunQueryCallback: ((query: SavedQuery) => void) | null = null;
  private onFilterChangeCallback: (() => void) | null = null;
  private onOpenInAdoCallback: ((item: WorkItem) => void) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
  }

  onSelect(callback: (item: WorkItem) => void) {
    this.onSelectCallback = callback;
  }

  onRefresh(callback: () => void) {
    this.onRefreshCallback = callback;
  }

  onNewQuery(callback: () => void) {
    this.onNewQueryCallback = callback;
  }

  onImportAdoQuery(callback: () => void) {
    this.onImportAdoQueryCallback = callback;
  }

  onEditQuery(callback: (query: SavedQuery) => void) {
    this.onEditQueryCallback = callback;
  }

  onDeleteQuery(callback: (queryId: string) => void) {
    this.onDeleteQueryCallback = callback;
  }

  onRunQuery(callback: (query: SavedQuery) => void) {
    this.onRunQueryCallback = callback;
  }

  onFilterChange(callback: () => void) {
    this.onFilterChangeCallback = callback;
  }

  onOpenInAdo(callback: (item: WorkItem) => void) {
    this.onOpenInAdoCallback = callback;
  }

  getFilterState(): { showAll: boolean; excludedStates: string[]; showAllTypes: boolean; includedTypes: string[] } {
    return {
      showAll: this.showAllItems,
      excludedStates: [...this.excludedStates],
      showAllTypes: this.showAllTypes,
      includedTypes: [...this.includedTypes],
    };
  }

  setWorkItems(items: WorkItem[]) {
    this.workItems = items;
    this.isGroupedMode = false;
    this.loading = false;
    this.renderTypeTabs();
    this.renderWorkItemsList();
  }

  setWorkItemsGrouped(groups: WorkItemGroup[]) {
    this.groupedItems = groups;
    this.isGroupedMode = true;
    this.loading = false;
    // Select first tab if current tab doesn't exist in new groups
    if (groups.length > 0 && !groups.find(g => g.type === this.activeTypeTab)) {
      this.activeTypeTab = groups[0].type;
    }
    this.renderTypeTabs();
    this.renderWorkItemsList();
  }

  setActiveItems(groups: WorkItemGroup[], incidents: any[]) {
    this.groupedItems = groups;
    this.activeIncidents = incidents;
    this.isGroupedMode = true;
    this.loading = false;
    this.activeItemOrder = this.loadActiveOrder(); // refresh from storage on each load
    this.renderTypeTabs();
    this.renderWorkItemsList();
  }

  setSavedQueries(queries: SavedQuery[]) {
    this.savedQueries = queries;
    this.renderQueriesList();
  }

  setLoading(loading: boolean) {
    this.loading = loading;
    this.renderWorkItemsList();
  }

  setActiveView(view: WorkItemViewType, queryId?: string) {
    this.activeView = view;
    this.activeQueryId = queryId || null;
    this.updateActiveState();
  }

  getActiveView(): WorkItemViewType {
    return this.activeView;
  }

  getActiveQueryId(): string | null {
    return this.activeQueryId;
  }

  private render() {
    this.container.innerHTML = `
      <div class="workitems-list-view">
        <header class="workitems-header">
          <div class="workitems-title">
            <h1>Work Items</h1>
            <span class="workitems-subtitle">Loading...</span>
          </div>
          <button class="btn btn-secondary" id="refreshWorkItemsBtn">
            ${getIcon(RefreshCw, 16)}
            Refresh
          </button>
        </header>

        <div class="workitems-layout">
          <!-- Left sidebar with views and queries -->
          <aside class="workitems-sidebar">
            <div class="workitems-views">
              <h3>Views</h3>
              <button class="workitems-view-btn active" data-view="active">
                ${getIcon(Activity, 16)}
                Active
              </button>
              <button class="workitems-view-btn" data-view="assigned">
                ${getIcon(User, 16)}
                Assigned to Me
              </button>
              <button class="workitems-view-btn" data-view="created">
                ${getIcon(Plus, 16)}
                Created by Me
              </button>
            </div>

            <div class="workitems-filters">
              <h3>Filters</h3>
              <label class="workitems-filter-checkbox workitems-filter-showall">
                <input type="checkbox" id="showAllItemsCheckbox" ${this.showAllItems ? 'checked' : ''}>
                <span>Show All Items</span>
              </label>
              <div class="workitems-state-filters ${this.showAllItems ? 'disabled' : ''}" id="stateFilters">
                <p class="workitems-filter-label">Hide states:</p>
                ${ALL_EXCLUDABLE_STATES.map(state => `
                  <label class="workitems-filter-checkbox">
                    <input type="checkbox" data-state="${state}" ${this.excludedStates.includes(state) ? 'checked' : ''}>
                    <span>${state}</span>
                  </label>
                `).join('')}
              </div>

              <label class="workitems-filter-checkbox workitems-filter-showall" style="margin-top: var(--space-3)">
                <input type="checkbox" id="showAllTypesCheckbox" ${this.showAllTypes ? 'checked' : ''}>
                <span>Show All Types</span>
              </label>
              <div class="workitems-state-filters ${this.showAllTypes ? 'disabled' : ''}" id="typeFilters">
                <p class="workitems-filter-label">Show types:</p>
                ${ALL_SELECTABLE_TYPES.map(type => `
                  <label class="workitems-filter-checkbox">
                    <input type="checkbox" data-type="${type}" ${this.includedTypes.includes(type) ? 'checked' : ''}>
                    <span>${type}</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <div class="workitems-queries">
              <div class="workitems-queries-header">
                <h3>Custom Queries</h3>
                <div class="workitems-queries-actions">
                  <button class="btn btn-icon" id="importAdoQueryBtn" title="Import from ADO">
                    ${getIcon(Download, 14)}
                  </button>
                  <button class="btn btn-icon" id="newQueryBtn" title="New Query">
                    ${getIcon(Plus, 14)}
                  </button>
                </div>
              </div>
              <div class="workitems-queries-list" id="queriesList"></div>
            </div>
          </aside>

          <!-- Main content area with work items -->
          <main class="workitems-main">
            <div id="workItemsTypeTabs"></div>
            <div class="workitems-list-container">
              <div class="workitems-list" id="workItemsList"></div>
            </div>
          </main>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.renderQueriesList();
    this.renderTypeTabs();
    this.renderWorkItemsList();
  }

  private attachEventListeners() {
    this.container.querySelector('#refreshWorkItemsBtn')?.addEventListener('click', () => {
      const btn = this.container.querySelector('#refreshWorkItemsBtn') as HTMLButtonElement;
      btn.disabled = true;
      btn.classList.add('loading');
      Promise.resolve(this.onRefreshCallback?.()).finally(() => {
        btn.disabled = false;
        btn.classList.remove('loading');
      });
    });

    this.container.querySelectorAll('.workitems-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = (btn as HTMLElement).dataset.view as WorkItemViewType;
        this.activeView = view;
        this.activeQueryId = null;
        this.updateActiveState();
        this.onRefreshCallback?.();
      });
    });

    this.container.querySelector('#showAllItemsCheckbox')?.addEventListener('change', (e) => {
      this.showAllItems = (e.target as HTMLInputElement).checked;
      const stateFilters = this.container.querySelector('#stateFilters');
      if (stateFilters) {
        stateFilters.classList.toggle('disabled', this.showAllItems);
      }
      this.onFilterChangeCallback?.();
    });

    this.container.querySelectorAll('[data-state]').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const state = (checkbox as HTMLElement).dataset.state!;
        const checked = (e.target as HTMLInputElement).checked;
        if (checked) {
          if (!this.excludedStates.includes(state)) this.excludedStates.push(state);
        } else {
          this.excludedStates = this.excludedStates.filter(s => s !== state);
        }
        this.onFilterChangeCallback?.();
      });
    });

    this.container.querySelector('#showAllTypesCheckbox')?.addEventListener('change', (e) => {
      this.showAllTypes = (e.target as HTMLInputElement).checked;
      const typeFilters = this.container.querySelector('#typeFilters');
      if (typeFilters) {
        typeFilters.classList.toggle('disabled', this.showAllTypes);
      }
      this.onFilterChangeCallback?.();
    });

    this.container.querySelectorAll('[data-type]').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const type = (checkbox as HTMLElement).dataset.type!;
        const checked = (e.target as HTMLInputElement).checked;
        if (checked) {
          if (!this.includedTypes.includes(type)) this.includedTypes.push(type);
        } else {
          this.includedTypes = this.includedTypes.filter(t => t !== type);
        }
        this.onFilterChangeCallback?.();
      });
    });

    this.container.querySelector('#newQueryBtn')?.addEventListener('click', () => {
      this.onNewQueryCallback?.();
    });

    this.container.querySelector('#importAdoQueryBtn')?.addEventListener('click', () => {
      this.onImportAdoQueryCallback?.();
    });
  }

  private updateActiveState() {
    this.container.querySelectorAll('.workitems-view-btn').forEach(btn => {
      const view = (btn as HTMLElement).dataset.view;
      btn.classList.toggle('active', view === this.activeView && !this.activeQueryId);
    });

    this.container.querySelectorAll('.workitems-query-btn').forEach(btn => {
      const queryId = (btn as HTMLElement).dataset.queryId;
      btn.classList.toggle('active', queryId === this.activeQueryId);
    });
  }

  setSubtitle(text: string) {
    const el = this.container.querySelector('.workitems-subtitle');
    if (el) el.textContent = text;
  }

  private renderTypeTabs() {
    const container = this.container.querySelector('#workItemsTypeTabs')!;

    if (!this.isGroupedMode || this.groupedItems.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="workitems-type-tab-bar">
        ${this.groupedItems.map(group => {
          const color = WORK_ITEM_TYPE_COLORS[group.type] || '#666';
          const isActive = group.type === this.activeTypeTab;
          const showing = Math.min(50, group.totalCount);
          return `
            <button class="workitems-type-tab ${isActive ? 'active' : ''}" data-type="${escapeHtml(group.type)}">
              <span class="workitems-type-dot" style="background-color: ${color}"></span>
              <span>${escapeHtml(group.type)}</span>
              <span class="workitems-type-tab-count">${showing}/${group.totalCount}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.workitems-type-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeTypeTab = (tab as HTMLElement).dataset.type!;
        this.renderTypeTabs();
        this.renderWorkItemsList();
      });
    });
  }

  private renderQueriesList() {
    const container = this.container.querySelector('#queriesList')!;

    if (this.savedQueries.length === 0) {
      container.innerHTML = `
        <div class="workitems-queries-empty">
          <p>No saved queries</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.savedQueries.map(query => {
      const isAdoQuery = !!query.adoQueryId;
      const iconSvg = isAdoQuery ? getIcon(Cloud, 14) : getIcon(Search, 14);

      return `
      <div class="workitems-query-item ${query.id === this.activeQueryId ? 'active' : ''} ${isAdoQuery ? 'ado-query' : ''}" data-query-id="${query.id}">
        <button class="workitems-query-btn" data-query-id="${query.id}" ${isAdoQuery ? 'title="Imported from Azure DevOps"' : ''}>
          ${iconSvg}
          <span class="query-name">${escapeHtml(query.name)}</span>
        </button>
        <div class="workitems-query-actions">
          ${!isAdoQuery ? `
          <button class="btn btn-icon btn-small" data-action="edit" data-query-id="${query.id}" title="Edit">
            ${getIcon(Edit, 12)}
          </button>
          ` : ''}
          <button class="btn btn-icon btn-small btn-danger" data-action="delete" data-query-id="${query.id}" title="Delete">
            ${getIcon(Trash2, 12)}
          </button>
        </div>
      </div>
    `;
    }).join('');

    container.querySelectorAll('.workitems-query-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const queryId = (btn as HTMLElement).dataset.queryId!;
        const query = this.savedQueries.find(q => q.id === queryId);
        if (query) {
          this.activeView = 'custom';
          this.activeQueryId = queryId;
          this.updateActiveState();
          this.onRunQueryCallback?.(query);
        }
      });
    });

    container.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const queryId = (btn as HTMLElement).dataset.queryId!;
        const query = this.savedQueries.find(q => q.id === queryId);
        if (query) {
          this.onEditQueryCallback?.(query);
        }
      });
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const queryId = (btn as HTMLElement).dataset.queryId!;
        if (confirm('Delete this query?')) {
          this.onDeleteQueryCallback?.(queryId);
        }
      });
    });
  }

  private renderWorkItemsList() {
    const container = this.container.querySelector('#workItemsList')!;

    if (this.loading) {
      container.innerHTML = `
        <div class="workitems-loading">
          <div class="loading-spinner"></div>
          <p>Loading work items...</p>
        </div>
      `;
      return;
    }

    if (this.activeView === 'active' && (!this.activeTypeTab || !this.groupedItems.find(g => g.type === this.activeTypeTab))) {
      this.renderActiveViewContent(container);
      return;
    }

    const items = this.isGroupedMode
      ? (this.groupedItems.find(g => g.type === this.activeTypeTab)?.items || [])
      : this.workItems;

    if (items.length === 0) {
      container.innerHTML = `
        <div class="workitems-empty">
          ${getIcon(LayoutGrid, 48)}
          <p>No work items found</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(item => this.renderWorkItemCard(item)).join('');

    container.querySelectorAll('.workitem-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[data-action="open-ado"]')) return;
        const itemId = parseInt((card as HTMLElement).dataset.itemId || '0');
        const item = items.find(i => i.id === itemId);
        if (item) {
          this.onSelectCallback?.(item);
        }
      });
    });

    container.querySelectorAll('[data-action="open-ado"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = (btn as HTMLElement).closest('.workitem-card') as HTMLElement;
        const itemId = parseInt(card?.dataset.itemId || '0');
        const item = items.find(i => i.id === itemId);
        if (item) {
          this.onOpenInAdoCallback?.(item);
        }
      });
    });
  }

  private loadActiveOrder(): string[] {
    try {
      const raw = localStorage.getItem(ACTIVE_ORDER_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  private saveActiveOrder(order: string[]) {
    try { localStorage.setItem(ACTIVE_ORDER_KEY, JSON.stringify(order)); } catch {}
  }

  private buildMergedActiveItems(): Array<{ kind: 'wi' | 'icm'; key: string; sortDate: number; wi?: WorkItem; icm?: any }> {
    const allWi = this.groupedItems.flatMap(g => g.items);
    const items: Array<{ kind: 'wi' | 'icm'; key: string; sortDate: number; wi?: WorkItem; icm?: any }> = [
      ...allWi.map(wi => ({
        kind: 'wi' as const,
        key: `wi-${wi.id}`,
        sortDate: new Date(wi.fields['System.ChangedDate'] || 0).getTime(),
        wi,
      })),
      ...this.activeIncidents.map(icm => ({
        kind: 'icm' as const,
        key: `icm-${icm.Id}`,
        sortDate: new Date(icm.LastModifiedDate || icm.CreatedDate || 0).getTime(),
        icm,
      })),
    ];

    // Apply saved order: items in saved order come first in that sequence,
    // new items (not in saved order) are appended sorted by date desc.
    const savedOrder = this.activeItemOrder;
    const savedSet = new Set(savedOrder);
    const inOrder = savedOrder
      .map(key => items.find(i => i.key === key))
      .filter(Boolean) as typeof items;
    const notInOrder = items
      .filter(i => !savedSet.has(i.key))
      .sort((a, b) => b.sortDate - a.sortDate);

    return [...inOrder, ...notInOrder];
  }

  private renderActiveViewContent(container: Element) {
    const merged = this.buildMergedActiveItems();

    if (merged.length === 0) {
      container.innerHTML = `
        <div class="workitems-empty">
          ${getIcon(Activity, 48)}
          <p>No active items</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="active-unified-list" id="activeUnifiedList">
        ${merged.map(item => item.kind === 'wi'
          ? this.renderWorkItemCard(item.wi!, true)
          : this.renderIcmIncidentCard(item.icm!, true)
        ).join('')}
      </div>
    `;

    const list = container.querySelector('#activeUnifiedList')!;

    // Click handlers
    list.querySelectorAll('.workitem-card[data-item-id]').forEach(card => {
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[data-action="open-ado"]')) return;
        const itemId = parseInt((card as HTMLElement).dataset.itemId || '0');
        const wi = merged.find(i => i.kind === 'wi' && i.wi!.id === itemId)?.wi;
        if (wi) this.onSelectCallback?.(wi);
      });
    });

    list.querySelectorAll('[data-action="open-ado"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = (btn as HTMLElement).closest('.workitem-card') as HTMLElement;
        const itemId = parseInt(card?.dataset.itemId || '0');
        const wi = merged.find(i => i.kind === 'wi' && i.wi!.id === itemId)?.wi;
        if (wi) this.onOpenInAdoCallback?.(wi);
      });
    });

    list.querySelectorAll('[data-action="open-icm"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = (btn as HTMLElement).closest('.workitem-card') as HTMLElement;
        const icmId = card?.dataset.icmId;
        if (icmId) {
          const url = `https://portal.microsofticm.com/imp/v3/incidents/details/${icmId}/home`;
          window.electronAPI.openExternal(url);
        }
      });
    });

    // Drag-and-drop
    this.attachDragAndDrop(list as HTMLElement, merged);
  }

  private attachDragAndDrop(list: HTMLElement, merged: Array<{ key: string }>) {
    list.querySelectorAll<HTMLElement>('.active-item-wrapper').forEach(wrapper => {
      wrapper.addEventListener('mousedown', (e) => {
        // Don't drag from buttons or interactive elements
        if ((e.target as HTMLElement).closest('button, a, input')) return;

        const dragKey = wrapper.dataset.activeKey!;
        const wrapperRect = wrapper.getBoundingClientRect();
        const startY = e.clientY;

        let ghost: HTMLElement | null = null;
        let dragStarted = false;
        let currentDropKey: string | null = null;
        let insertBefore = true;
        const placeholder = document.createElement('div');
        placeholder.className = 'active-drag-placeholder';

        const onMouseMove = (mv: MouseEvent) => {
          if (!dragStarted && Math.abs(mv.clientY - startY) > 5) {
            dragStarted = true;
            ghost = wrapper.cloneNode(true) as HTMLElement;
            ghost.style.cssText = [
              'position:fixed',
              'pointer-events:none',
              'z-index:9999',
              `width:${wrapperRect.width}px`,
              'opacity:0.85',
              'transform:rotate(1.5deg) scale(1.02)',
              'box-shadow:0 8px 24px rgba(0,0,0,0.25)',
              `left:${wrapperRect.left}px`,
              `top:${wrapperRect.top}px`,
              'transition:none',
            ].join(';');
            document.body.appendChild(ghost);
            wrapper.classList.add('dragging');
          }

          if (!dragStarted) return;

          const offsetY = mv.clientY - wrapperRect.top - wrapperRect.height / 2;
          ghost!.style.top = `${wrapperRect.top + offsetY}px`;

          const siblings = Array.from(
            list.querySelectorAll<HTMLElement>('.active-item-wrapper:not(.dragging)')
          );
          placeholder.remove();
          currentDropKey = null;

          for (const sib of siblings) {
            const r = sib.getBoundingClientRect();
            if (mv.clientY <= r.bottom) {
              insertBefore = mv.clientY < r.top + r.height / 2;
              currentDropKey = sib.dataset.activeKey!;
              insertBefore ? sib.before(placeholder) : sib.after(placeholder);
              break;
            }
          }

          if (!currentDropKey && siblings.length) {
            const last = siblings[siblings.length - 1];
            currentDropKey = last.dataset.activeKey!;
            insertBefore = false;
            last.after(placeholder);
          }
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          ghost?.remove();
          placeholder.remove();
          wrapper.classList.remove('dragging');

          if (!dragStarted || !currentDropKey || currentDropKey === dragKey) return;

          const order = merged.map(i => i.key);
          const fromIdx = order.indexOf(dragKey);
          order.splice(fromIdx, 1);
          const toIdx = order.indexOf(currentDropKey);
          order.splice(insertBefore ? toIdx : toIdx + 1, 0, dragKey);

          this.activeItemOrder = order;
          this.saveActiveOrder(order);
          this.renderWorkItemsList();
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });
  }

  private renderIcmIncidentCard(inc: any, draggable = false): string {
    const severityColors: Record<number, string> = { 1: '#d13438', 2: '#ff8c00', 3: '#ffaa44', 4: '#498205', 25: '#ff8c00' };
    const stateColors: Record<string, string> = { Active: '#d13438', Mitigated: '#ff8c00', Resolved: '#498205' };
    const sevColor = severityColors[inc.Severity] || '#666';
    const stateColor = stateColors[inc.State] || '#666';
    const timeAgo = inc.LastModifiedDate ? formatTimeAgo(new Date(inc.LastModifiedDate))
      : inc.CreatedDate ? formatTimeAgo(new Date(inc.CreatedDate)) : '';

    const card = `
      <div class="workitem-card icm-incident-card" data-icm-id="${inc.Id}">
        ${draggable ? `<span class="active-drag-handle" title="Drag to reorder">${getIcon(GripVertical, 14)}</span>` : ''}
        <div class="workitem-card-header">
          <button class="workitem-open-icm-btn" data-action="open-icm" title="Open in ICM">
            ${getIcon(ExternalLink, 13)}
            Open in ICM
          </button>
          <span class="workitem-type-badge" style="background-color:${sevColor}">Sev ${inc.Severity}</span>
          <span class="workitem-id">${inc.Id}</span>
          <span class="workitem-state-badge" style="background-color:${stateColor}">${escapeHtml(inc.State || '')}</span>
        </div>
        <div class="workitem-card-title">${escapeHtml(inc.Title || 'Untitled')}</div>
        <div class="workitem-card-meta">
          <span class="workitem-assigned">
            <span class="workitem-assigned-name">${escapeHtml(inc.OwningTeamName || inc.OwningTenantName || '')}</span>
          </span>
          ${timeAgo ? `<span class="workitem-time">${timeAgo}</span>` : ''}
        </div>
      </div>
    `;

    return draggable
      ? `<div class="active-item-wrapper" data-active-key="icm-${inc.Id}">${card}</div>`
      : card;
  }

  private renderWorkItemCard(item: WorkItem, draggable = false): string {
    const fields = item.fields;
    const type = fields['System.WorkItemType'] || 'Task';
    const state = fields['System.State'] || 'New';
    const title = fields['System.Title'] || 'Untitled';
    const assignedTo = fields['System.AssignedTo'];
    const changedDate = fields['System.ChangedDate'];
    const tags = fields['System.Tags'];
    const priority = fields['Microsoft.VSTS.Common.Priority'];

    const typeColor = WORK_ITEM_TYPE_COLORS[type] || '#666';
    const stateColor = WORK_ITEM_STATE_COLORS[state] || '#666';
    const timeAgo = changedDate ? formatTimeAgo(new Date(changedDate)) : '';

    const assignedHtml = assignedTo ? `
      <span class="workitem-assigned">
        ${assignedTo.imageUrl ? `<img src="${assignedTo.imageUrl}" alt="" class="workitem-avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
        <span class="workitem-avatar-placeholder" ${assignedTo.imageUrl ? 'style="display:none"' : ''}>${this.getInitials(assignedTo.displayName)}</span>
        <span class="workitem-assigned-name">${escapeHtml(assignedTo.displayName)}</span>
      </span>
    ` : '';

    const tagsHtml = tags ? `
      <div class="workitem-tags">
        ${tags.split(';').slice(0, 3).map(tag => `<span class="workitem-tag">${escapeHtml(tag.trim())}</span>`).join('')}
        ${tags.split(';').length > 3 ? `<span class="workitem-tag-more">+${tags.split(';').length - 3}</span>` : ''}
      </div>
    ` : '';

    const priorityHtml = priority ? `<span class="workitem-priority priority-${priority}" title="Priority ${priority}">${priority}</span>` : '';

    const card = `
      <div class="workitem-card" data-item-id="${item.id}">
        ${draggable ? `<span class="active-drag-handle" title="Drag to reorder">${getIcon(GripVertical, 14)}</span>` : ''}
        <div class="workitem-card-header">
          <button class="workitem-open-ado-btn" data-action="open-ado" title="Open in ADO">
            ${getIcon(ExternalLink, 13)}
          </button>
          <span class="workitem-type-badge" style="background-color: ${typeColor}">${escapeHtml(type)}</span>
          <span class="workitem-id">${item.id}</span>
          ${priorityHtml}
          <span class="workitem-state-badge" style="background-color: ${stateColor}">${escapeHtml(state)}</span>
        </div>
        <div class="workitem-card-title">${escapeHtml(title)}</div>
        <div class="workitem-card-meta">
          ${assignedHtml}
          ${timeAgo ? `<span class="workitem-time">${timeAgo}</span>` : ''}
        </div>
        ${tagsHtml}
      </div>
    `;

    return draggable
      ? `<div class="active-item-wrapper" data-active-key="wi-${item.id}">${card}</div>`
      : card;
  }

  private getInitials(name: string): string {
    const parts = name.split(/[\s\\]+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

}
