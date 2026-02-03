import type { WorkItem, SavedQuery } from '../../shared/workitem-types.js';
import { WORK_ITEM_TYPE_COLORS, WORK_ITEM_STATE_COLORS } from '../../shared/workitem-types.js';
import { escapeHtml, formatTimeAgo } from '../utils/html-utils.js';
import { getIcon, RefreshCw, User, Plus, Download, Search, Edit, Trash2, LayoutGrid, Cloud } from '../utils/icons.js';

export type WorkItemViewType = 'assigned' | 'created' | 'custom';

export class WorkItemsListView {
  private container: HTMLElement;
  private workItems: WorkItem[] = [];
  private savedQueries: SavedQuery[] = [];
  private activeView: WorkItemViewType = 'assigned';
  private activeQueryId: string | null = null;
  private loading = false;

  private onSelectCallback: ((item: WorkItem) => void) | null = null;
  private onRefreshCallback: (() => void) | null = null;
  private onNewQueryCallback: (() => void) | null = null;
  private onImportAdoQueryCallback: (() => void) | null = null;
  private onEditQueryCallback: ((query: SavedQuery) => void) | null = null;
  private onDeleteQueryCallback: ((queryId: string) => void) | null = null;
  private onRunQueryCallback: ((query: SavedQuery) => void) | null = null;

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

  setWorkItems(items: WorkItem[]) {
    this.workItems = items;
    this.loading = false;
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
              <button class="workitems-view-btn active" data-view="assigned">
                ${getIcon(User, 16)}
                Assigned to Me
              </button>
              <button class="workitems-view-btn" data-view="created">
                ${getIcon(Plus, 16)}
                Created by Me
              </button>
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
            <div class="workitems-list" id="workItemsList"></div>
          </main>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.renderQueriesList();
    this.renderWorkItemsList();
  }

  private attachEventListeners() {
    // Refresh button
    this.container.querySelector('#refreshWorkItemsBtn')?.addEventListener('click', () => {
      this.onRefreshCallback?.();
    });

    // View buttons
    this.container.querySelectorAll('.workitems-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = (btn as HTMLElement).dataset.view as WorkItemViewType;
        this.activeView = view;
        this.activeQueryId = null;
        this.updateActiveState();
        this.onRefreshCallback?.();
      });
    });

    // New query button
    this.container.querySelector('#newQueryBtn')?.addEventListener('click', () => {
      this.onNewQueryCallback?.();
    });

    // Import from ADO button
    this.container.querySelector('#importAdoQueryBtn')?.addEventListener('click', () => {
      this.onImportAdoQueryCallback?.();
    });
  }

  private updateActiveState() {
    // Update view buttons
    this.container.querySelectorAll('.workitems-view-btn').forEach(btn => {
      const view = (btn as HTMLElement).dataset.view;
      btn.classList.toggle('active', view === this.activeView && !this.activeQueryId);
    });

    // Update query buttons
    this.container.querySelectorAll('.workitems-query-btn').forEach(btn => {
      const queryId = (btn as HTMLElement).dataset.queryId;
      btn.classList.toggle('active', queryId === this.activeQueryId);
    });
  }

  setSubtitle(text: string) {
    const el = this.container.querySelector('.workitems-subtitle');
    if (el) el.textContent = text;
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
      const iconSvg = isAdoQuery
        ? getIcon(Cloud, 14)
        : getIcon(Search, 14);

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

    // Attach event listeners for query items
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

    if (this.workItems.length === 0) {
      container.innerHTML = `
        <div class="workitems-empty">
          ${getIcon(LayoutGrid, 48)}
          <p>No work items found</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.workItems.map(item => this.renderWorkItemCard(item)).join('');

    // Attach click handlers
    container.querySelectorAll('.workitem-card').forEach(card => {
      card.addEventListener('click', () => {
        const itemId = parseInt((card as HTMLElement).dataset.itemId || '0');
        const item = this.workItems.find(i => i.id === itemId);
        if (item) {
          this.onSelectCallback?.(item);
        }
      });
    });
  }

  private renderWorkItemCard(item: WorkItem): string {
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

    return `
      <div class="workitem-card" data-item-id="${item.id}">
        <div class="workitem-card-header">
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
  }

  private getInitials(name: string): string {
    const parts = name.split(/[\s\\]+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

}
