import type { IcmIncidentListItem, IcmFavoriteQuery, IcmQuery, IcmContact } from '../../shared/icm-types.js';
import { ICM_SEVERITY_COLORS, ICM_STATE_COLORS } from '../../shared/icm-types.js';
import { escapeHtml, formatTimeAgo } from '../utils/html-utils.js';
import { getIcon, RefreshCw, Star, Search, AlertTriangle, User, Users, ChevronDown, ChevronRight, Eye, Lock, Globe, Folder, ArrowUp, ArrowDown } from '../utils/icons.js';

export type IcmViewType = 'myIncidents' | 'myTeams' | 'myServices' | 'myTracked' | 'myRestricted' | 'active' | 'favorite' | 'saved' | 'shared';

export interface IcmSharedQueryGroup {
  serviceName: string;
  serviceId: number;
  queries: IcmQuery[];
}

export class IcmIncidentsListView {
  private container: HTMLElement;
  private incidents: IcmIncidentListItem[] = [];
  private favoriteQueries: IcmFavoriteQuery[] = [];
  private savedQueries: IcmQuery[] = [];
  private sharedQueryGroups: IcmSharedQueryGroup[] = [];
  private currentUser: IcmContact | null = null;
  private activeView: IcmViewType = 'myIncidents';
  private activeQueryId: string | null = null;
  private favoritesExpanded = true;
  private savedExpanded = true;
  private sharedExpanded = false;
  private sharedServiceExpanded = new Map<number, boolean>();
  private savedFolderExpanded = new Map<string, boolean>();
  private loading = false;

  // Sort / Filter / Group state
  private sortField: 'Severity' | 'CreatedDate' | 'Id' | 'HitCount' | 'State' = 'CreatedDate';
  private sortAsc = false;
  private filterSeverities = new Set<number>(); // empty = all
  private filterStates = new Set<string>(); // empty = all
  private filterCI = false;
  private filterOutage = false;
  private groupBy: 'none' | 'Severity' | 'State' | 'Owner' | 'Team' | 'Service' = 'Team';

  private onSelectCallback: ((incident: IcmIncidentListItem) => void) | null = null;
  private onRefreshCallback: (() => void) | null = null;
  private onOpenByIdCallback: ((id: number) => void) | null = null;
  private onViewChangeCallback: ((view: IcmViewType, queryId?: string) => void) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
  }

  onSelect(callback: (incident: IcmIncidentListItem) => void) {
    this.onSelectCallback = callback;
  }

  onRefresh(callback: () => void) {
    this.onRefreshCallback = callback;
  }

  onOpenById(callback: (id: number) => void) {
    this.onOpenByIdCallback = callback;
  }

  onViewChange(callback: (view: IcmViewType, queryId?: string) => void) {
    this.onViewChangeCallback = callback;
  }

  setIncidents(items: IcmIncidentListItem[]) {
    this.incidents = items;
    this.loading = false;
    this.renderIncidentsList();
  }

  setFavoriteQueries(queries: IcmFavoriteQuery[]) {
    this.favoriteQueries = queries;
    this.renderQueriesList();
  }

  setSavedQueries(queries: IcmQuery[]) {
    this.savedQueries = queries;
    this.renderQueriesList();
  }

  setSharedQueries(groups: IcmSharedQueryGroup[]) {
    this.sharedQueryGroups = groups;
    this.renderQueriesList();
  }

  setCurrentUser(user: IcmContact) {
    this.currentUser = user;
  }

  setLoading(loading: boolean) {
    this.loading = loading;
    this.renderIncidentsList();
  }

  setActiveView(view: IcmViewType, queryId?: string) {
    this.activeView = view;
    this.activeQueryId = queryId || null;
    this.updateActiveState();
  }

  getActiveView(): IcmViewType {
    return this.activeView;
  }

  getActiveQueryId(): string | null {
    return this.activeQueryId;
  }

  setSubtitle(text: string) {
    const el = this.container.querySelector('.icm-subtitle');
    if (el) el.textContent = text;
  }

  private render() {
    this.container.innerHTML = `
      <div class="icm-list-view">
        <header class="icm-header">
          <div class="icm-title">
            <h1>ICM Incidents</h1>
            <span class="icm-subtitle">Loading...</span>
          </div>
          <button class="btn btn-secondary" id="refreshIcmBtn">
            ${getIcon(RefreshCw, 16)}
            Refresh
          </button>
        </header>

        <div class="icm-layout">
          <!-- Left sidebar with views and queries -->
          <aside class="icm-sidebar">
            <div class="icm-open-by-id">
              <h3>Open Incident</h3>
              <div class="icm-open-by-id-form">
                <input type="text" id="icmOpenByIdInput" class="form-input" placeholder="ID or URL...">
                <button class="btn btn-primary btn-small" id="icmOpenByIdBtn">Go</button>
              </div>
            </div>

            <div class="icm-views">
              <button class="icm-view-btn active" data-view="myIncidents">
                ${getIcon(User, 16)}
                My Incidents
              </button>
              <button class="icm-view-btn" data-view="myTeams">
                ${getIcon(Users, 16)}
                My Teams' Incidents
              </button>
              <button class="icm-view-btn" data-view="myServices">
                ${getIcon(Globe, 16)}
                My Services' Incidents
              </button>
              <button class="icm-view-btn" data-view="myTracked">
                ${getIcon(Eye, 16)}
                My Tracked Incidents
              </button>
              <button class="icm-view-btn" data-view="myRestricted">
                ${getIcon(Lock, 16)}
                My Restricted Incidents
              </button>
              <button class="icm-view-btn" data-view="active">
                ${getIcon(Search, 16)}
                All Active
              </button>
            </div>

            <div class="icm-queries" id="icmQueriesSection">
              <div class="icm-queries-group" id="icmFavoriteQueriesGroup" style="display:none">
                <div class="icm-queries-group-header" id="icmFavoriteToggle">
                  <span class="icm-toggle-icon">${getIcon(ChevronDown, 12)}</span>
                  <h3>My Favorites</h3>
                </div>
                <div class="icm-queries-list" id="icmFavoriteQueriesList"></div>
              </div>
              <div class="icm-queries-group" id="icmSavedQueriesGroup" style="display:none">
                <div class="icm-queries-group-header" id="icmSavedToggle">
                  <span class="icm-toggle-icon">${getIcon(ChevronDown, 12)}</span>
                  <h3>My Queries</h3>
                </div>
                <div class="icm-queries-list" id="icmSavedQueriesList"></div>
              </div>
              <div class="icm-queries-group" id="icmSharedQueriesGroup" style="display:none">
                <div class="icm-queries-group-header" id="icmSharedToggle">
                  <span class="icm-toggle-icon">${getIcon(ChevronRight, 12)}</span>
                  <h3>Shared Queries</h3>
                </div>
                <div class="icm-queries-list" id="icmSharedQueriesList"></div>
              </div>
            </div>
          </aside>

          <!-- Main content area with incidents -->
          <main class="icm-main">
            <div class="icm-toolbar" id="icmToolbar">
              <div class="icm-toolbar-group">
                <label>Sort</label>
                <select id="icmSortField" class="icm-toolbar-select">
                  <option value="CreatedDate">Date</option>
                  <option value="Severity">Severity</option>
                  <option value="Id">ID</option>
                  <option value="HitCount">Hits</option>
                  <option value="State">State</option>
                </select>
                <button class="icm-toolbar-btn" id="icmSortDir" title="Toggle sort direction">
                  ${getIcon(ArrowDown, 12)}
                </button>
              </div>
              <div class="icm-toolbar-sep"></div>
              <div class="icm-toolbar-group">
                <label>Sev</label>
                <div class="icm-filter-chips" id="icmSevChips">
                  <button class="icm-chip" data-sev="1">1</button>
                  <button class="icm-chip" data-sev="2">2</button>
                  <button class="icm-chip" data-sev="25">2.5</button>
                  <button class="icm-chip" data-sev="3">3</button>
                  <button class="icm-chip" data-sev="4">4</button>
                </div>
              </div>
              <div class="icm-toolbar-sep"></div>
              <div class="icm-toolbar-group">
                <label>State</label>
                <div class="icm-filter-chips" id="icmStateChips">
                  <button class="icm-chip" data-state="Active">Active</button>
                  <button class="icm-chip" data-state="Mitigated">Mitigated</button>
                  <button class="icm-chip" data-state="Resolved">Resolved</button>
                </div>
              </div>
              <div class="icm-toolbar-sep"></div>
              <div class="icm-toolbar-group">
                <label>Flags</label>
                <div class="icm-filter-chips">
                  <button class="icm-chip" id="icmFilterCI">CI</button>
                  <button class="icm-chip" id="icmFilterOutage">Outage</button>
                </div>
              </div>
              <div class="icm-toolbar-sep"></div>
              <div class="icm-toolbar-group">
                <label>Group</label>
                <select id="icmGroupBy" class="icm-toolbar-select">
                  <option value="none">None</option>
                  <option value="Severity">Severity</option>
                  <option value="State">State</option>
                  <option value="Owner">Owner</option>
                  <option value="Team" selected>Owning Team</option>
                  <option value="Service">Owning Service</option>
                </select>
              </div>
              <span class="icm-toolbar-count" id="icmFilterCount"></span>
            </div>
            <div class="icm-incidents-list" id="icmIncidentsList"></div>
          </main>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.renderQueriesList();
    this.renderIncidentsList();
  }

  private attachEventListeners() {
    // Refresh button
    this.container.querySelector('#refreshIcmBtn')?.addEventListener('click', () => {
      this.onRefreshCallback?.();
    });

    // View buttons
    this.container.querySelectorAll('.icm-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = (btn as HTMLElement).dataset.view as IcmViewType;
        this.activeView = view;
        this.activeQueryId = null;
        this.updateActiveState();
        this.onViewChangeCallback?.(view);
        this.onRefreshCallback?.();
      });
    });

    // Open by ID
    const openByIdInput = this.container.querySelector('#icmOpenByIdInput') as HTMLInputElement;
    const openByIdBtn = this.container.querySelector('#icmOpenByIdBtn');

    const doOpenById = () => {
      const value = openByIdInput?.value.trim();
      if (!value) return;

      // Extract ID from URL or plain number
      let id: number;
      const urlMatch = value.match(/incidents\/(\d+)/i);
      if (urlMatch) {
        id = parseInt(urlMatch[1]);
      } else {
        id = parseInt(value);
      }

      if (!isNaN(id) && id > 0) {
        this.onOpenByIdCallback?.(id);
        openByIdInput.value = '';
      }
    };

    openByIdBtn?.addEventListener('click', doOpenById);
    openByIdInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') doOpenById();
    });

    // Collapsible query group toggles
    this.container.querySelector('#icmFavoriteToggle')?.addEventListener('click', () => {
      this.favoritesExpanded = !this.favoritesExpanded;
      const list = this.container.querySelector('#icmFavoriteQueriesList') as HTMLElement;
      const icon = this.container.querySelector('#icmFavoriteToggle .icm-toggle-icon');
      if (list) list.style.display = this.favoritesExpanded ? '' : 'none';
      if (icon) icon.innerHTML = this.favoritesExpanded ? getIcon(ChevronDown, 12) : getIcon(ChevronRight, 12);
    });
    this.container.querySelector('#icmSavedToggle')?.addEventListener('click', () => {
      this.savedExpanded = !this.savedExpanded;
      const list = this.container.querySelector('#icmSavedQueriesList') as HTMLElement;
      const icon = this.container.querySelector('#icmSavedToggle .icm-toggle-icon');
      if (list) list.style.display = this.savedExpanded ? '' : 'none';
      if (icon) icon.innerHTML = this.savedExpanded ? getIcon(ChevronDown, 12) : getIcon(ChevronRight, 12);
    });
    this.container.querySelector('#icmSharedToggle')?.addEventListener('click', () => {
      this.sharedExpanded = !this.sharedExpanded;
      const list = this.container.querySelector('#icmSharedQueriesList') as HTMLElement;
      const icon = this.container.querySelector('#icmSharedToggle .icm-toggle-icon');
      if (list) list.style.display = this.sharedExpanded ? '' : 'none';
      if (icon) icon.innerHTML = this.sharedExpanded ? getIcon(ChevronDown, 12) : getIcon(ChevronRight, 12);
    });

    // Toolbar: sort field
    this.container.querySelector('#icmSortField')?.addEventListener('change', (e) => {
      this.sortField = (e.target as HTMLSelectElement).value as any;
      this.renderIncidentsList();
    });

    // Toolbar: sort direction toggle
    this.container.querySelector('#icmSortDir')?.addEventListener('click', () => {
      this.sortAsc = !this.sortAsc;
      const btn = this.container.querySelector('#icmSortDir');
      if (btn) btn.innerHTML = getIcon(this.sortAsc ? ArrowUp : ArrowDown, 12);
      this.renderIncidentsList();
    });

    // Toolbar: severity chips
    this.container.querySelectorAll('#icmSevChips .icm-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const sev = parseInt((chip as HTMLElement).dataset.sev || '0');
        if (this.filterSeverities.has(sev)) this.filterSeverities.delete(sev);
        else this.filterSeverities.add(sev);
        chip.classList.toggle('active', this.filterSeverities.has(sev));
        this.renderIncidentsList();
      });
    });

    // Toolbar: state chips
    this.container.querySelectorAll('#icmStateChips .icm-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const state = (chip as HTMLElement).dataset.state!;
        if (this.filterStates.has(state)) this.filterStates.delete(state);
        else this.filterStates.add(state);
        chip.classList.toggle('active', this.filterStates.has(state));
        this.renderIncidentsList();
      });
    });

    // Toolbar: CI / Outage flag filters
    this.container.querySelector('#icmFilterCI')?.addEventListener('click', () => {
      this.filterCI = !this.filterCI;
      this.container.querySelector('#icmFilterCI')?.classList.toggle('active', this.filterCI);
      this.renderIncidentsList();
    });
    this.container.querySelector('#icmFilterOutage')?.addEventListener('click', () => {
      this.filterOutage = !this.filterOutage;
      this.container.querySelector('#icmFilterOutage')?.classList.toggle('active', this.filterOutage);
      this.renderIncidentsList();
    });

    // Toolbar: group by
    this.container.querySelector('#icmGroupBy')?.addEventListener('change', (e) => {
      this.groupBy = (e.target as HTMLSelectElement).value as any;
      this.renderIncidentsList();
    });
  }

  private updateActiveState() {
    // Update view buttons
    this.container.querySelectorAll('.icm-view-btn').forEach(btn => {
      const view = (btn as HTMLElement).dataset.view;
      btn.classList.toggle('active', view === this.activeView && !this.activeQueryId);
    });

    // Update query buttons
    this.container.querySelectorAll('.icm-query-btn').forEach(btn => {
      const queryId = (btn as HTMLElement).dataset.queryId;
      btn.classList.toggle('active', queryId === this.activeQueryId);
    });
  }

  private renderQueriesList() {
    // Favorite queries
    const favContainer = this.container.querySelector('#icmFavoriteQueriesList');
    const favGroup = this.container.querySelector('#icmFavoriteQueriesGroup') as HTMLElement;

    if (favContainer && favGroup) {
      if (this.favoriteQueries.length > 0) {
        favGroup.style.display = '';
        favContainer.innerHTML = this.favoriteQueries.map(fq => `
          <button class="icm-query-btn ${String(fq.Query.QueryId) === this.activeQueryId ? 'active' : ''}" data-query-id="${fq.Query.QueryId}" data-query-type="favorite">
            ${getIcon(Star, 14)}
            <span class="query-name">${escapeHtml(fq.Query.Name)}</span>
          </button>
        `).join('');
      } else {
        favGroup.style.display = 'none';
      }
    }

    // Saved queries — grouped by folder
    const savedContainer = this.container.querySelector('#icmSavedQueriesList');
    const savedGroup = this.container.querySelector('#icmSavedQueriesGroup') as HTMLElement;

    if (savedContainer && savedGroup) {
      if (this.savedQueries.length > 0) {
        savedGroup.style.display = '';

        // Group by Folder
        const folderMap = new Map<string, IcmQuery[]>();
        for (const q of this.savedQueries) {
          const folder = q.Folder || 'Default';
          if (!folderMap.has(folder)) folderMap.set(folder, []);
          folderMap.get(folder)!.push(q);
        }

        if (folderMap.size === 1) {
          // Single folder — render flat (no folder headers)
          savedContainer.innerHTML = this.savedQueries.map(q => `
            <button class="icm-query-btn ${String(q.QueryId) === this.activeQueryId ? 'active' : ''}" data-query-id="${q.QueryId}" data-query-type="saved">
              ${getIcon(Search, 14)}
              <span class="query-name">${escapeHtml(q.Name)}</span>
            </button>
          `).join('');
        } else {
          // Multiple folders — render as tree
          const folders = Array.from(folderMap.keys()).sort();
          savedContainer.innerHTML = folders.map(folder => {
            const queries = folderMap.get(folder)!;
            const expanded = this.savedFolderExpanded.get(folder) ?? true;
            return `
              <div class="icm-tree-node">
                <div class="icm-tree-node-header" data-saved-folder="${escapeHtml(folder)}">
                  <span class="icm-toggle-icon">${getIcon(expanded ? ChevronDown : ChevronRight, 12)}</span>
                  ${getIcon(Folder, 14)}
                  <span class="icm-tree-node-label">${escapeHtml(folder)}</span>
                  <span class="icm-tree-node-count">${queries.length}</span>
                </div>
                <div class="icm-tree-node-children" style="${expanded ? '' : 'display:none'}">
                  ${queries.map(q => `
                    <button class="icm-query-btn ${String(q.QueryId) === this.activeQueryId ? 'active' : ''}" data-query-id="${q.QueryId}" data-query-type="saved">
                      ${getIcon(Search, 14)}
                      <span class="query-name">${escapeHtml(q.Name)}</span>
                    </button>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('');
        }
      } else {
        savedGroup.style.display = 'none';
      }
    }

    // Shared queries — tree view grouped by service
    const sharedContainer = this.container.querySelector('#icmSharedQueriesList') as HTMLElement;
    const sharedGroup = this.container.querySelector('#icmSharedQueriesGroup') as HTMLElement;

    if (sharedContainer && sharedGroup) {
      if (this.sharedQueryGroups.length > 0) {
        sharedGroup.style.display = '';
        sharedContainer.style.display = this.sharedExpanded ? '' : 'none';
        sharedContainer.innerHTML = this.sharedQueryGroups.map(group => {
          const expanded = this.sharedServiceExpanded.get(group.serviceId) ?? false;
          return `
            <div class="icm-tree-node">
              <div class="icm-tree-node-header" data-service-id="${group.serviceId}">
                <span class="icm-toggle-icon">${getIcon(expanded ? ChevronDown : ChevronRight, 12)}</span>
                ${getIcon(Folder, 14)}
                <span class="icm-tree-node-label">${escapeHtml(group.serviceName)}</span>
                <span class="icm-tree-node-count">${group.queries.length}</span>
              </div>
              <div class="icm-tree-node-children" style="${expanded ? '' : 'display:none'}">
                ${group.queries.map(q => `
                  <button class="icm-query-btn ${String(q.QueryId) === this.activeQueryId ? 'active' : ''}" data-query-id="${q.QueryId}" data-query-type="shared">
                    ${getIcon(Search, 14)}
                    <span class="query-name">${escapeHtml(q.Name)}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          `;
        }).join('');
      } else {
        sharedGroup.style.display = 'none';
      }
    }

    // Attach click handlers for tree node toggles (shared query service groups)
    this.container.querySelectorAll('.icm-tree-node-header[data-service-id]').forEach(header => {
      header.addEventListener('click', () => {
        const serviceId = parseInt((header as HTMLElement).dataset.serviceId || '0');
        const expanded = !(this.sharedServiceExpanded.get(serviceId) ?? false);
        this.sharedServiceExpanded.set(serviceId, expanded);
        const children = (header as HTMLElement).nextElementSibling as HTMLElement;
        const icon = header.querySelector('.icm-toggle-icon');
        if (children) children.style.display = expanded ? '' : 'none';
        if (icon) icon.innerHTML = getIcon(expanded ? ChevronDown : ChevronRight, 12);
      });
    });

    // Attach click handlers for tree node toggles (saved query folders)
    this.container.querySelectorAll('.icm-tree-node-header[data-saved-folder]').forEach(header => {
      header.addEventListener('click', () => {
        const folder = (header as HTMLElement).dataset.savedFolder || 'Default';
        const expanded = !(this.savedFolderExpanded.get(folder) ?? true);
        this.savedFolderExpanded.set(folder, expanded);
        const children = (header as HTMLElement).nextElementSibling as HTMLElement;
        const icon = header.querySelector('.icm-toggle-icon');
        if (children) children.style.display = expanded ? '' : 'none';
        if (icon) icon.innerHTML = getIcon(expanded ? ChevronDown : ChevronRight, 12);
      });
    });

    // Attach click handlers for query items
    this.container.querySelectorAll('.icm-query-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Don't trigger tree node toggle
        const queryId = (btn as HTMLElement).dataset.queryId!;
        const queryType = (btn as HTMLElement).dataset.queryType as 'favorite' | 'saved' | 'shared';
        this.activeQueryId = queryId;
        if (queryType === 'favorite') this.activeView = 'favorite';
        else if (queryType === 'shared') this.activeView = 'shared';
        else this.activeView = 'saved';
        this.updateActiveState();
        this.onViewChangeCallback?.(this.activeView, queryId);
        this.onRefreshCallback?.();
      });
    });
  }

  private getFilteredSorted(): IcmIncidentListItem[] {
    let items = this.incidents;

    // Filter by severity
    if (this.filterSeverities.size > 0) {
      items = items.filter(i => this.filterSeverities.has(i.Severity));
    }
    // Filter by state (case-insensitive)
    if (this.filterStates.size > 0) {
      const lowerStates = new Set(Array.from(this.filterStates).map(s => s.toLowerCase()));
      items = items.filter(i => lowerStates.has((i.State || '').toLowerCase()));
    }
    // Filter by flags
    if (this.filterCI) items = items.filter(i => i.IsCustomerImpacting);
    if (this.filterOutage) items = items.filter(i => i.IsOutage);

    // Sort
    const dir = this.sortAsc ? 1 : -1;
    items = [...items].sort((a, b) => {
      let cmp = 0;
      switch (this.sortField) {
        case 'Severity': {
          // Normalize: sev 25 → 2.5 for sorting
          const sa = a.Severity === 25 ? 2.5 : a.Severity;
          const sb = b.Severity === 25 ? 2.5 : b.Severity;
          cmp = sa - sb;
          break;
        }
        case 'CreatedDate':
          cmp = (a.CreatedDate || '').localeCompare(b.CreatedDate || '');
          break;
        case 'Id':
          cmp = a.Id - b.Id;
          break;
        case 'HitCount':
          cmp = a.HitCount - b.HitCount;
          break;
        case 'State':
          cmp = a.State.localeCompare(b.State);
          break;
      }
      return cmp * dir;
    });

    return items;
  }

  private getGroupKey(item: IcmIncidentListItem): string {
    switch (this.groupBy) {
      case 'Severity': return `Sev ${item.Severity === 25 ? '2.5' : item.Severity}`;
      case 'State': return item.State;
      case 'Owner': return item.ContactAlias || 'Unassigned';
      case 'Team': return `${item.OwningTenantName || 'Unknown'} / ${item.OwningTeamName || 'Unknown'}`;
      case 'Service': return item.OwningTenantName || 'Unknown';
      default: return '';
    }
  }

  private renderIncidentsList() {
    const container = this.container.querySelector('#icmIncidentsList')!;
    const countEl = this.container.querySelector('#icmFilterCount');

    if (this.loading) {
      container.innerHTML = `
        <div class="icm-loading">
          <div class="loading-spinner"></div>
          <p>Loading incidents...</p>
        </div>
      `;
      if (countEl) countEl.textContent = '';
      return;
    }

    if (this.incidents.length === 0) {
      container.innerHTML = `
        <div class="icm-empty">
          ${getIcon(AlertTriangle, 48)}
          <p>No incidents found</p>
        </div>
      `;
      if (countEl) countEl.textContent = '';
      return;
    }

    const filtered = this.getFilteredSorted();
    const total = this.incidents.length;
    if (countEl) {
      countEl.textContent = filtered.length === total
        ? `${total}` : `${filtered.length} / ${total}`;
    }

    if (filtered.length === 0) {
      container.innerHTML = `<div class="icm-empty"><p>No incidents match filters</p></div>`;
      return;
    }

    if (this.groupBy === 'none') {
      container.innerHTML = filtered.map(item => this.renderIncidentCard(item)).join('');
    } else {
      // Group items preserving sort order
      const groups = new Map<string, IcmIncidentListItem[]>();
      for (const item of filtered) {
        const key = this.getGroupKey(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
      container.innerHTML = Array.from(groups.entries()).map(([key, items]) => `
        <div class="icm-group">
          <div class="icm-group-header">
            <span class="icm-group-label">${escapeHtml(key)}</span>
            <span class="icm-group-count">${items.length}</span>
          </div>
          ${items.map(item => this.renderIncidentCard(item)).join('')}
        </div>
      `).join('');
    }

    // Attach click handlers
    container.querySelectorAll('.icm-incident-row').forEach(card => {
      card.addEventListener('click', () => {
        const itemId = parseInt((card as HTMLElement).dataset.incidentId || '0');
        const item = this.incidents.find(i => i.Id === itemId);
        if (item) {
          this.onSelectCallback?.(item);
        }
      });
    });
  }

  private static titleCase(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
  }

  private renderIncidentCard(item: IcmIncidentListItem): string {
    const sevColor = ICM_SEVERITY_COLORS[item.Severity] || '#666';
    const stateColor = ICM_STATE_COLORS[IcmIncidentsListView.titleCase(item.State)] || '#666';
    const timeAgo = item.CreatedDate ? formatTimeAgo(new Date(item.CreatedDate)) : '';

    const stats = [
      item.HitCount > 0 ? `<span class="icm-stat" title="Hit Count">${item.HitCount} hits</span>` : '',
      item.ChildCount > 0 ? `<span class="icm-stat" title="Child Count">${item.ChildCount} child</span>` : '',
      item.IsCustomerImpacting ? `<span class="icm-stat icm-stat-warning" title="Customer Impacting">CI</span>` : '',
      item.IsOutage ? `<span class="icm-stat icm-stat-danger" title="Outage">Outage</span>` : '',
    ].filter(Boolean).join('');

    return `
      <div class="icm-incident-row" data-incident-id="${item.Id}">
        <span class="icm-severity-badge" style="background-color: ${sevColor}">S${item.Severity === 25 ? '2.5' : item.Severity}</span>
        <span class="icm-incident-id">${item.Id}</span>
        <span class="icm-incident-row-title" title="${escapeHtml(item.Title)}">${escapeHtml(item.Title)}</span>
        <span class="icm-incident-row-team" title="Owning Team">${escapeHtml(item.OwningTeamName)}</span>
        <span class="icm-incident-row-meta">
          <span title="Owner">${escapeHtml(item.ContactAlias)}</span>
          ${timeAgo ? `<span class="icm-incident-time">${timeAgo}</span>` : ''}
        </span>
        ${stats ? `<span class="icm-incident-row-stats">${stats}</span>` : ''}
        <span class="icm-state-badge" style="background-color: ${stateColor}">${escapeHtml(item.State)}</span>
      </div>
    `;
  }
}
