/**
 * HTML and text formatting utilities
 * Shared utilities for renderer components
 */

/**
 * Escape HTML special characters to prevent XSS
 * Uses DOM-based escaping for safety
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Time constants in milliseconds
 */
const MS_PER_MINUTE = 60000;
const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

/**
 * Format a date as a human-readable relative time string
 * e.g., "just now", "5m ago", "2h ago", "3d ago"
 */
export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / MS_PER_MINUTE);
  const diffHours = Math.floor(diffMs / MS_PER_HOUR);
  const diffDays = Math.floor(diffMs / MS_PER_DAY);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Format basic markdown-like content (code blocks, inline code, bold)
 * Does NOT support full markdown - use marked.js for that
 */
export function formatSimpleMarkdown(content: string, options: { includeItalic?: boolean } = {}): string {
  let formatted = escapeHtml(content);
  formatted = formatted.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  if (options.includeItalic) {
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }
  formatted = formatted.replace(/\n/g, '<br>');
  return formatted;
}
