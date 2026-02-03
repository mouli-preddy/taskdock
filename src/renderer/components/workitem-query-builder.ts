import type { SavedQuery, WorkItemQueryFilter } from '../../shared/workitem-types.js';
import { v4 as uuidv4 } from 'uuid';
import { escapeHtml } from '../utils/html-utils.js';
import { getIcon, X } from '../utils/icons.js';

export interface QueryBuilderOptions {
  workItemTypes: string[];
  states: string[];
  areaPaths: string[];
  iterationPaths: string[];
}

export class WorkItemQueryBuilder {
  private modal: HTMLElement | null = null;
  private options: QueryBuilderOptions = {
    workItemTypes: [],
    states: [],
    areaPaths: [],
    iterationPaths: [],
  };
  private editingQuery: SavedQuery | null = null;

  private onSaveCallback: ((query: SavedQuery) => void) | null = null;
  private onCancelCallback: (() => void) | null = null;

  onSave(callback: (query: SavedQuery) => void) {
    this.onSaveCallback = callback;
  }

  onCancel(callback: () => void) {
    this.onCancelCallback = callback;
  }

  setOptions(options: Partial<QueryBuilderOptions>) {
    this.options = { ...this.options, ...options };
    this.updateDropdowns();
  }

  show(query?: SavedQuery) {
    this.editingQuery = query || null;
    this.render();
    this.modal?.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  hide() {
    this.modal?.classList.add('hidden');
    document.body.classList.remove('modal-open');
    this.editingQuery = null;
  }

  private render() {
    // Remove existing modal if any
    this.modal?.remove();

    // Parse existing query to pre-fill form if editing
    const filter = this.editingQuery ? this.parseWiqlToFilter(this.editingQuery.wiql) : {};

    this.modal = document.createElement('div');
    this.modal.className = 'query-builder-modal hidden';
    this.modal.innerHTML = `
      <div class="query-builder-backdrop"></div>
      <div class="query-builder-content">
        <header class="query-builder-header">
          <h2>${this.editingQuery ? 'Edit Query' : 'New Query'}</h2>
          <button class="btn btn-icon" id="closeQueryBuilder">
            ${getIcon(X, 20)}
          </button>
        </header>

        <div class="query-builder-body">
          <div class="query-builder-field">
            <label for="queryName">Query Name</label>
            <input type="text" id="queryName" placeholder="My custom query" value="${escapeHtml(this.editingQuery?.name || '')}">
          </div>

          <div class="query-builder-filters">
            <h3>Filters</h3>

            <div class="query-builder-field">
              <label for="filterType">Work Item Type</label>
              <select id="filterType">
                <option value="">Any</option>
                ${this.options.workItemTypes.map(type =>
                  `<option value="${escapeHtml(type)}" ${filter.workItemType === type ? 'selected' : ''}>${escapeHtml(type)}</option>`
                ).join('')}
              </select>
            </div>

            <div class="query-builder-field">
              <label for="filterState">State</label>
              <select id="filterState">
                <option value="">Any (Active)</option>
                <option value="any-all">Any (All States)</option>
                ${this.options.states.map(state =>
                  `<option value="${escapeHtml(state)}" ${filter.state === state ? 'selected' : ''}>${escapeHtml(state)}</option>`
                ).join('')}
              </select>
            </div>

            <div class="query-builder-field">
              <label for="filterAssignedTo">Assigned To</label>
              <select id="filterAssignedTo">
                <option value="">Anyone</option>
                <option value="me" ${filter.assignedTo === 'me' ? 'selected' : ''}>Me</option>
                <option value="unassigned" ${filter.assignedTo === 'unassigned' ? 'selected' : ''}>Unassigned</option>
              </select>
            </div>

            <div class="query-builder-field">
              <label for="filterAreaPath">Area Path</label>
              <select id="filterAreaPath">
                <option value="">Any</option>
                ${this.options.areaPaths.map(path =>
                  `<option value="${escapeHtml(path)}" ${filter.areaPath === path ? 'selected' : ''}>${escapeHtml(path)}</option>`
                ).join('')}
              </select>
            </div>

            <div class="query-builder-field">
              <label for="filterIterationPath">Iteration Path</label>
              <select id="filterIterationPath">
                <option value="">Any</option>
                ${this.options.iterationPaths.map(path =>
                  `<option value="${escapeHtml(path)}" ${filter.iterationPath === path ? 'selected' : ''}>${escapeHtml(path)}</option>`
                ).join('')}
              </select>
            </div>

            <div class="query-builder-field">
              <label for="filterTags">Tags (comma-separated)</label>
              <input type="text" id="filterTags" placeholder="tag1, tag2" value="${escapeHtml(filter.tags || '')}">
            </div>
          </div>

          <div class="query-builder-preview">
            <h3>WIQL Preview</h3>
            <pre id="wiqlPreview" class="query-builder-wiql"></pre>
          </div>
        </div>

        <footer class="query-builder-footer">
          <button class="btn btn-secondary" id="cancelQueryBtn">Cancel</button>
          <button class="btn btn-primary" id="saveQueryBtn">Save Query</button>
        </footer>
      </div>
    `;

    document.body.appendChild(this.modal);
    this.attachEventListeners();
    this.updateWiqlPreview();
  }

  private attachEventListeners() {
    // Close button
    this.modal?.querySelector('#closeQueryBuilder')?.addEventListener('click', () => {
      this.hide();
      this.onCancelCallback?.();
    });

    // Backdrop click
    this.modal?.querySelector('.query-builder-backdrop')?.addEventListener('click', () => {
      this.hide();
      this.onCancelCallback?.();
    });

    // Cancel button
    this.modal?.querySelector('#cancelQueryBtn')?.addEventListener('click', () => {
      this.hide();
      this.onCancelCallback?.();
    });

    // Save button
    this.modal?.querySelector('#saveQueryBtn')?.addEventListener('click', () => {
      this.saveQuery();
    });

    // Update preview on filter change
    const filterInputs = this.modal?.querySelectorAll('select, input');
    filterInputs?.forEach(input => {
      input.addEventListener('change', () => this.updateWiqlPreview());
      input.addEventListener('input', () => this.updateWiqlPreview());
    });
  }

  private updateDropdowns() {
    if (!this.modal) return;

    const typeSelect = this.modal.querySelector('#filterType') as HTMLSelectElement;
    if (typeSelect) {
      const currentValue = typeSelect.value;
      typeSelect.innerHTML = `
        <option value="">Any</option>
        ${this.options.workItemTypes.map(type =>
          `<option value="${escapeHtml(type)}" ${currentValue === type ? 'selected' : ''}>${escapeHtml(type)}</option>`
        ).join('')}
      `;
    }

    const stateSelect = this.modal.querySelector('#filterState') as HTMLSelectElement;
    if (stateSelect) {
      const currentValue = stateSelect.value;
      stateSelect.innerHTML = `
        <option value="">Any (Active)</option>
        <option value="any-all" ${currentValue === 'any-all' ? 'selected' : ''}>Any (All States)</option>
        ${this.options.states.map(state =>
          `<option value="${escapeHtml(state)}" ${currentValue === state ? 'selected' : ''}>${escapeHtml(state)}</option>`
        ).join('')}
      `;
    }

    const areaSelect = this.modal.querySelector('#filterAreaPath') as HTMLSelectElement;
    if (areaSelect) {
      const currentValue = areaSelect.value;
      areaSelect.innerHTML = `
        <option value="">Any</option>
        ${this.options.areaPaths.map(path =>
          `<option value="${escapeHtml(path)}" ${currentValue === path ? 'selected' : ''}>${escapeHtml(path)}</option>`
        ).join('')}
      `;
    }

    const iterationSelect = this.modal.querySelector('#filterIterationPath') as HTMLSelectElement;
    if (iterationSelect) {
      const currentValue = iterationSelect.value;
      iterationSelect.innerHTML = `
        <option value="">Any</option>
        ${this.options.iterationPaths.map(path =>
          `<option value="${escapeHtml(path)}" ${currentValue === path ? 'selected' : ''}>${escapeHtml(path)}</option>`
        ).join('')}
      `;
    }
  }

  private getFilterValues(): WorkItemQueryFilter {
    const typeSelect = this.modal?.querySelector('#filterType') as HTMLSelectElement;
    const stateSelect = this.modal?.querySelector('#filterState') as HTMLSelectElement;
    const assignedToSelect = this.modal?.querySelector('#filterAssignedTo') as HTMLSelectElement;
    const areaPathSelect = this.modal?.querySelector('#filterAreaPath') as HTMLSelectElement;
    const iterationPathSelect = this.modal?.querySelector('#filterIterationPath') as HTMLSelectElement;
    const tagsInput = this.modal?.querySelector('#filterTags') as HTMLInputElement;

    return {
      workItemType: typeSelect?.value || undefined,
      state: stateSelect?.value || undefined,
      assignedTo: assignedToSelect?.value as 'me' | 'unassigned' | undefined,
      areaPath: areaPathSelect?.value || undefined,
      iterationPath: iterationPathSelect?.value || undefined,
      tags: tagsInput?.value || undefined,
    };
  }

  private buildWiql(filter: WorkItemQueryFilter): string {
    const conditions: string[] = ['[System.TeamProject] = @project'];

    if (filter.workItemType) {
      conditions.push(`[System.WorkItemType] = '${filter.workItemType}'`);
    }

    if (filter.state === 'any-all') {
      // No state filter - include all states
    } else if (filter.state) {
      conditions.push(`[System.State] = '${filter.state}'`);
    } else {
      // Default: exclude closed states
      conditions.push(`[System.State] NOT IN ('Closed', 'Removed', 'Done')`);
    }

    if (filter.assignedTo === 'me') {
      conditions.push('[System.AssignedTo] = @me');
    } else if (filter.assignedTo === 'unassigned') {
      conditions.push('[System.AssignedTo] = \'\'');
    }

    if (filter.areaPath) {
      conditions.push(`[System.AreaPath] UNDER '${filter.areaPath}'`);
    }

    if (filter.iterationPath) {
      conditions.push(`[System.IterationPath] UNDER '${filter.iterationPath}'`);
    }

    if (filter.tags) {
      const tags = filter.tags.split(',').map(t => t.trim()).filter(t => t);
      tags.forEach(tag => {
        conditions.push(`[System.Tags] CONTAINS '${tag}'`);
      });
    }

    return `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo], [System.ChangedDate]
FROM WorkItems
WHERE ${conditions.join('\n  AND ')}
ORDER BY [System.ChangedDate] DESC`;
  }

  private updateWiqlPreview() {
    const filter = this.getFilterValues();
    const wiql = this.buildWiql(filter);
    const preview = this.modal?.querySelector('#wiqlPreview');
    if (preview) {
      preview.textContent = wiql;
    }
  }

  private parseWiqlToFilter(wiql: string): WorkItemQueryFilter {
    const filter: WorkItemQueryFilter = {};

    // Parse work item type
    const typeMatch = wiql.match(/\[System\.WorkItemType\]\s*=\s*'([^']+)'/i);
    if (typeMatch) filter.workItemType = typeMatch[1];

    // Parse state
    const stateMatch = wiql.match(/\[System\.State\]\s*=\s*'([^']+)'/i);
    if (stateMatch) filter.state = stateMatch[1];
    else if (!wiql.includes('[System.State] NOT IN')) filter.state = 'any-all';

    // Parse assigned to
    if (wiql.includes('[System.AssignedTo] = @me')) filter.assignedTo = 'me';
    else if (wiql.includes("[System.AssignedTo] = ''")) filter.assignedTo = 'unassigned';

    // Parse area path
    const areaMatch = wiql.match(/\[System\.AreaPath\]\s+UNDER\s+'([^']+)'/i);
    if (areaMatch) filter.areaPath = areaMatch[1];

    // Parse iteration path
    const iterationMatch = wiql.match(/\[System\.IterationPath\]\s+UNDER\s+'([^']+)'/i);
    if (iterationMatch) filter.iterationPath = iterationMatch[1];

    // Parse tags
    const tagMatches = wiql.match(/\[System\.Tags\]\s+CONTAINS\s+'([^']+)'/gi);
    if (tagMatches) {
      const tags = tagMatches.map(m => {
        const match = m.match(/'([^']+)'/);
        return match ? match[1] : '';
      }).filter(t => t);
      filter.tags = tags.join(', ');
    }

    return filter;
  }

  private saveQuery() {
    const nameInput = this.modal?.querySelector('#queryName') as HTMLInputElement;
    const name = nameInput?.value?.trim();

    if (!name) {
      nameInput?.focus();
      nameInput?.classList.add('error');
      return;
    }

    const filter = this.getFilterValues();
    const wiql = this.buildWiql(filter);

    const query: SavedQuery = {
      id: this.editingQuery?.id || uuidv4(),
      name,
      wiql,
      createdAt: this.editingQuery?.createdAt || new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    };

    this.onSaveCallback?.(query);
    this.hide();
  }

}
