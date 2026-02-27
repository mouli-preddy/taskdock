export interface LiveTailCallbacks {
  onStartTail: (intervalMs: number) => void;
  onStopTail: () => void;
}

export class DGrepLiveTail {
  private container: HTMLElement;
  private active = false;
  private intervalMs = 10000;
  private newEventCount = 0;
  private eventsPerSecond = 0;
  private startedAt: number | null = null;
  private userScrolledUp = false;

  private callbacks: LiveTailCallbacks | null = null;

  // For throughput calculation
  private recentEventTimestamps: number[] = [];
  private throughputInterval: ReturnType<typeof setInterval> | null = null;

  // Reference to auto-scroll target (set externally)
  private scrollTarget: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'dgrep-live-tail-container';
    parent.appendChild(this.container);
    this.render();
  }

  setCallbacks(cb: LiveTailCallbacks): void {
    this.callbacks = cb;
  }

  setScrollTarget(el: HTMLElement): void {
    if (this.scrollTarget) {
      this.scrollTarget.removeEventListener('scroll', this.onTargetScroll);
    }
    this.scrollTarget = el;
    el.addEventListener('scroll', this.onTargetScroll, { passive: true });
  }

  isActive(): boolean {
    return this.active;
  }

  /** Called when new live tail rows arrive from the backend */
  onNewRows(count: number): void {
    this.newEventCount += count;
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      this.recentEventTimestamps.push(now);
    }
    this.render();

    // Auto-scroll to bottom unless user scrolled up
    if (this.active && !this.userScrolledUp && this.scrollTarget) {
      this.scrollTarget.scrollTop = this.scrollTarget.scrollHeight;
    }
  }

  /** Stop the tail programmatically (e.g., when a new search starts) */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.stopThroughputTracking();
    this.callbacks?.onStopTail();
    this.render();
  }

  destroy(): void {
    this.stopThroughputTracking();
    if (this.scrollTarget) {
      this.scrollTarget.removeEventListener('scroll', this.onTargetScroll);
    }
    this.container.remove();
  }

  private onTargetScroll = (): void => {
    if (!this.scrollTarget || !this.active) return;
    const el = this.scrollTarget;
    // If user is within 50px of bottom, consider them "following"
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    this.userScrolledUp = !atBottom;
  };

  private render(): void {
    const elapsed = this.startedAt ? this.formatElapsed(Date.now() - this.startedAt) : '';

    this.container.innerHTML = `
      <button class="btn btn-xs dgrep-live-tail-btn${this.active ? ' active' : ''}">
        ${this.active ? '<span class="dgrep-live-tail-dot"></span>' : ''}
        Live Tail
      </button>
      <select class="dgrep-select dgrep-select-sm dgrep-live-tail-interval" title="Poll interval">
        <option value="5000"${this.intervalMs === 5000 ? ' selected' : ''}>5s</option>
        <option value="10000"${this.intervalMs === 10000 ? ' selected' : ''}>10s</option>
        <option value="30000"${this.intervalMs === 30000 ? ' selected' : ''}>30s</option>
      </select>
      ${this.active ? `
        <span class="dgrep-live-tail-status">
          Tailing... ${this.newEventCount} new event${this.newEventCount !== 1 ? 's' : ''}
          ${this.eventsPerSecond > 0 ? `(${this.eventsPerSecond} events/s)` : ''}
          ${elapsed ? ` \u2014 ${elapsed}` : ''}
        </span>
      ` : ''}
    `;

    this.attachEvents();
  }

  private attachEvents(): void {
    this.container.querySelector('.dgrep-live-tail-btn')?.addEventListener('click', () => {
      this.active = !this.active;
      if (this.active) {
        this.newEventCount = 0;
        this.startedAt = Date.now();
        this.userScrolledUp = false;
        this.startThroughputTracking();
        this.callbacks?.onStartTail(this.intervalMs);
      } else {
        this.stopThroughputTracking();
        this.callbacks?.onStopTail();
      }
      this.render();
    });

    const intervalSelect = this.container.querySelector('.dgrep-live-tail-interval') as HTMLSelectElement;
    intervalSelect?.addEventListener('change', () => {
      this.intervalMs = parseInt(intervalSelect.value, 10);
      if (this.active) {
        // Restart with new interval
        this.callbacks?.onStopTail();
        this.callbacks?.onStartTail(this.intervalMs);
      }
    });
  }

  private startThroughputTracking(): void {
    this.recentEventTimestamps = [];
    this.throughputInterval = setInterval(() => {
      const now = Date.now();
      // Keep only events from the last 10 seconds
      this.recentEventTimestamps = this.recentEventTimestamps.filter(t => now - t < 10000);
      this.eventsPerSecond = Math.round(this.recentEventTimestamps.length / 10);
      this.render();
    }, 2000);
  }

  private stopThroughputTracking(): void {
    if (this.throughputInterval != null) {
      clearInterval(this.throughputInterval);
      this.throughputInterval = null;
    }
    this.eventsPerSecond = 0;
    this.startedAt = null;
  }

  private formatElapsed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) return `${minutes}m ${secs}s`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
}
