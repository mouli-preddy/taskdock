import type { CallDetailsData } from '../../../main/cfv/cfv-types.js';
import { escapeHtml } from '../../utils/html-utils.js';
import { getIcon, Search } from '../../utils/icons.js';

// Same fields as cfv-converter.ts for consistency
const QOE_CATEGORIES: Record<string, string[]> = {
  network: [
    'mediaLine_OutboundStream_Network_Delay_RoundTrip',
    'mediaLine_OutboundStream_Network_Delay_RoundTripMax',
    'mediaLine_OutboundStream_Network_PacketLoss_LossRate',
    'mediaLine_OutboundStream_Network_PacketLoss_LossRateMax',
    'mediaLine_OutboundStream_Network_Jitter_InterArrival',
    'mediaLine_InboundStream_Network_PacketLoss_LossRate',
    'mediaLine_InboundStream_Network_Jitter_InterArrival',
  ],
  device: [
    'mediaLine_v2_LocalClientEvent_v2_CPUInsufficientEventRatio',
    'mediaLine_v2_LocalClientEvent_v2_NetworkReceiveQualityEventRatio',
    'mediaLine_v2_LocalClientEvent_v2_NetworkSendQualityEventRatio',
    'mediaLine_v2_LocalClientEvent_v2_DeviceEchoEventRatio',
    'mediaLine_v2_LocalClientEvent_v2_DeviceClippingEventRatio',
  ],
  connectivity: [
    'connectivity_FirstHopRTTInMs',
    'connectivity_MediaPathLocal',
    'connectivity_MediaPathRemote',
    'connectivity_Protocol',
    'connectivity_TotalBytesSent',
    'connectivity_TotalBytesReceived',
  ],
  endpoint: [
    'endpoint_v2_OS',
    'endpoint_v2_CPUName',
    'endpoint_v2_CPUNumberOfCores',
    'endpoint_v7_DeviceFormFactor',
    'endpoint_v7_MachineInfo',
  ],
};

export class CfvQoePanel {
  private container: HTMLElement;
  private qoeEntries: Array<Record<string, unknown>> = [];
  private filterText = '';

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setData(details: CallDetailsData | null) {
    this.qoeEntries = (details?.callDetails?.qoe ?? []) as Array<Record<string, unknown>>;
    this.render();
  }

  private render() {
    if (this.qoeEntries.length === 0) {
      this.container.innerHTML = '<div class="cfv-no-data"><p>No QoE data available</p></div>';
      return;
    }

    this.container.innerHTML = `
      <div class="cfv-qoe">
        <div class="cfv-qoe-filter">
          ${getIcon(Search, 14)}
          <input type="text" placeholder="Filter metrics..." value="${escapeHtml(this.filterText)}" />
          <span style="font-size:var(--text-sm);color:var(--text-secondary)">${this.qoeEntries.length} QoE entries</span>
        </div>
        <div class="cfv-qoe-body" id="cfvQoeBody"></div>
      </div>
    `;

    this.renderContent();
    this.attachEventListeners();
  }

  private renderContent() {
    const body = this.container.querySelector('#cfvQoeBody');
    if (!body) return;

    // Use the first QoE entry (typically one per participant)
    const entry = this.qoeEntries[0];
    const filterLower = this.filterText.toLowerCase();

    let html = '';

    // Network Path Diagram
    const localPath = String(entry['connectivity_MediaPathLocal'] ?? '');
    const remotePath = String(entry['connectivity_MediaPathRemote'] ?? '');

    html += `
      <div class="cfv-network-path">
        <div class="cfv-network-node">Client${localPath ? `<div style="font-size:10px;color:var(--text-tertiary);font-weight:normal">${escapeHtml(localPath)}</div>` : ''}</div>
        <div class="cfv-network-link"></div>
        <div class="cfv-network-node">Media Processor</div>
        <div class="cfv-network-link"></div>
        <div class="cfv-network-node">SBC / Target${remotePath ? `<div style="font-size:10px;color:var(--text-tertiary);font-weight:normal">${escapeHtml(remotePath)}</div>` : ''}</div>
      </div>
    `;

    // Metrics grouped by category
    for (const [category, fields] of Object.entries(QOE_CATEGORIES)) {
      const rows: string[] = [];

      for (const field of fields) {
        if (!(field in entry)) continue;
        const shortKey = field.includes('_') ? field.split('_').pop()! : field;
        const value = String(entry[field] ?? '');

        // Apply filter
        if (filterLower && !shortKey.toLowerCase().includes(filterLower) && !value.toLowerCase().includes(filterLower) && !field.toLowerCase().includes(filterLower)) {
          continue;
        }

        rows.push(`
          <tr>
            <td title="${escapeHtml(field)}">${escapeHtml(shortKey)}</td>
            <td>${escapeHtml(value)}</td>
          </tr>
        `);
      }

      if (rows.length > 0) {
        html += `
          <div class="cfv-qoe-section">
            <h3>${escapeHtml(category)}</h3>
            <table class="cfv-qoe-table"><tbody>${rows.join('')}</tbody></table>
          </div>
        `;
      }
    }

    // Also show any extra fields not in predefined categories
    const knownFields = new Set(Object.values(QOE_CATEGORIES).flat());
    const extraFields = Object.entries(entry).filter(([k]) => !knownFields.has(k));
    const filteredExtra = filterLower
      ? extraFields.filter(([k, v]) => k.toLowerCase().includes(filterLower) || String(v).toLowerCase().includes(filterLower))
      : extraFields;

    if (filteredExtra.length > 0) {
      const extraRows = filteredExtra.slice(0, 100).map(([k, v]) => `
        <tr>
          <td>${escapeHtml(k)}</td>
          <td>${escapeHtml(String(v ?? ''))}</td>
        </tr>
      `).join('');

      html += `
        <div class="cfv-qoe-section">
          <h3>Other (${filteredExtra.length} fields)</h3>
          <table class="cfv-qoe-table"><tbody>${extraRows}</tbody></table>
        </div>
      `;
    }

    body.innerHTML = html || '<div class="cfv-no-data" style="height:100px"><p>No matching metrics</p></div>';
  }

  private attachEventListeners() {
    const filterInput = this.container.querySelector('.cfv-qoe-filter input') as HTMLInputElement;
    if (filterInput) {
      let debounceTimer: ReturnType<typeof setTimeout>;
      filterInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.filterText = filterInput.value;
          this.renderContent();
        }, 300);
      });
    }
  }

  dispose() {}
}
