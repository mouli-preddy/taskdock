import { escapeHtml } from '../utils/html-utils.js';
import { getIcon, X } from '../utils/icons.js';

export interface Tab {
  id: string;
  label: string;
  icon?: string;
  closeable: boolean;
}

export class TabBar {
  private container: HTMLElement;
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private selectCallback: ((tabId: string) => void) | null = null;
  private closeCallback: ((tabId: string) => void) | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
  }

  onSelect(callback: (tabId: string) => void) {
    this.selectCallback = callback;
  }

  onClose(callback: (tabId: string) => void) {
    this.closeCallback = callback;
  }

  setTabs(tabs: Tab[]) {
    this.tabs = tabs;
    this.render();
  }

  addTab(tab: Tab) {
    if (this.tabs.find(t => t.id === tab.id)) {
      this.setActive(tab.id);
      return;
    }
    this.tabs.push(tab);
    this.render();
  }

  removeTab(tabId: string) {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    const tab = this.tabs[index];
    if (!tab.closeable) return;

    this.tabs.splice(index, 1);

    if (this.activeTabId === tabId) {
      const newIndex = Math.min(index, this.tabs.length - 1);
      this.activeTabId = this.tabs[newIndex]?.id || null;
      if (this.activeTabId) {
        this.selectCallback?.(this.activeTabId);
      }
    }

    this.render();
  }

  setActive(tabId: string) {
    if (!this.tabs.find(t => t.id === tabId)) return;
    this.activeTabId = tabId;
    this.updateActiveState();
  }

  getActive(): string | null {
    return this.activeTabId;
  }

  getTabs(): Tab[] {
    return [...this.tabs];
  }

  private render() {
    this.container.innerHTML = `
      <div class="tab-bar-tabs">
        ${this.tabs.map(tab => `
          <div class="tab-bar-tab ${tab.id === this.activeTabId ? 'active' : ''}" data-tab-id="${tab.id}">
            ${tab.icon ? `<span class="tab-icon">${tab.icon}</span>` : ''}
            <span class="tab-label">${escapeHtml(tab.label)}</span>
            ${tab.closeable ? `
              <button class="tab-close" data-tab-id="${tab.id}" title="Close">
                ${getIcon(X, 14)}
              </button>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners() {
    this.container.querySelectorAll('.tab-bar-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.tab-close')) return;

        const tabId = (tab as HTMLElement).dataset.tabId!;
        this.setActive(tabId);
        this.selectCallback?.(tabId);
      });

      tab.addEventListener('auxclick', (e) => {
        if ((e as MouseEvent).button === 1) {
          const tabId = (tab as HTMLElement).dataset.tabId!;
          const tabData = this.tabs.find(t => t.id === tabId);
          if (tabData?.closeable) {
            this.closeCallback?.(tabId);
          }
        }
      });
    });

    this.container.querySelectorAll('.tab-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabId = (btn as HTMLElement).dataset.tabId!;
        this.closeCallback?.(tabId);
      });
    });
  }

  private updateActiveState() {
    this.container.querySelectorAll('.tab-bar-tab').forEach(tab => {
      const tabId = (tab as HTMLElement).dataset.tabId;
      tab.classList.toggle('active', tabId === this.activeTabId);
    });
  }

}
