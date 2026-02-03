/**
 * Walkthroughs View
 * Sidebar section displaying walkthrough sessions
 */

import type { WalkthroughSession, SavedWalkthroughMetadata } from '../../shared/ai-types.js';
import { escapeHtml } from '../utils/html-utils.js';
import { getIcon, Plus, X } from '../utils/icons.js';

type WalkthroughItem = WalkthroughSession | SavedWalkthroughMetadata;

export class WalkthroughsView {
  private container: HTMLElement;
  private sessions: WalkthroughSession[] = [];
  private savedWalkthroughs: SavedWalkthroughMetadata[] = [];
  private activeSessionId: string | null = null;

  private selectCallback?: (sessionId: string, isSaved: boolean) => void;
  private closeCallback?: (sessionId: string, isSaved: boolean) => void;
  private newCallback?: () => void;
  private closePanelCallback?: () => void;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`WalkthroughsView: Container element '${containerId}' not found`);
    }
    this.container = container;
    this.render();
  }

  // Callback setters
  onSelect(callback: (sessionId: string, isSaved: boolean) => void): void {
    this.selectCallback = callback;
  }

  onClose(callback: (sessionId: string, isSaved: boolean) => void): void {
    this.closeCallback = callback;
  }

  onNew(callback: () => void): void {
    this.newCallback = callback;
  }

  onClosePanel(callback: () => void): void {
    this.closePanelCallback = callback;
  }

  // State management
  setSessions(sessions: WalkthroughSession[]): void {
    this.sessions = sessions;
    this.render();
  }

  setSavedWalkthroughs(walkthroughs: SavedWalkthroughMetadata[]): void {
    this.savedWalkthroughs = walkthroughs;
    this.render();
  }

  setActiveSession(sessionId: string | null): void {
    if (this.activeSessionId !== sessionId) {
      this.activeSessionId = sessionId;
      this.render();
    }
  }

  addSession(session: WalkthroughSession): void {
    this.sessions.push(session);
    this.activeSessionId = session.id;
    this.render();
  }

  updateSession(sessionId: string, updates: Partial<WalkthroughSession>): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (session) {
      Object.assign(session, updates);
      this.render();
    }
  }

  removeSession(sessionId: string): void {
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.sessions[0]?.id || null;
    }
    this.render();
  }

  refresh(): void {
    this.render();
  }

  /**
   * Merge active sessions with saved walkthroughs, avoiding duplicates.
   * Active sessions appear first, then saved walkthroughs not in sessions.
   * Items sorted by createdAt descending within each group.
   */
  private getAllItems(): { item: WalkthroughItem; isSaved: boolean }[] {
    const items: { item: WalkthroughItem; isSaved: boolean }[] = [];

    // Get active session IDs for deduplication
    const activeSessionIds = new Set(this.sessions.map(s => s.id));

    // Add active sessions first, sorted by createdAt descending
    const sortedSessions = [...this.sessions].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });
    for (const session of sortedSessions) {
      items.push({ item: session, isSaved: false });
    }

    // Add saved walkthroughs that are not in active sessions, sorted by createdAt descending
    const sortedSaved = [...this.savedWalkthroughs]
      .filter(w => !activeSessionIds.has(w.sessionId))
      .sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA;
      });
    for (const saved of sortedSaved) {
      items.push({ item: saved, isSaved: true });
    }

    return items;
  }

  private render(): void {
    const allItems = this.getAllItems();
    const totalCount = allItems.length;

    this.container.innerHTML = `
      <div class="walkthroughs-view">
        <div class="walkthroughs-header">
          <span>Walkthroughs</span>
          <span class="walkthrough-count">${totalCount}</span>
          <button class="btn btn-icon new-walkthrough-btn" title="Request Walkthrough">
            ${getIcon(Plus, 14)}
          </button>
          <button class="btn btn-icon close-walkthroughs-btn" title="Close">
            ${getIcon(X, 16)}
          </button>
        </div>
        <div class="walkthroughs-list">
          ${totalCount === 0 ? `
            <div class="walkthroughs-empty">
              <p>No walkthroughs yet</p>
              <p class="hint">Click + to request a walkthrough</p>
            </div>
          ` : allItems.map(({ item, isSaved }) => this.renderItem(item, isSaved)).join('')}
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  private renderItem(item: WalkthroughItem, isSaved: boolean): string {
    // Determine sessionId based on item type
    const sessionId = isSaved
      ? (item as SavedWalkthroughMetadata).sessionId
      : (item as WalkthroughSession).id;

    // Determine display name based on item type
    const name = isSaved
      ? (item as SavedWalkthroughMetadata).displayName
      : (item as WalkthroughSession).name;

    // Determine status (saved items show as 'saved' state)
    const status = isSaved ? 'saved' : (item as WalkthroughSession).status;
    const statusText = this.getStatusText(status);

    // Determine metadata (read time and step count)
    let readTime: number;
    let stepCount: number;
    if (isSaved) {
      const savedItem = item as SavedWalkthroughMetadata;
      readTime = savedItem.estimatedReadTime;
      stepCount = savedItem.stepCount;
    } else {
      const session = item as WalkthroughSession;
      readTime = session.walkthrough?.estimatedReadTime || 0;
      stepCount = session.walkthrough?.totalSteps || 0;
    }

    // Determine if this item is active
    const isActive = sessionId === this.activeSessionId;

    // Build class names
    const classes = [
      'walkthrough-item',
      isActive ? 'active' : '',
      status,
      isSaved ? 'saved' : ''
    ].filter(Boolean).join(' ');

    return `
      <div class="${classes}" data-id="${sessionId}" data-saved="${isSaved}">
        <span class="walkthrough-status-dot" title="${escapeHtml(statusText)}"></span>
        <div class="walkthrough-info">
          <span class="walkthrough-name">${escapeHtml(name)}</span>
          <span class="walkthrough-meta">${readTime}m · ${stepCount} steps</span>
        </div>
      </div>
    `;
  }

  private getStatusText(status: string): string {
    switch (status) {
      case 'preparing': return 'Preparing...';
      case 'generating': return 'Generating...';
      case 'complete': return 'Complete';
      case 'error': return 'Error';
      case 'cancelled': return 'Cancelled';
      case 'saved': return 'Saved';
      default: return 'Unknown';
    }
  }

  private attachEventListeners(): void {
    // Walkthrough item click (select)
    this.container.querySelectorAll('.walkthrough-item').forEach(item => {
      item.addEventListener('click', () => {
        const element = item as HTMLElement;
        const id = element.dataset.id;
        const isSaved = element.dataset.saved === 'true';

        if (id) {
          this.setActiveSession(id);
          this.selectCallback?.(id, isSaved);
        }
      });
    });

    // New walkthrough button
    this.container.querySelector('.new-walkthrough-btn')?.addEventListener('click', () => {
      this.newCallback?.();
    });

    // Close panel button
    this.container.querySelector('.close-walkthroughs-btn')?.addEventListener('click', () => {
      this.closePanelCallback?.();
    });
  }
}
