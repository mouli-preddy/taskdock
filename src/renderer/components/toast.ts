import { escapeHtml } from '../utils/html-utils.js';
import { iconHtml, CheckCircle, XCircle, AlertTriangle, Info, X } from '../utils/icons.js';

export class Toast {
  private static container: HTMLElement | null = null;
  private static timeouts: Map<HTMLElement, number> = new Map();

  private static getContainer(): HTMLElement {
    if (!this.container) {
      this.container = document.getElementById('toastContainer');
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.id = 'toastContainer';
        this.container.className = 'toast-container';
        document.body.appendChild(this.container);
      }
    }
    return this.container;
  }

  private static show(message: string, type: 'success' | 'error' | 'warning' | 'info', duration = 4000) {
    const container = this.getContainer();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      ${this.getIcon(type)}
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-close" aria-label="Close">
        ${iconHtml(X, { size: 14 })}
      </button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn?.addEventListener('click', () => this.dismiss(toast));

    container.appendChild(toast);

    // Auto dismiss
    if (duration > 0) {
      const timeoutId = window.setTimeout(() => this.dismiss(toast), duration);
      this.timeouts.set(toast, timeoutId);
    }
  }

  private static dismiss(toast: HTMLElement) {
    const timeoutId = this.timeouts.get(toast);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.timeouts.delete(toast);
    }

    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }

  private static getIcon(type: 'success' | 'error' | 'warning' | 'info'): string {
    const iconStyle = 'style="flex-shrink: 0;"';
    switch (type) {
      case 'success':
        return iconHtml(CheckCircle, { size: 20, color: 'var(--success)' }).replace('<svg', `<svg ${iconStyle}`);
      case 'error':
        return iconHtml(XCircle, { size: 20, color: 'var(--error)' }).replace('<svg', `<svg ${iconStyle}`);
      case 'warning':
        return iconHtml(AlertTriangle, { size: 20, color: 'var(--warning)' }).replace('<svg', `<svg ${iconStyle}`);
      case 'info':
      default:
        return iconHtml(Info, { size: 20, color: 'var(--info)' }).replace('<svg', `<svg ${iconStyle}`);
    }
  }

  static success(message: string, duration?: number) {
    this.show(message, 'success', duration);
  }

  static error(message: string, duration?: number) {
    this.show(message, 'error', duration);
  }

  static warning(message: string, duration?: number) {
    this.show(message, 'warning', duration);
  }

  static info(message: string, duration?: number) {
    this.show(message, 'info', duration);
  }
}

// Add slideOut animation
const style = document.createElement('style');
style.textContent = `
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }

  .toast-close {
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
  }

  .toast-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .toast-message {
    flex: 1;
    font-size: var(--font-size-sm);
  }
`;
document.head.appendChild(style);
