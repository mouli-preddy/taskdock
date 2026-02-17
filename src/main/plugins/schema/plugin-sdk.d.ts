/**
 * TaskDock Plugin SDK - Type Definitions
 *
 * This file defines the context object available to plugin workflow scripts.
 * Workflow scripts export a default async function that receives this context:
 *
 * export default async function(ctx: PluginContext) {
 *   // Your workflow logic here
 * }
 */

export interface PluginContext {
  /** Data passed from the trigger (button click payload, polling context, etc.) */
  input: Record<string, any>;

  /** Plugin configuration values set by the user in Settings */
  config: Record<string, any>;

  /** HTTP client for calling external APIs */
  http: {
    get(url: string, opts?: { headers?: Record<string, string> }): Promise<any>;
    post(url: string, body: any, opts?: { headers?: Record<string, string> }): Promise<any>;
    put(url: string, body: any, opts?: { headers?: Record<string, string> }): Promise<any>;
    delete(url: string, opts?: { headers?: Record<string, string> }): Promise<any>;
  };

  /** Shell command execution */
  shell: {
    run(command: string, opts?: { cwd?: string; timeout?: number }): Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>;
  };

  /** AI provider calls */
  ai: {
    /** Send a prompt to Claude SDK and get a text response */
    claude(prompt: string, opts?: { model?: 'sonnet' | 'opus' | 'haiku' }): Promise<string>;
    /** Send a prompt to GitHub Copilot SDK and get a text response */
    copilot(prompt: string, opts?: { model?: 'gpt-4o' | 'gpt-4' | 'gpt-5' | 'claude-3.5-sonnet' }): Promise<string>;
    /** Launch an interactive AI terminal session. Returns the session ID. */
    launchTerminal(opts: {
      ai: 'copilot' | 'claude';
      prompt: string;
      /** Switch the UI to the terminal tab (default: false) */
      show?: boolean;
    }): Promise<string>;
  };

  /** UI manipulation: update components, show toasts, inject into core tabs */
  ui: {
    update(componentId: string, data: any): Promise<void>;
    toast(message: string, level?: 'success' | 'error' | 'warning' | 'info'): Promise<void>;
    inject(tab: string, location: string, component: any): Promise<void>;
    /** Navigate the app to a section: 'review', 'terminals', 'workitems', 'settings', or 'plugin-<id>' */
    navigate(section: string): Promise<void>;
  };

  /** Persistent key-value storage scoped to this plugin */
  store: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
  };

  /** Structured logging visible in the plugin log panel */
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
  };

  /** Invoke another trigger/workflow within this plugin */
  run(triggerId: string, input?: any): Promise<void>;
}
