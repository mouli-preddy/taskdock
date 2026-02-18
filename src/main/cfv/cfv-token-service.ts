import { EventEmitter } from 'node:events';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type TokenProgressStatus =
  | 'checking-profile'
  | 'copying-profile'
  | 'launching-browser'
  | 'navigating'
  | 'waiting-for-auth'
  | 'navigating-to-call'
  | 'token-captured'
  | 'headless-failed'
  | 'opening-visible'
  | 'error'
  | 'complete'
  | 'cancelled';

export interface TokenProgress {
  status: TokenProgressStatus;
  message: string;
  headless?: boolean;
  tokenLength?: number;
  error?: string;
}

export interface AcquireTokenOptions {
  /** Skip headless attempt and go straight to visible browser */
  forceVisible?: boolean;
  /** Timeout in ms for each browser attempt (default: 60000) */
  timeout?: number;
}

const LOCALAPPDATA = process.env.LOCALAPPDATA || join(process.env.HOME || '', 'AppData', 'Local');
const BRAINBOT_DIR = join(LOCALAPPDATA, 'BrainBot');
const PROFILE_DIR = join(BRAINBOT_DIR, 'edge_profile_cfv');
const TOKEN_FILE = join(BRAINBOT_DIR, 'cfv_tokens.json');

const EDGE_USER_DATA_DIR = join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');

// Files to copy from the real Edge profile
const PROFILE_FILES = [
  'Cookies',
  'Cookies-journal',
  'Login Data',
  'Login Data-journal',
  'Preferences',
  'Secure Preferences',
  'Web Data',
  'Web Data-journal',
  join('Network', 'Cookies'),
  join('Network', 'Cookies-journal'),
];

// Domains whose Authorization headers we intercept
const RELEVANT_DOMAINS = ['ngc.skype.net', 'skype.net', 'skype.com', 'microsoft.com'];

// A known call ID to trigger API requests
const TRIGGER_CALL_URL = 'https://ngc.skype.net/call/52644107-7897-4068-8330-c07b46514861/';

export class CfvTokenService extends EventEmitter {
  private browserContext: any = null;
  private cancelled = false;

  /** Check if playwright-core is importable and Edge is installed */
  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      await import('playwright-core');
    } catch {
      return { available: false, reason: 'playwright-core is not installed' };
    }

    // Check if Edge is installed (channel: 'msedge' will find it, but we can do a quick check)
    try {
      const { execSync } = await import('node:child_process');
      execSync('where msedge', { stdio: 'ignore' });
    } catch {
      // 'where' might fail but Edge can still be found by Playwright via registry
      // Don't fail here, let Playwright handle it
    }

    return { available: true };
  }

  /** Main entry point: acquire a token via Playwright */
  async acquireToken(options?: AcquireTokenOptions): Promise<string | null> {
    this.cancelled = false;
    const timeout = options?.timeout ?? 60000;

    try {
      // Phase 1: Ensure profile exists
      this.emitProgress({ status: 'checking-profile', message: 'Checking Edge profile...' });
      await this.ensureProfile();

      if (this.cancelled) return null;

      // Phase 2: Try headless first (unless forceVisible)
      if (!options?.forceVisible) {
        this.emitProgress({ status: 'launching-browser', message: 'Launching Edge (headless)...', headless: true });
        const token = await this.gatherToken(true, timeout);

        if (this.cancelled) return null;

        if (token) {
          this.emitProgress({ status: 'token-captured', message: 'Token captured!', tokenLength: token.length });
          await this.saveToken(token);
          this.emitProgress({ status: 'complete', message: 'Token acquired successfully', tokenLength: token.length });
          return token;
        }

        // Headless failed
        this.emitProgress({ status: 'headless-failed', message: 'Headless login failed, opening visible browser...' });
      }

      if (this.cancelled) return null;

      // Phase 3: Visible browser
      this.emitProgress({ status: 'opening-visible', message: 'Opening Edge for login...' });
      const token = await this.gatherToken(false, timeout * 5); // 5x timeout for interactive

      if (this.cancelled) return null;

      if (token) {
        this.emitProgress({ status: 'token-captured', message: 'Token captured!', tokenLength: token.length });
        await this.saveToken(token);
        this.emitProgress({ status: 'complete', message: 'Token acquired successfully', tokenLength: token.length });
        return token;
      }

      this.emitProgress({ status: 'error', message: 'Could not capture bearer token', error: 'No token captured from network requests' });
      return null;
    } catch (err: any) {
      if (this.cancelled) return null;
      const message = err?.message || String(err);
      this.emitProgress({ status: 'error', message: `Token acquisition failed: ${message}`, error: message });
      return null;
    } finally {
      await this.closeBrowser();
    }
  }

  /** Cancel the current acquisition */
  cancel(): void {
    this.cancelled = true;
    this.closeBrowser().catch(() => {});
    this.emitProgress({ status: 'cancelled', message: 'Token acquisition cancelled' });
  }

  // ---------------------------------------------------------------------------
  // Profile management
  // ---------------------------------------------------------------------------

  private async ensureProfile(): Promise<void> {
    const defaultDir = join(PROFILE_DIR, 'Default');

    try {
      await stat(defaultDir);
      // Profile exists
      return;
    } catch {
      // Need to create profile
    }

    this.emitProgress({ status: 'copying-profile', message: 'Setting up Edge profile...' });

    const srcDefault = join(EDGE_USER_DATA_DIR, 'Default');
    await mkdir(defaultDir, { recursive: true });

    // Copy essential files
    for (const file of PROFILE_FILES) {
      const src = join(srcDefault, file);
      const dst = join(defaultDir, file);
      try {
        await mkdir(join(dst, '..'), { recursive: true });
        await copyFile(src, dst);
      } catch {
        // File might not exist, that's ok
      }
    }

    // Copy Local State (encryption keys) to profile root
    const srcState = join(EDGE_USER_DATA_DIR, 'Local State');
    const dstState = join(PROFILE_DIR, 'Local State');
    try {
      await copyFile(srcState, dstState);
    } catch {
      // ok
    }
  }

  // ---------------------------------------------------------------------------
  // Browser automation
  // ---------------------------------------------------------------------------

  private async gatherToken(headless: boolean, timeout: number): Promise<string | null> {
    let capturedBearer: string | null = null;

    const { chromium } = await import('playwright-core');

    this.emitProgress({
      status: headless ? 'launching-browser' : 'opening-visible',
      message: headless ? 'Launching Edge (headless)...' : 'Opening Edge for login...',
      headless,
    });

    this.browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'msedge',
      headless,
      args: [
        '--profile-directory=Default',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const page = this.browserContext.pages()[0] || await this.browserContext.newPage();

    // Close extra tabs
    for (const extra of this.browserContext.pages().slice(1)) {
      try { await extra.close(); } catch { /* ignore */ }
    }

    // Intercept requests to capture Bearer token
    page.on('request', (request: any) => {
      if (capturedBearer) return; // Already captured

      const url: string = request.url();
      if (!RELEVANT_DOMAINS.some(d => url.includes(d))) return;

      const authHeader: string | null = request.headers()['authorization'];
      if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
        capturedBearer = authHeader.slice(7); // Remove "Bearer " prefix
      }
    });

    // Navigate to CFV portal
    this.emitProgress({ status: 'navigating', message: 'Navigating to CFV portal...', headless });

    try {
      await page.goto('https://ngc.skype.net/', { timeout: timeout / 2 });
      await page.waitForLoadState('networkidle', { timeout: timeout / 2 }).catch(() => {});
    } catch {
      // Navigation might timeout but we can still continue
    }

    if (this.cancelled) return null;
    if (capturedBearer) return capturedBearer;

    // Check for auth redirect
    const currentUrl: string = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('microsoftonline')) {
      if (headless) {
        // In headless mode, wait briefly for auto-auth
        this.emitProgress({ status: 'waiting-for-auth', message: 'Waiting for SSO authentication...', headless: true });
        await this.sleep(10000);
        if (capturedBearer) return capturedBearer;
        // Give up in headless mode
        await this.closeBrowser();
        return null;
      } else {
        // In visible mode, wait for user to complete login
        this.emitProgress({ status: 'waiting-for-auth', message: 'Complete login in the browser window...', headless: false });
        try {
          await page.waitForURL('**/ngc.skype.net/**', { timeout });
        } catch {
          // Timeout waiting for login
          await this.closeBrowser();
          return null;
        }
      }
    }

    if (this.cancelled) return null;
    if (capturedBearer) return capturedBearer;

    // Navigate to a specific call URL to trigger API calls with auth headers
    this.emitProgress({ status: 'navigating-to-call', message: 'Triggering API calls...', headless });

    try {
      await page.goto(TRIGGER_CALL_URL, { timeout: timeout / 2 });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    } catch {
      // Navigation might fail but we might already have the token
    }

    if (capturedBearer) return capturedBearer;

    // Poll for token for a while
    const pollEnd = Date.now() + 15000;
    while (Date.now() < pollEnd && !capturedBearer && !this.cancelled) {
      await this.sleep(1000);
    }

    return capturedBearer;
  }

  private async closeBrowser(): Promise<void> {
    if (this.browserContext) {
      try {
        await this.browserContext.close();
      } catch {
        // ignore
      }
      this.browserContext = null;
    }
  }

  private async saveToken(token: string): Promise<void> {
    await mkdir(BRAINBOT_DIR, { recursive: true });
    await writeFile(TOKEN_FILE, JSON.stringify({
      token,
      updatedAt: new Date().toISOString(),
    }), 'utf-8');
  }

  private emitProgress(progress: TokenProgress): void {
    this.emit('progress', progress);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
