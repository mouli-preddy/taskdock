import type { IcmIncident, IcmDiscussionEntry, IcmCustomField } from '../../shared/icm-types.js';
import { ICM_SEVERITY_COLORS, ICM_STATE_COLORS } from '../../shared/icm-types.js';
import { escapeHtml, formatTimeAgo } from '../utils/html-utils.js';
import { getIcon, ExternalLink, RefreshCw, Check, AlertTriangle, Clock, MessageSquare, Send } from '../utils/icons.js';

type DetailPanel = 'summary' | 'impact' | 'troubleshooting' | 'mitigation' | 'customFields' | 'activity';

export class IcmIncidentDetailView {
  private container: HTMLElement;
  private incident: IcmIncident | null = null;
  private activePanel: DetailPanel = 'summary';
  private loading = false;

  private onOpenInBrowserCallback: ((url: string) => void) | null = null;
  private onRefreshRequestCallback: (() => void) | null = null;
  private onIncidentUpdatedCallback: ((incident: IcmIncident) => void) | null = null;
  private onActionCallback: ((action: string, incidentId: number) => Promise<void>) | null = null;
  private onAddDiscussionCallback: ((incidentId: number, text: string) => Promise<void>) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  onOpenInBrowser(callback: (url: string) => void) {
    this.onOpenInBrowserCallback = callback;
  }

  onRefreshRequest(callback: () => void) {
    this.onRefreshRequestCallback = callback;
  }

  onIncidentUpdated(callback: (incident: IcmIncident) => void) {
    this.onIncidentUpdatedCallback = callback;
  }

  onAction(callback: (action: string, incidentId: number) => Promise<void>) {
    this.onActionCallback = callback;
  }

  onAddDiscussion(callback: (incidentId: number, text: string) => Promise<void>) {
    this.onAddDiscussionCallback = callback;
  }

  setIncident(incident: IcmIncident) {
    this.incident = incident;
    this.loading = false;
    this.render();
  }

  setLoading(loading: boolean) {
    this.loading = loading;
    this.render();
  }

  private render() {
    if (this.loading) {
      this.container.innerHTML = `
        <div class="icm-detail-loading">
          <div class="loading-spinner"></div>
          <p>Loading incident...</p>
        </div>
      `;
      return;
    }

    if (!this.incident) {
      this.container.innerHTML = `
        <div class="icm-detail-empty">
          <p>No incident selected</p>
        </div>
      `;
      return;
    }

    const inc = this.incident;
    const sevColor = ICM_SEVERITY_COLORS[inc.Severity] || '#666';
    const stateColor = ICM_STATE_COLORS[inc.State] || '#666';

    this.container.innerHTML = `
      <div class="icm-detail-view">
        <header class="icm-detail-header">
          <div class="icm-detail-title-row">
            <span class="icm-severity-badge" style="background-color: ${sevColor}">Sev ${inc.Severity === 25 ? '2.5' : inc.Severity}</span>
            <span class="icm-incident-id">${inc.Id}</span>
            <span class="icm-state-badge" style="background-color: ${stateColor}">${escapeHtml(inc.State)}</span>
            <div class="icm-header-actions">
              <button class="btn btn-secondary btn-small" id="icmOpenInBrowserBtn">
                ${getIcon(ExternalLink, 14)}
                Open in ICM
              </button>
              <button class="btn btn-secondary btn-small" id="icmRefreshBtn">
                ${getIcon(RefreshCw, 14)}
              </button>
            </div>
          </div>
          <h1 class="icm-detail-title">${escapeHtml(inc.Title)}</h1>
          <div class="icm-detail-status-bar">
            <span class="icm-detail-meta" title="Duration">${getIcon(Clock, 14)} ${escapeHtml(inc.Duration || 'N/A')}</span>
            <span class="icm-detail-meta" title="Owning Service">${escapeHtml(inc.OwningTenantName)}</span>
            <span class="icm-detail-meta" title="Owning Team">${escapeHtml(inc.OwningTeamName)}</span>
            <span class="icm-detail-meta" title="Owner">${escapeHtml(inc.ContactAlias)}</span>
          </div>
          <div class="icm-detail-actions">
            ${inc.State === 'Active' ? `
              <button class="btn btn-small btn-primary" data-action="acknowledge" title="Acknowledge">
                ${getIcon(Check, 14)} Acknowledge
              </button>
              <button class="btn btn-small btn-warning" data-action="mitigate" title="Mitigate">
                Mitigate
              </button>
              <button class="btn btn-small btn-success" data-action="resolve" title="Resolve">
                Resolve
              </button>
            ` : ''}
            ${inc.State === 'Mitigated' ? `
              <button class="btn btn-small btn-success" data-action="resolve" title="Resolve">
                Resolve
              </button>
            ` : ''}
          </div>
        </header>

        <nav class="icm-detail-tabs">
          <button class="icm-tab ${this.activePanel === 'summary' ? 'active' : ''}" data-panel="summary">Summary & Discussion</button>
          <button class="icm-tab ${this.activePanel === 'impact' ? 'active' : ''}" data-panel="impact">Impact Assessment</button>
          <button class="icm-tab ${this.activePanel === 'troubleshooting' ? 'active' : ''}" data-panel="troubleshooting">Troubleshooting</button>
          <button class="icm-tab ${this.activePanel === 'mitigation' ? 'active' : ''}" data-panel="mitigation">Mitigation & Resolution</button>
          <button class="icm-tab ${this.activePanel === 'customFields' ? 'active' : ''}" data-panel="customFields">Custom Fields</button>
          <button class="icm-tab ${this.activePanel === 'activity' ? 'active' : ''}" data-panel="activity">Activity Log</button>
        </nav>

        <div class="icm-detail-content">
          <div class="icm-panel" id="icmSummaryPanel" ${this.activePanel !== 'summary' ? 'style="display:none"' : ''}></div>
          <div class="icm-panel" id="icmImpactPanel" ${this.activePanel !== 'impact' ? 'style="display:none"' : ''}></div>
          <div class="icm-panel" id="icmTroubleshootingPanel" ${this.activePanel !== 'troubleshooting' ? 'style="display:none"' : ''}></div>
          <div class="icm-panel" id="icmMitigationPanel" ${this.activePanel !== 'mitigation' ? 'style="display:none"' : ''}></div>
          <div class="icm-panel" id="icmCustomFieldsPanel" ${this.activePanel !== 'customFields' ? 'style="display:none"' : ''}></div>
          <div class="icm-panel" id="icmActivityPanel" ${this.activePanel !== 'activity' ? 'style="display:none"' : ''}></div>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.renderActivePanel();
  }

  private attachEventListeners() {
    // Tab switching
    this.container.querySelectorAll('.icm-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const panel = (tab as HTMLElement).dataset.panel as DetailPanel;
        this.switchPanel(panel);
      });
    });

    // Open in browser
    this.container.querySelector('#icmOpenInBrowserBtn')?.addEventListener('click', () => {
      if (this.incident) {
        const url = `https://portal.microsofticm.com/imp/v3/incidents/details/${this.incident.Id}/home`;
        this.onOpenInBrowserCallback?.(url);
      }
    });

    // Refresh
    this.container.querySelector('#icmRefreshBtn')?.addEventListener('click', () => {
      this.onRefreshRequestCallback?.();
    });

    // Action buttons
    this.container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!this.incident) return;
        const action = (btn as HTMLElement).dataset.action!;
        (btn as HTMLButtonElement).disabled = true;
        try {
          await this.onActionCallback?.(action, this.incident.Id);
        } finally {
          (btn as HTMLButtonElement).disabled = false;
        }
      });
    });
  }

  private switchPanel(panel: DetailPanel) {
    this.activePanel = panel;

    // Update tab states
    this.container.querySelectorAll('.icm-tab').forEach(tab => {
      tab.classList.toggle('active', (tab as HTMLElement).dataset.panel === panel);
    });

    // Show/hide panels
    this.container.querySelectorAll('.icm-panel').forEach(p => {
      (p as HTMLElement).style.display = 'none';
    });

    const panelMap: Record<DetailPanel, string> = {
      summary: 'icmSummaryPanel',
      impact: 'icmImpactPanel',
      troubleshooting: 'icmTroubleshootingPanel',
      mitigation: 'icmMitigationPanel',
      customFields: 'icmCustomFieldsPanel',
      activity: 'icmActivityPanel',
    };

    const activePanel = this.container.querySelector(`#${panelMap[panel]}`) as HTMLElement;
    if (activePanel) {
      activePanel.style.display = '';
    }

    this.renderActivePanel();
  }

  private renderActivePanel() {
    switch (this.activePanel) {
      case 'summary': this.renderSummaryPanel(); break;
      case 'impact': this.renderImpactPanel(); break;
      case 'troubleshooting': this.renderTroubleshootingPanel(); break;
      case 'mitigation': this.renderMitigationPanel(); break;
      case 'customFields': this.renderCustomFieldsPanel(); break;
      case 'activity': this.renderActivityPanel(); break;
    }
  }

  private renderSummaryPanel() {
    const panel = this.container.querySelector('#icmSummaryPanel')!;
    if (!this.incident) return;

    const inc = this.incident;
    const discussion = inc.Discussion || [];

    panel.innerHTML = `
      <div class="icm-summary-layout">
        <div class="icm-summary-main">
          <section class="icm-section">
            <h3>Summary</h3>
            <div class="icm-summary-text">
              ${inc.Summary || '<p class="text-muted">No summary provided</p>'}
            </div>
          </section>

          <section class="icm-section">
            <h3>Discussion (${discussion.length})</h3>
            <div class="icm-add-discussion">
              <textarea id="icmNewDiscussionText" class="form-textarea" rows="3" placeholder="Add a discussion entry..."></textarea>
              <button class="btn btn-primary" id="icmAddDiscussionBtn">
                ${getIcon(Send, 14)} Add
              </button>
            </div>
            <div class="icm-discussion-list">
              ${discussion.length === 0
                ? '<p class="text-muted">No discussion entries</p>'
                : discussion.map(d => this.renderDiscussionEntry(d)).join('')
              }
            </div>
          </section>
        </div>

        <aside class="icm-summary-sidebar">
          <section class="icm-section">
            <h3>Details</h3>
            <dl class="icm-fields">
              <dt>Created</dt>
              <dd>${inc.CreatedDate ? this.formatDate(new Date(inc.CreatedDate)) : 'N/A'}</dd>

              <dt>Created By</dt>
              <dd>${escapeHtml(inc.CreatedBy || 'N/A')}</dd>

              <dt>Owner</dt>
              <dd>${escapeHtml(inc.ContactAlias || 'N/A')}</dd>

              <dt>Owning Team</dt>
              <dd>${escapeHtml(inc.OwningTeamName || 'N/A')}</dd>

              <dt>Owning Service</dt>
              <dd>${escapeHtml(inc.OwningTenantName || 'N/A')}</dd>

              <dt>Acknowledge By</dt>
              <dd>${escapeHtml(inc.AcknowledgeBy || 'N/A')}</dd>

              <dt>Hit Count</dt>
              <dd>${inc.HitCount}</dd>

              <dt>Child Count</dt>
              <dd>${inc.ChildCount}</dd>

              ${inc.Tags?.length ? `
                <dt>Tags</dt>
                <dd>
                  <div class="icm-tags">
                    ${inc.Tags.map(tag => `<span class="icm-tag">${escapeHtml(tag)}</span>`).join('')}
                  </div>
                </dd>
              ` : ''}

              ${inc.Keywords ? `
                <dt>Keywords</dt>
                <dd>${escapeHtml(inc.Keywords)}</dd>
              ` : ''}

              ${inc.Environment ? `
                <dt>Environment</dt>
                <dd>${escapeHtml(inc.Environment)}</dd>
              ` : ''}

              ${inc.AlertSource ? `
                <dt>Alert Source</dt>
                <dd>${escapeHtml(inc.AlertSource.Name)}</dd>
              ` : ''}
            </dl>
          </section>
        </aside>
      </div>
    `;

    // Add discussion handler
    panel.querySelector('#icmAddDiscussionBtn')?.addEventListener('click', async () => {
      const textarea = panel.querySelector('#icmNewDiscussionText') as HTMLTextAreaElement;
      const text = textarea.value.trim();
      if (!text || !this.incident) return;

      const btn = panel.querySelector('#icmAddDiscussionBtn') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Adding...';

      try {
        await this.onAddDiscussionCallback?.(this.incident.Id, text);
        textarea.value = '';
        this.onRefreshRequestCallback?.();
      } catch (error) {
        console.error('Failed to add discussion:', error);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `${getIcon(Send, 14)} Add`;
      }
    });
  }

  private renderDiscussionEntry(entry: IcmDiscussionEntry): string {
    const isEnrichment = entry.Type === 'Enrichment';
    return `
      <div class="icm-discussion-entry ${isEnrichment ? 'icm-discussion-enrichment' : ''}">
        <div class="icm-discussion-header">
          <span class="icm-discussion-author">${escapeHtml(entry.AuthorDisplayName || entry.Author)}</span>
          ${isEnrichment && entry.WorkflowName ? `<span class="icm-discussion-workflow">${escapeHtml(entry.WorkflowName)}</span>` : ''}
          <span class="icm-discussion-date">${formatTimeAgo(new Date(entry.SubmittedAt))}</span>
        </div>
        <div class="icm-discussion-body">${entry.Body}</div>
      </div>
    `;
  }

  private renderImpactPanel() {
    const panel = this.container.querySelector('#icmImpactPanel')!;
    if (!this.incident) return;

    const inc = this.incident;

    panel.innerHTML = `
      <div class="icm-impact-view">
        <dl class="icm-fields icm-fields-wide">
          <dt>Impact Start Time</dt>
          <dd>${inc.ImpactStartTime ? this.formatDate(new Date(inc.ImpactStartTime)) : 'Not specified'}</dd>

          <dt>Customer Impacting</dt>
          <dd>
            <span class="icm-bool-badge ${inc.IsCustomerImpacting ? 'icm-bool-yes' : 'icm-bool-no'}">
              ${inc.IsCustomerImpacting ? 'Yes' : 'No'}
            </span>
          </dd>

          <dt>Outage</dt>
          <dd>
            <span class="icm-bool-badge ${inc.IsOutage ? 'icm-bool-yes' : 'icm-bool-no'}">
              ${inc.IsOutage ? 'Yes' : 'No'}
            </span>
          </dd>

          <dt>Noise</dt>
          <dd>
            <span class="icm-bool-badge ${inc.IsNoise ? 'icm-bool-yes' : 'icm-bool-no'}">
              ${inc.IsNoise ? 'Yes' : 'No'}
            </span>
          </dd>

          <dt>Notification Status</dt>
          <dd>${escapeHtml(inc.NotificationStatus || 'N/A')}</dd>

          <dt>External Links Count</dt>
          <dd>${inc.ExternalLinksCount}</dd>
        </dl>
      </div>
    `;
  }

  private renderTroubleshootingPanel() {
    const panel = this.container.querySelector('#icmTroubleshootingPanel')!;
    if (!this.incident) return;

    // Troubleshooting data comes from discussion entries and enrichments
    const enrichments = (this.incident.Discussion || []).filter(d => d.Type === 'Enrichment');

    panel.innerHTML = `
      <div class="icm-troubleshooting-view">
        ${enrichments.length > 0 ? `
          <section class="icm-section">
            <h3>Enrichment Data</h3>
            <div class="icm-discussion-list">
              ${enrichments.map(e => this.renderDiscussionEntry(e)).join('')}
            </div>
          </section>
        ` : `
          <div class="icm-empty-panel">
            <p>No troubleshooting data available</p>
          </div>
        `}
      </div>
    `;
  }

  private renderMitigationPanel() {
    const panel = this.container.querySelector('#icmMitigationPanel')!;
    if (!this.incident) return;

    const inc = this.incident;

    panel.innerHTML = `
      <div class="icm-mitigation-view">
        <dl class="icm-fields icm-fields-wide">
          <dt>State</dt>
          <dd>
            <span class="icm-state-badge" style="background-color: ${ICM_STATE_COLORS[inc.State] || '#666'}">
              ${escapeHtml(inc.State)}
            </span>
          </dd>

          <dt>Mitigate Date</dt>
          <dd>${inc.MitigateData?.MitigateTime ? this.formatDate(new Date(inc.MitigateData.MitigateTime)) : 'Not mitigated'}</dd>

          <dt>Resolve Date</dt>
          <dd>${inc.ResolveData?.ResolveTime ? this.formatDate(new Date(inc.ResolveData.ResolveTime)) : 'Not resolved'}</dd>

          <dt>Duration</dt>
          <dd>${escapeHtml(inc.Duration || 'N/A')}</dd>

          ${inc.MitigateData ? `
            <dt>Mitigation Data</dt>
            <dd>
              <pre class="icm-mitigation-data">${escapeHtml(JSON.stringify(inc.MitigateData, null, 2))}</pre>
            </dd>
          ` : ''}
        </dl>
      </div>
    `;
  }

  private renderCustomFieldsPanel() {
    const panel = this.container.querySelector('#icmCustomFieldsPanel')!;
    if (!this.incident) return;

    const fields = this.incident.CustomFields || [];

    if (fields.length === 0) {
      panel.innerHTML = `
        <div class="icm-empty-panel">
          <p>No custom fields</p>
        </div>
      `;
      return;
    }

    panel.innerHTML = `
      <div class="icm-custom-fields-view">
        <table class="icm-custom-fields-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            ${fields.map(f => {
              const val = f.StringValue ?? f.EnumValue ?? (f.BooleanValue != null ? String(f.BooleanValue) : null) ?? (f.NumberValue != null ? String(f.NumberValue) : null) ?? (f.DateTimeOffsetValue ? this.formatDate(new Date(f.DateTimeOffsetValue)) : null) ?? '';
              return `
              <tr>
                <td class="icm-cf-name">${escapeHtml(f.Name)}</td>
                <td class="icm-cf-value">${escapeHtml(val)}</td>
              </tr>
            `;}).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderActivityPanel() {
    const panel = this.container.querySelector('#icmActivityPanel')!;
    if (!this.incident) return;

    const inc = this.incident;

    // Build a basic timeline from available data
    const events: { date: string; label: string; detail: string }[] = [];

    if (inc.CreatedDate) {
      events.push({ date: inc.CreatedDate, label: 'Created', detail: `Created by ${inc.CreatedBy || 'Unknown'}` });
    }
    if (inc.ImpactStartTime) {
      events.push({ date: inc.ImpactStartTime, label: 'Impact Started', detail: 'Impact start time recorded' });
    }
    if (inc.MitigateData?.MitigateTime) {
      events.push({ date: inc.MitigateData.MitigateTime, label: 'Mitigated', detail: `Mitigated by ${inc.MitigateData.MitigatedBy || 'Unknown'}` });
    }
    if (inc.ResolveData?.ResolveTime) {
      events.push({ date: inc.ResolveData.ResolveTime, label: 'Resolved', detail: `Resolved by ${inc.ResolveData.ResolvedBy || 'Unknown'}` });
    }
    if (inc.LastModifiedDate) {
      events.push({ date: inc.LastModifiedDate, label: 'Last Modified', detail: `Modified by ${inc.ModifiedBy || 'Unknown'}` });
    }

    // Sort by date
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (events.length === 0) {
      panel.innerHTML = `
        <div class="icm-empty-panel">
          <p>No activity data available</p>
        </div>
      `;
      return;
    }

    panel.innerHTML = `
      <div class="icm-activity-timeline">
        ${events.map(ev => `
          <div class="icm-activity-item">
            <div class="icm-activity-header">
              <span class="icm-activity-label">${escapeHtml(ev.label)}</span>
              <span class="icm-activity-date">${this.formatDate(new Date(ev.date))}</span>
            </div>
            <div class="icm-activity-detail">${escapeHtml(ev.detail)}</div>
          </div>
        `).join('')}
      </div>
    `;
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
