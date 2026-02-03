import type { WorkItem, WorkItemUpdate, WorkItemRelation, WorkItemComment, TeamMember } from '../../shared/workitem-types.js';
import { WORK_ITEM_TYPE_COLORS, WORK_ITEM_STATE_COLORS, RELATION_TYPE_NAMES } from '../../shared/workitem-types.js';
import { escapeHtml, formatTimeAgo } from '../utils/html-utils.js';
import { getIcon, Edit, ExternalLink, Upload, File, Download, X, Link, BookOpen } from '../utils/icons.js';

export interface WorkItemDetailViewConfig {
  organization: string;
  project: string;
}

interface EditableFields {
  title: string;
  state: string;
  assignedTo: string;
  description: string;
  priority: number | null;
  tags: string;
  areaPath: string;
  iterationPath: string;
}

export class WorkItemDetailView {
  private container: HTMLElement;
  private config: WorkItemDetailViewConfig;
  private workItem: WorkItem | null = null;
  private updates: WorkItemUpdate[] = [];
  private comments: WorkItemComment[] = [];
  private relatedItems: Map<number, WorkItem> = new Map();
  private activePanel: 'details' | 'related' | 'activity' | 'comments' | 'attachments' | 'wiki' = 'details';
  private loading = false;

  // Edit mode state
  private editMode = false;
  private editedFields: Partial<EditableFields> = {};
  private saving = false;

  // Dropdown options
  private teamMembers: TeamMember[] = [];
  private allowedStates: string[] = [];
  private areaPaths: string[] = [];
  private iterationPaths: string[] = [];

  // Callbacks
  private onOpenRelatedCallback: ((id: number) => void) | null = null;
  private onOpenInBrowserCallback: ((url: string) => void) | null = null;
  private onWorkItemUpdatedCallback: ((item: WorkItem) => void) | null = null;
  private onRefreshRequestCallback: (() => void) | null = null;

  constructor(container: HTMLElement, config: WorkItemDetailViewConfig) {
    this.container = container;
    this.config = config;
    this.render();
  }

  // Public API
  onOpenRelated(callback: (id: number) => void) {
    this.onOpenRelatedCallback = callback;
  }

  onOpenInBrowser(callback: (url: string) => void) {
    this.onOpenInBrowserCallback = callback;
  }

  onWorkItemUpdated(callback: (item: WorkItem) => void) {
    this.onWorkItemUpdatedCallback = callback;
  }

  onRefreshRequest(callback: () => void) {
    this.onRefreshRequestCallback = callback;
  }

  setWorkItem(item: WorkItem) {
    this.workItem = item;
    this.editMode = false;
    this.editedFields = {};
    this.render();
    this.loadCommentsIfNeeded();
    this.loadEditOptions();
  }

  setUpdates(updates: WorkItemUpdate[]) {
    this.updates = updates.reverse();
    if (this.activePanel === 'activity') {
      this.renderActivityPanel();
    }
  }

  setComments(comments: WorkItemComment[]) {
    this.comments = comments;
    if (this.activePanel === 'comments') {
      this.renderCommentsPanel();
    }
  }

  setRelatedItems(items: WorkItem[]) {
    this.relatedItems.clear();
    items.forEach(item => this.relatedItems.set(item.id, item));
    if (this.activePanel === 'related') {
      this.renderRelatedPanel();
    }
  }

  setLoading(loading: boolean) {
    this.loading = loading;
    this.render();
  }

  private async loadCommentsIfNeeded() {
    if (!this.workItem) return;
    try {
      const response = await window.electronAPI.wiGetComments(
        this.config.organization,
        this.config.project,
        this.workItem.id
      );
      this.comments = response.comments || [];
      if (this.activePanel === 'comments') {
        this.renderCommentsPanel();
      }
    } catch (error) {
      console.error('Failed to load comments:', error);
    }
  }

  private async loadEditOptions() {
    if (!this.workItem) return;
    const { organization, project } = this.config;
    const workItemType = this.workItem.fields['System.WorkItemType'];

    try {
      // Load in parallel
      const [teamMembers, states, areaPaths, iterationPaths] = await Promise.all([
        window.electronAPI.wiGetTeamMembers(organization, project).catch(() => []),
        window.electronAPI.wiGetTypeStates(organization, project, workItemType).catch(() => []),
        window.electronAPI.wiGetAreaPaths(organization, project).catch(() => ({ children: [] })),
        window.electronAPI.wiGetIterationPaths(organization, project).catch(() => ({ children: [] })),
      ]);

      this.teamMembers = teamMembers;
      this.allowedStates = states.map((s: any) => s.name);
      this.areaPaths = this.flattenClassificationNodes(areaPaths, project);
      this.iterationPaths = this.flattenClassificationNodes(iterationPaths, project);
    } catch (error) {
      console.error('Failed to load edit options:', error);
    }
  }

  private flattenClassificationNodes(node: any, basePath: string): string[] {
    const paths: string[] = [basePath];
    const processChildren = (children: any[], parentPath: string) => {
      if (!children) return;
      for (const child of children) {
        const path = `${parentPath}\\${child.name}`;
        paths.push(path);
        if (child.children) {
          processChildren(child.children, path);
        }
      }
    };
    if (node.children) {
      processChildren(node.children, basePath);
    }
    return paths;
  }

  private render() {
    if (this.loading) {
      this.container.innerHTML = `
        <div class="workitem-detail-loading">
          <div class="loading-spinner"></div>
          <p>Loading work item...</p>
        </div>
      `;
      return;
    }

    if (!this.workItem) {
      this.container.innerHTML = `
        <div class="workitem-detail-empty">
          <p>No work item selected</p>
        </div>
      `;
      return;
    }

    const fields = this.workItem.fields;
    const type = fields['System.WorkItemType'] || 'Task';
    const state = fields['System.State'] || 'New';
    const title = fields['System.Title'] || 'Untitled';
    const typeColor = WORK_ITEM_TYPE_COLORS[type] || '#666';
    const stateColor = WORK_ITEM_STATE_COLORS[state] || '#666';

    // Count attachments and wiki links
    const relations = this.workItem.relations || [];
    const attachmentCount = relations.filter(r => r.rel === 'AttachedFile').length;
    const hyperlinkCount = relations.filter(r => r.rel === 'Hyperlink').length;

    this.container.innerHTML = `
      <div class="workitem-detail-view">
        <header class="workitem-detail-header">
          <div class="workitem-detail-title-row">
            <span class="workitem-type-badge" style="background-color: ${typeColor}">${escapeHtml(type)}</span>
            <span class="workitem-id">${this.workItem.id}</span>
            <span class="workitem-state-badge" style="background-color: ${stateColor}">${escapeHtml(state)}</span>
            <div class="workitem-header-actions">
              ${this.editMode ? `
                <button class="btn btn-primary btn-small" id="saveChangesBtn" ${this.saving ? 'disabled' : ''}>
                  ${this.saving ? 'Saving...' : 'Save'}
                </button>
                <button class="btn btn-secondary btn-small" id="cancelEditBtn" ${this.saving ? 'disabled' : ''}>
                  Cancel
                </button>
              ` : `
                <button class="btn btn-secondary btn-small" id="editBtn">
                  ${getIcon(Edit, 14)}
                  Edit
                </button>
              `}
              <button class="btn btn-secondary btn-small" id="openInBrowserBtn">
                ${getIcon(ExternalLink, 14)}
                Open in ADO
              </button>
            </div>
          </div>
          <h1 class="workitem-detail-title">${escapeHtml(title)}</h1>
        </header>

        <nav class="workitem-detail-tabs">
          <button class="workitem-tab ${this.activePanel === 'details' ? 'active' : ''}" data-panel="details">Details</button>
          <button class="workitem-tab ${this.activePanel === 'comments' ? 'active' : ''}" data-panel="comments">Comments (${this.comments.length})</button>
          <button class="workitem-tab ${this.activePanel === 'attachments' ? 'active' : ''}" data-panel="attachments">Attachments (${attachmentCount})</button>
          <button class="workitem-tab ${this.activePanel === 'wiki' ? 'active' : ''}" data-panel="wiki">Wiki (${hyperlinkCount})</button>
          <button class="workitem-tab ${this.activePanel === 'related' ? 'active' : ''}" data-panel="related">Related</button>
          <button class="workitem-tab ${this.activePanel === 'activity' ? 'active' : ''}" data-panel="activity">Activity</button>
        </nav>

        <div class="workitem-detail-content">
          <div class="workitem-panel" id="detailsPanel" ${this.activePanel !== 'details' ? 'style="display:none"' : ''}></div>
          <div class="workitem-panel" id="commentsPanel" ${this.activePanel !== 'comments' ? 'style="display:none"' : ''}></div>
          <div class="workitem-panel" id="attachmentsPanel" ${this.activePanel !== 'attachments' ? 'style="display:none"' : ''}></div>
          <div class="workitem-panel" id="wikiPanel" ${this.activePanel !== 'wiki' ? 'style="display:none"' : ''}></div>
          <div class="workitem-panel" id="relatedPanel" ${this.activePanel !== 'related' ? 'style="display:none"' : ''}></div>
          <div class="workitem-panel" id="activityPanel" ${this.activePanel !== 'activity' ? 'style="display:none"' : ''}></div>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.renderActivePanel();
  }

  private attachEventListeners() {
    // Tab switching
    this.container.querySelectorAll('.workitem-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const panel = (tab as HTMLElement).dataset.panel as typeof this.activePanel;
        this.switchPanel(panel);
      });
    });

    // Open in browser
    this.container.querySelector('#openInBrowserBtn')?.addEventListener('click', () => {
      if (this.workItem?._links?.html?.href) {
        this.onOpenInBrowserCallback?.(this.workItem._links.html.href);
      }
    });

    // Edit mode buttons
    this.container.querySelector('#editBtn')?.addEventListener('click', () => {
      this.enterEditMode();
    });

    this.container.querySelector('#saveChangesBtn')?.addEventListener('click', () => {
      this.saveChanges();
    });

    this.container.querySelector('#cancelEditBtn')?.addEventListener('click', () => {
      this.cancelEdit();
    });
  }

  private switchPanel(panel: typeof this.activePanel) {
    this.activePanel = panel;

    // Update tab states
    this.container.querySelectorAll('.workitem-tab').forEach(tab => {
      tab.classList.toggle('active', (tab as HTMLElement).dataset.panel === panel);
    });

    // Show/hide panels
    this.container.querySelectorAll('.workitem-panel').forEach(p => {
      (p as HTMLElement).style.display = 'none';
    });

    const activePanel = this.container.querySelector(`#${panel}Panel`) as HTMLElement;
    if (activePanel) {
      activePanel.style.display = '';
    }

    this.renderActivePanel();
  }

  private renderActivePanel() {
    switch (this.activePanel) {
      case 'details':
        this.renderDetailsPanel();
        break;
      case 'comments':
        this.renderCommentsPanel();
        break;
      case 'attachments':
        this.renderAttachmentsPanel();
        break;
      case 'wiki':
        this.renderWikiPanel();
        break;
      case 'related':
        this.renderRelatedPanel();
        break;
      case 'activity':
        this.renderActivityPanel();
        break;
    }
  }

  private enterEditMode() {
    if (!this.workItem) return;
    this.editMode = true;
    this.editedFields = {};
    this.render();
  }

  private cancelEdit() {
    this.editMode = false;
    this.editedFields = {};
    this.render();
  }

  private async saveChanges() {
    if (!this.workItem || this.saving) return;

    const operations: any[] = [];
    const fields = this.workItem.fields;

    // Build patch operations for changed fields
    if (this.editedFields.title !== undefined && this.editedFields.title !== fields['System.Title']) {
      operations.push({ op: 'replace', path: '/fields/System.Title', value: this.editedFields.title });
    }
    if (this.editedFields.state !== undefined && this.editedFields.state !== fields['System.State']) {
      operations.push({ op: 'replace', path: '/fields/System.State', value: this.editedFields.state });
    }
    if (this.editedFields.assignedTo !== undefined) {
      const currentAssigned = fields['System.AssignedTo']?.uniqueName || '';
      if (this.editedFields.assignedTo !== currentAssigned) {
        if (this.editedFields.assignedTo) {
          operations.push({ op: 'replace', path: '/fields/System.AssignedTo', value: this.editedFields.assignedTo });
        } else {
          operations.push({ op: 'remove', path: '/fields/System.AssignedTo' });
        }
      }
    }
    if (this.editedFields.description !== undefined && this.editedFields.description !== (fields['System.Description'] || '')) {
      operations.push({ op: 'replace', path: '/fields/System.Description', value: this.editedFields.description });
    }
    if (this.editedFields.priority !== undefined && this.editedFields.priority !== fields['Microsoft.VSTS.Common.Priority']) {
      if (this.editedFields.priority) {
        operations.push({ op: 'replace', path: '/fields/Microsoft.VSTS.Common.Priority', value: this.editedFields.priority });
      }
    }
    if (this.editedFields.tags !== undefined && this.editedFields.tags !== (fields['System.Tags'] || '')) {
      operations.push({ op: 'replace', path: '/fields/System.Tags', value: this.editedFields.tags });
    }
    if (this.editedFields.areaPath !== undefined && this.editedFields.areaPath !== fields['System.AreaPath']) {
      operations.push({ op: 'replace', path: '/fields/System.AreaPath', value: this.editedFields.areaPath });
    }
    if (this.editedFields.iterationPath !== undefined && this.editedFields.iterationPath !== fields['System.IterationPath']) {
      operations.push({ op: 'replace', path: '/fields/System.IterationPath', value: this.editedFields.iterationPath });
    }

    if (operations.length === 0) {
      this.cancelEdit();
      return;
    }

    this.saving = true;
    this.render();

    try {
      const updatedItem = await window.electronAPI.wiUpdate(
        this.config.organization,
        this.config.project,
        this.workItem.id,
        operations
      );
      this.workItem = updatedItem;
      this.editMode = false;
      this.editedFields = {};
      this.onWorkItemUpdatedCallback?.(updatedItem);
    } catch (error) {
      console.error('Failed to save changes:', error);
      alert('Failed to save changes: ' + (error as Error).message);
    } finally {
      this.saving = false;
      this.render();
    }
  }

  private renderDetailsPanel() {
    const panel = this.container.querySelector('#detailsPanel')!;
    if (!this.workItem) return;

    const fields = this.workItem.fields;

    if (this.editMode) {
      this.renderEditableDetails(panel);
    } else {
      this.renderReadOnlyDetails(panel);
    }
  }

  private renderReadOnlyDetails(panel: Element) {
    const fields = this.workItem!.fields;
    const description = fields['System.Description'] || '';
    const assignedTo = fields['System.AssignedTo'];
    const createdBy = fields['System.CreatedBy'];
    const createdDate = fields['System.CreatedDate'];
    const changedDate = fields['System.ChangedDate'];
    const areaPath = fields['System.AreaPath'];
    const iterationPath = fields['System.IterationPath'];
    const tags = fields['System.Tags'];
    const priority = fields['Microsoft.VSTS.Common.Priority'];

    panel.innerHTML = `
      <div class="workitem-details-grid">
        <div class="workitem-details-main">
          <section class="workitem-section">
            <h3>Description</h3>
            <div class="workitem-description">
              ${description ? this.renderHtmlContent(description) : '<p class="text-muted">No description provided</p>'}
            </div>
          </section>
        </div>

        <aside class="workitem-details-sidebar">
          <section class="workitem-section">
            <h3>Details</h3>
            <dl class="workitem-fields">
              ${assignedTo ? `
                <dt>Assigned To</dt>
                <dd>
                  <span class="workitem-person">
                    ${assignedTo.imageUrl ? `<img src="${assignedTo.imageUrl}" alt="" class="workitem-avatar-small">` : ''}
                    ${escapeHtml(assignedTo.displayName)}
                  </span>
                </dd>
              ` : '<dt>Assigned To</dt><dd class="text-muted">Unassigned</dd>'}

              ${createdBy ? `
                <dt>Created By</dt>
                <dd>
                  <span class="workitem-person">
                    ${createdBy.imageUrl ? `<img src="${createdBy.imageUrl}" alt="" class="workitem-avatar-small">` : ''}
                    ${escapeHtml(createdBy.displayName)}
                  </span>
                </dd>
              ` : ''}

              ${createdDate ? `
                <dt>Created</dt>
                <dd>${this.formatDate(new Date(createdDate))}</dd>
              ` : ''}

              ${changedDate ? `
                <dt>Last Updated</dt>
                <dd>${this.formatDate(new Date(changedDate))}</dd>
              ` : ''}

              ${priority ? `
                <dt>Priority</dt>
                <dd><span class="workitem-priority priority-${priority}">${priority}</span></dd>
              ` : ''}

              ${areaPath ? `
                <dt>Area Path</dt>
                <dd>${escapeHtml(areaPath)}</dd>
              ` : ''}

              ${iterationPath ? `
                <dt>Iteration</dt>
                <dd>${escapeHtml(iterationPath)}</dd>
              ` : ''}

              ${tags ? `
                <dt>Tags</dt>
                <dd>
                  <div class="workitem-tags">
                    ${tags.split(';').map(tag => `<span class="workitem-tag">${escapeHtml(tag.trim())}</span>`).join('')}
                  </div>
                </dd>
              ` : ''}
            </dl>
          </section>
        </aside>
      </div>
    `;
  }

  private renderEditableDetails(panel: Element) {
    const fields = this.workItem!.fields;
    const title = this.editedFields.title ?? fields['System.Title'] ?? '';
    const state = this.editedFields.state ?? fields['System.State'] ?? '';
    const assignedTo = this.editedFields.assignedTo ?? fields['System.AssignedTo']?.uniqueName ?? '';
    const description = this.editedFields.description ?? fields['System.Description'] ?? '';
    const priority = this.editedFields.priority ?? fields['Microsoft.VSTS.Common.Priority'] ?? '';
    const tags = this.editedFields.tags ?? fields['System.Tags'] ?? '';
    const areaPath = this.editedFields.areaPath ?? fields['System.AreaPath'] ?? '';
    const iterationPath = this.editedFields.iterationPath ?? fields['System.IterationPath'] ?? '';

    panel.innerHTML = `
      <div class="workitem-edit-form">
        <div class="workitem-edit-field">
          <label for="editTitle">Title</label>
          <input type="text" id="editTitle" value="${escapeHtml(title)}" class="form-input">
        </div>

        <div class="workitem-edit-row">
          <div class="workitem-edit-field">
            <label for="editState">State</label>
            <select id="editState" class="form-select">
              ${this.allowedStates.length > 0
                ? this.allowedStates.map(s => `<option value="${escapeHtml(s)}" ${s === state ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')
                : `<option value="${escapeHtml(state)}" selected>${escapeHtml(state)}</option>`
              }
            </select>
          </div>

          <div class="workitem-edit-field">
            <label for="editAssignedTo">Assigned To</label>
            <select id="editAssignedTo" class="form-select">
              <option value="">Unassigned</option>
              ${this.teamMembers.map(m => `<option value="${escapeHtml(m.uniqueName)}" ${m.uniqueName === assignedTo ? 'selected' : ''}>${escapeHtml(m.displayName)}</option>`).join('')}
            </select>
          </div>

          <div class="workitem-edit-field">
            <label for="editPriority">Priority</label>
            <select id="editPriority" class="form-select">
              <option value="">None</option>
              <option value="1" ${priority == 1 ? 'selected' : ''}>1 - Critical</option>
              <option value="2" ${priority == 2 ? 'selected' : ''}>2 - High</option>
              <option value="3" ${priority == 3 ? 'selected' : ''}>3 - Medium</option>
              <option value="4" ${priority == 4 ? 'selected' : ''}>4 - Low</option>
            </select>
          </div>
        </div>

        <div class="workitem-edit-row">
          <div class="workitem-edit-field">
            <label for="editAreaPath">Area Path</label>
            <select id="editAreaPath" class="form-select">
              ${this.areaPaths.map(p => `<option value="${escapeHtml(p)}" ${p === areaPath ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
            </select>
          </div>

          <div class="workitem-edit-field">
            <label for="editIterationPath">Iteration Path</label>
            <select id="editIterationPath" class="form-select">
              ${this.iterationPaths.map(p => `<option value="${escapeHtml(p)}" ${p === iterationPath ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="workitem-edit-field">
          <label for="editTags">Tags (semicolon-separated)</label>
          <input type="text" id="editTags" value="${escapeHtml(tags)}" class="form-input" placeholder="tag1; tag2; tag3">
        </div>

        <div class="workitem-edit-field">
          <label for="editDescription">Description</label>
          <textarea id="editDescription" class="form-textarea" rows="10">${escapeHtml(description)}</textarea>
          <p class="form-hint">HTML formatting is supported</p>
        </div>
      </div>
    `;

    // Attach change handlers
    this.attachEditHandlers(panel);
  }

  private attachEditHandlers(panel: Element) {
    const titleInput = panel.querySelector('#editTitle') as HTMLInputElement;
    const stateSelect = panel.querySelector('#editState') as HTMLSelectElement;
    const assignedToSelect = panel.querySelector('#editAssignedTo') as HTMLSelectElement;
    const prioritySelect = panel.querySelector('#editPriority') as HTMLSelectElement;
    const tagsInput = panel.querySelector('#editTags') as HTMLInputElement;
    const areaPathSelect = panel.querySelector('#editAreaPath') as HTMLSelectElement;
    const iterationPathSelect = panel.querySelector('#editIterationPath') as HTMLSelectElement;
    const descriptionTextarea = panel.querySelector('#editDescription') as HTMLTextAreaElement;

    titleInput?.addEventListener('input', () => { this.editedFields.title = titleInput.value; });
    stateSelect?.addEventListener('change', () => { this.editedFields.state = stateSelect.value; });
    assignedToSelect?.addEventListener('change', () => { this.editedFields.assignedTo = assignedToSelect.value; });
    prioritySelect?.addEventListener('change', () => { this.editedFields.priority = prioritySelect.value ? parseInt(prioritySelect.value) : null; });
    tagsInput?.addEventListener('input', () => { this.editedFields.tags = tagsInput.value; });
    areaPathSelect?.addEventListener('change', () => { this.editedFields.areaPath = areaPathSelect.value; });
    iterationPathSelect?.addEventListener('change', () => { this.editedFields.iterationPath = iterationPathSelect.value; });
    descriptionTextarea?.addEventListener('input', () => { this.editedFields.description = descriptionTextarea.value; });
  }

  private renderCommentsPanel() {
    const panel = this.container.querySelector('#commentsPanel')!;
    if (!this.workItem) return;

    panel.innerHTML = `
      <div class="workitem-comments">
        <div class="workitem-add-comment">
          <textarea id="newCommentText" class="form-textarea" rows="3" placeholder="Add a comment..."></textarea>
          <button class="btn btn-primary" id="addCommentBtn">Add Comment</button>
        </div>
        <div class="workitem-comments-list">
          ${this.comments.length === 0
            ? '<p class="text-muted">No comments yet</p>'
            : this.comments.map(c => this.renderComment(c)).join('')
          }
        </div>
      </div>
    `;

    // Add comment handler
    panel.querySelector('#addCommentBtn')?.addEventListener('click', async () => {
      const textarea = panel.querySelector('#newCommentText') as HTMLTextAreaElement;
      const text = textarea.value.trim();
      if (!text) return;

      const btn = panel.querySelector('#addCommentBtn') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Adding...';

      try {
        await window.electronAPI.wiAddComment(
          this.config.organization,
          this.config.project,
          this.workItem!.id,
          text
        );
        textarea.value = '';
        await this.loadCommentsIfNeeded();
      } catch (error) {
        console.error('Failed to add comment:', error);
        alert('Failed to add comment: ' + (error as Error).message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Add Comment';
      }
    });
  }

  private renderComment(comment: WorkItemComment): string {
    return `
      <div class="workitem-comment">
        <div class="workitem-comment-header">
          <span class="workitem-comment-author">
            ${comment.createdBy?.imageUrl ? `<img src="${comment.createdBy.imageUrl}" alt="" class="workitem-avatar-small">` : ''}
            ${escapeHtml(comment.createdBy?.displayName || 'Unknown')}
          </span>
          <span class="workitem-comment-date">${formatTimeAgo(new Date(comment.createdDate))}</span>
        </div>
        <div class="workitem-comment-body">
          ${comment.renderedText || escapeHtml(comment.text)}
        </div>
      </div>
    `;
  }

  private renderAttachmentsPanel() {
    const panel = this.container.querySelector('#attachmentsPanel')!;
    if (!this.workItem) return;

    const attachments = (this.workItem.relations || []).filter(r => r.rel === 'AttachedFile');

    panel.innerHTML = `
      <div class="workitem-attachments">
        <div class="workitem-upload-area" id="uploadArea">
          <input type="file" id="fileInput" multiple style="display: none">
          <div class="upload-dropzone" id="dropzone">
            ${getIcon(Upload, 48)}
            <p>Drop files here or <button class="btn-link" id="browseBtn">browse</button></p>
          </div>
        </div>
        <div class="workitem-attachments-list">
          ${attachments.length === 0
            ? '<p class="text-muted">No attachments</p>'
            : attachments.map(a => this.renderAttachment(a)).join('')
          }
        </div>
      </div>
    `;

    this.attachUploadHandlers(panel);

    // Download button handlers
    panel.querySelectorAll('.download-attachment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = (btn as HTMLElement).closest('.workitem-attachment')?.getAttribute('data-url');
        if (url) {
          window.electronAPI.openExternal(url);
        }
      });
    });
  }

  private attachUploadHandlers(panel: Element) {
    const fileInput = panel.querySelector('#fileInput') as HTMLInputElement;
    const browseBtn = panel.querySelector('#browseBtn');
    const dropzone = panel.querySelector('#dropzone');

    browseBtn?.addEventListener('click', () => fileInput.click());

    fileInput?.addEventListener('change', () => {
      if (fileInput.files) {
        this.uploadFiles(Array.from(fileInput.files));
      }
    });

    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone?.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const dt = (e as DragEvent).dataTransfer;
      if (dt?.files) {
        this.uploadFiles(Array.from(dt.files));
      }
    });
  }

  private async uploadFiles(files: File[]) {
    if (!this.workItem) return;

    for (const file of files) {
      try {
        const reader = new FileReader();
        const contentBase64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]); // Remove data URL prefix
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        await window.electronAPI.wiUploadAttachment(
          this.config.organization,
          this.config.project,
          this.workItem.id,
          file.name,
          contentBase64
        );
      } catch (error) {
        console.error('Failed to upload file:', file.name, error);
        alert(`Failed to upload ${file.name}: ` + (error as Error).message);
      }
    }

    // Refresh work item to show new attachments
    this.onRefreshRequestCallback?.();
  }

  private renderAttachment(relation: WorkItemRelation): string {
    const name = relation.attributes?.name || relation.url.split('/').pop() || 'Attachment';
    const comment = relation.attributes?.comment || '';

    return `
      <div class="workitem-attachment" data-url="${escapeHtml(relation.url)}">
        <div class="workitem-attachment-icon">
          ${getIcon(File, 24)}
        </div>
        <div class="workitem-attachment-info">
          <span class="workitem-attachment-name">${escapeHtml(name)}</span>
          ${comment ? `<span class="workitem-attachment-comment">${escapeHtml(comment)}</span>` : ''}
        </div>
        <div class="workitem-attachment-actions">
          <button class="btn btn-icon btn-small download-attachment-btn" title="Download">
            ${getIcon(Download, 16)}
          </button>
          <button class="btn btn-icon btn-small btn-danger remove-attachment-btn" title="Remove">
            ${getIcon(X, 16)}
          </button>
        </div>
      </div>
    `;
  }

  private renderWikiPanel() {
    const panel = this.container.querySelector('#wikiPanel')!;
    if (!this.workItem) return;

    const hyperlinks = (this.workItem.relations || []).filter(r => r.rel === 'Hyperlink');

    panel.innerHTML = `
      <div class="workitem-wiki">
        <div class="workitem-wiki-actions">
          <button class="btn btn-secondary" id="linkWikiBtn">
            ${getIcon(Link, 16)}
            Link Wiki Page
          </button>
          <button class="btn btn-secondary" id="createWikiBtn">
            ${getIcon(Edit, 16)}
            Create Wiki Page
          </button>
        </div>
        <div class="workitem-wiki-list">
          ${hyperlinks.length === 0
            ? '<p class="text-muted">No wiki links</p>'
            : hyperlinks.map(h => this.renderWikiLink(h)).join('')
          }
        </div>
      </div>
    `;

    // Link wiki button handler
    panel.querySelector('#linkWikiBtn')?.addEventListener('click', () => {
      this.showWikiSearchModal();
    });

    // Create wiki button handler
    panel.querySelector('#createWikiBtn')?.addEventListener('click', () => {
      this.showCreateWikiModal();
    });

    // Remove link handlers
    panel.querySelectorAll('.remove-wiki-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const url = (e.currentTarget as HTMLElement).closest('.workitem-wiki-link')?.getAttribute('data-url');
        if (url && confirm('Remove this link?')) {
          try {
            await window.electronAPI.wiRemoveHyperlink(
              this.config.organization,
              this.config.project,
              this.workItem!.id,
              url
            );
            this.onRefreshRequestCallback?.();
          } catch (error) {
            alert('Failed to remove link: ' + (error as Error).message);
          }
        }
      });
    });

    // Wiki name link click handlers
    panel.querySelectorAll('.workitem-wiki-name').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const url = (link as HTMLElement).closest('.workitem-wiki-link')?.getAttribute('data-url');
        if (url) {
          window.electronAPI.openExternal(url);
        }
      });
    });

    // Open wiki button handlers
    panel.querySelectorAll('.open-wiki-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = (btn as HTMLElement).closest('.workitem-wiki-link')?.getAttribute('data-url');
        if (url) {
          window.electronAPI.openExternal(url);
        }
      });
    });
  }

  private renderWikiLink(relation: WorkItemRelation): string {
    const url = relation.url;
    const comment = relation.attributes?.comment || '';
    const name = comment || this.extractWikiPageName(url);

    return `
      <div class="workitem-wiki-link" data-url="${escapeHtml(url)}">
        <div class="workitem-wiki-icon">
          ${getIcon(BookOpen, 24)}
        </div>
        <div class="workitem-wiki-info">
          <a href="#" class="workitem-wiki-name">${escapeHtml(name)}</a>
        </div>
        <div class="workitem-wiki-actions">
          <button class="btn btn-icon btn-small open-wiki-btn" title="Open">
            ${getIcon(ExternalLink, 16)}
          </button>
          <button class="btn btn-icon btn-small btn-danger remove-wiki-btn" title="Remove">
            ${getIcon(X, 16)}
          </button>
        </div>
      </div>
    `;
  }

  private extractWikiPageName(url: string): string {
    // Try to extract page name from ADO wiki URL
    const match = url.match(/\/wiki\/[^\/]+\/(.+)$/);
    if (match) {
      return decodeURIComponent(match[1].replace(/-/g, ' '));
    }
    return url;
  }

  private async showWikiSearchModal() {
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal wiki-search-modal">
        <header class="modal-header">
          <h2>Link Wiki Page</h2>
          <button class="btn btn-icon close-modal-btn">
            ${getIcon(X, 20)}
          </button>
        </header>
        <div class="modal-body">
          <div class="wiki-search-form">
            <input type="text" id="wikiSearchInput" class="form-input" placeholder="Search wiki pages...">
            <button class="btn btn-primary" id="wikiSearchBtn">Search</button>
          </div>
          <div class="wiki-search-results" id="wikiSearchResults">
            <p class="text-muted">Enter a search term to find wiki pages</p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handler
    modal.querySelector('.close-modal-btn')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Search handler
    const searchBtn = modal.querySelector('#wikiSearchBtn');
    const searchInput = modal.querySelector('#wikiSearchInput') as HTMLInputElement;
    const resultsDiv = modal.querySelector('#wikiSearchResults')!;

    const doSearch = async () => {
      const searchText = searchInput.value.trim();
      if (!searchText) return;

      resultsDiv.innerHTML = '<p>Searching...</p>';

      try {
        const results = await window.electronAPI.wiSearchWiki(
          this.config.organization,
          this.config.project,
          searchText
        );

        if (results.length === 0) {
          resultsDiv.innerHTML = '<p class="text-muted">No results found</p>';
          return;
        }

        resultsDiv.innerHTML = results.map((r: any) => `
          <div class="wiki-search-result" data-url="${escapeHtml(r.url || '')}">
            <span class="wiki-result-path">${escapeHtml(r.path || r.fileName || 'Unknown')}</span>
          </div>
        `).join('');

        // Click handler for results
        resultsDiv.querySelectorAll('.wiki-search-result').forEach(result => {
          result.addEventListener('click', async () => {
            const url = (result as HTMLElement).dataset.url;
            if (url) {
              try {
                await window.electronAPI.wiAddHyperlink(
                  this.config.organization,
                  this.config.project,
                  this.workItem!.id,
                  url
                );
                modal.remove();
                this.onRefreshRequestCallback?.();
              } catch (error) {
                alert('Failed to add link: ' + (error as Error).message);
              }
            }
          });
        });
      } catch (error) {
        resultsDiv.innerHTML = `<p class="text-error">Search failed: ${(error as Error).message}</p>`;
      }
    };

    searchBtn?.addEventListener('click', doSearch);
    searchInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') doSearch(); });
    searchInput?.focus();
  }

  private async showCreateWikiModal() {
    // First get available wikis
    let wikis: any[] = [];
    try {
      wikis = await window.electronAPI.wiGetWikis(this.config.organization, this.config.project);
    } catch (error) {
      alert('Failed to load wikis: ' + (error as Error).message);
      return;
    }

    if (wikis.length === 0) {
      alert('No wikis found in this project');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal wiki-create-modal">
        <header class="modal-header">
          <h2>Create Wiki Page</h2>
          <button class="btn btn-icon close-modal-btn">
            ${getIcon(X, 20)}
          </button>
        </header>
        <div class="modal-body">
          <div class="form-field">
            <label for="wikiSelect">Wiki</label>
            <select id="wikiSelect" class="form-select">
              ${wikis.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="pagePathInput">Page Path</label>
            <input type="text" id="pagePathInput" class="form-input" placeholder="/Design/Work-Item-${this.workItem?.id}">
          </div>
          <div class="form-field">
            <label for="pageContentInput">Content</label>
            <textarea id="pageContentInput" class="form-textarea" rows="10" placeholder="# Page Title\n\nPage content here..."></textarea>
          </div>
        </div>
        <footer class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary create-btn">Create & Link</button>
        </footer>
      </div>
    `;

    document.body.appendChild(modal);

    // Pre-fill with work item info
    const pathInput = modal.querySelector('#pagePathInput') as HTMLInputElement;
    const contentInput = modal.querySelector('#pageContentInput') as HTMLTextAreaElement;
    pathInput.value = `/Design/Work-Item-${this.workItem?.id}`;
    contentInput.value = `# ${this.workItem?.fields['System.Title'] || 'Work Item'}\n\n${this.workItem?.fields['System.Description'] || 'Description here...'}`;

    // Close handlers
    modal.querySelector('.close-modal-btn')?.addEventListener('click', () => modal.remove());
    modal.querySelector('.cancel-btn')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Create handler
    modal.querySelector('.create-btn')?.addEventListener('click', async () => {
      const wikiId = (modal.querySelector('#wikiSelect') as HTMLSelectElement).value;
      const path = pathInput.value.trim();
      const content = contentInput.value;

      if (!path) {
        alert('Please enter a page path');
        return;
      }

      try {
        const page = await window.electronAPI.wiCreateWikiPage(
          this.config.organization,
          this.config.project,
          wikiId,
          path,
          content
        );

        // Link the created page
        if (page.remoteUrl) {
          await window.electronAPI.wiAddHyperlink(
            this.config.organization,
            this.config.project,
            this.workItem!.id,
            page.remoteUrl,
            path
          );
        }

        modal.remove();
        this.onRefreshRequestCallback?.();
      } catch (error) {
        alert('Failed to create wiki page: ' + (error as Error).message);
      }
    });
  }

  private renderRelatedPanel() {
    const panel = this.container.querySelector('#relatedPanel')!;
    if (!this.workItem) return;

    const relations = (this.workItem.relations || []).filter(r =>
      r.rel !== 'AttachedFile' && r.rel !== 'Hyperlink'
    );

    if (relations.length === 0) {
      panel.innerHTML = `
        <div class="workitem-empty-panel">
          <p>No related items</p>
        </div>
      `;
      return;
    }

    // Group relations by type
    const grouped = new Map<string, WorkItemRelation[]>();
    relations.forEach(rel => {
      const type = rel.rel;
      if (!grouped.has(type)) {
        grouped.set(type, []);
      }
      grouped.get(type)!.push(rel);
    });

    panel.innerHTML = `
      <div class="workitem-related-list">
        ${Array.from(grouped.entries()).map(([type, rels]) => {
          const typeName = RELATION_TYPE_NAMES[type] || type.split('.').pop() || 'Link';
          return `
            <section class="workitem-related-section">
              <h4>${escapeHtml(typeName)} (${rels.length})</h4>
              <div class="workitem-related-items">
                ${rels.map(rel => this.renderRelatedItem(rel)).join('')}
              </div>
            </section>
          `;
        }).join('')}
      </div>
    `;

    // Attach click handlers for related items
    panel.querySelectorAll('.workitem-related-item[data-item-id]').forEach(item => {
      item.addEventListener('click', () => {
        const id = parseInt((item as HTMLElement).dataset.itemId || '0');
        if (id) {
          this.onOpenRelatedCallback?.(id);
        }
      });
    });
  }

  private renderRelatedItem(relation: WorkItemRelation): string {
    const urlMatch = relation.url.match(/workItems\/(\d+)/);
    const workItemId = urlMatch ? parseInt(urlMatch[1]) : null;
    const relatedItem = workItemId ? this.relatedItems.get(workItemId) : null;

    if (relatedItem) {
      const fields = relatedItem.fields;
      const type = fields['System.WorkItemType'] || 'Task';
      const state = fields['System.State'] || 'New';
      const title = fields['System.Title'] || 'Untitled';
      const typeColor = WORK_ITEM_TYPE_COLORS[type] || '#666';
      const stateColor = WORK_ITEM_STATE_COLORS[state] || '#666';

      return `
        <div class="workitem-related-item" data-item-id="${workItemId}">
          <span class="workitem-type-badge small" style="background-color: ${typeColor}">${escapeHtml(type)}</span>
          <span class="workitem-id">${workItemId}</span>
          <span class="workitem-related-title">${escapeHtml(title)}</span>
          <span class="workitem-state-badge small" style="background-color: ${stateColor}">${escapeHtml(state)}</span>
        </div>
      `;
    }

    return `
      <div class="workitem-related-item" data-item-id="${workItemId || ''}">
        <span class="workitem-id">${workItemId || 'Link'}</span>
        <span class="workitem-related-title">${relation.attributes?.name || relation.url}</span>
      </div>
    `;
  }

  private renderActivityPanel() {
    const panel = this.container.querySelector('#activityPanel')!;

    if (this.updates.length === 0) {
      panel.innerHTML = `
        <div class="workitem-empty-panel">
          <p>No activity history</p>
        </div>
      `;
      return;
    }

    panel.innerHTML = `
      <div class="workitem-activity-timeline">
        ${this.updates.map(update => this.renderActivityItem(update)).join('')}
      </div>
    `;
  }

  private renderActivityItem(update: WorkItemUpdate): string {
    const date = new Date(update.revisedDate);
    const author = update.revisedBy;
    const changes = update.fields || {};
    const changeCount = Object.keys(changes).length;

    if (changeCount === 0 && !update.relations) {
      return '';
    }

    const changesHtml = Object.entries(changes).map(([field, change]) => {
      const fieldName = field.split('.').pop() || field;
      const oldValue = this.formatFieldValue(change.oldValue);
      const newValue = this.formatFieldValue(change.newValue);

      return `
        <div class="workitem-activity-change">
          <span class="workitem-activity-field">${escapeHtml(fieldName)}</span>
          ${oldValue ? `<span class="workitem-activity-old">${escapeHtml(oldValue)}</span>` : ''}
          <span class="workitem-activity-arrow">&rarr;</span>
          <span class="workitem-activity-new">${escapeHtml(newValue)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="workitem-activity-item">
        <div class="workitem-activity-header">
          <span class="workitem-activity-author">
            ${author?.imageUrl ? `<img src="${author.imageUrl}" alt="" class="workitem-avatar-small">` : ''}
            ${escapeHtml(author?.displayName || 'Unknown')}
          </span>
          <span class="workitem-activity-date">${formatTimeAgo(date)}</span>
        </div>
        <div class="workitem-activity-changes">
          ${changesHtml}
        </div>
      </div>
    `;
  }

  private formatFieldValue(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      if (value.displayName) return value.displayName;
      return JSON.stringify(value);
    }
    return String(value);
  }

  private renderHtmlContent(html: string): string {
    return html;
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

}
