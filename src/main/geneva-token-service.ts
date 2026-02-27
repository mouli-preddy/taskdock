/**
 * Geneva Token Service
 * Acquires cookie + CSRF tokens from the Geneva portal using Playwright + Edge.
 * Replaces the external gather-geneva-secrets.py script.
 * Tries headless first, then falls back to visible browser for manual login.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { GenevaTokens } from '../shared/geneva-types.js';

const LOCALAPPDATA = process.env.LOCALAPPDATA || join(process.env.HOME || '', 'AppData', 'Local');
const CACHE_DIR = join(LOCALAPPDATA, 'BrainBot');
const CACHE_FILE = join(CACHE_DIR, 'geneva_tokens.json');

const EDGE_USER_DATA_DIR = join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');

const PORTAL_URL = 'https://portal.microsoftgeneva.com';
const DGREP_URL = `${PORTAL_URL}/logs/dgrep`;

const MIN_COOKIE_LENGTH = 50;

// Files to copy from Edge profile for SSO state
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

/**
 * Find the Edge profile directory with a @microsoft.com account, falling back to "Default".
 */
function findCorporateProfileDir(): string {
  try {
    const entries = readdirSync(EDGE_USER_DATA_DIR, { withFileTypes: true });
    const profileDirs = entries
      .filter(e => e.isDirectory() && (e.name === 'Default' || /^Profile \d+$/.test(e.name)))
      .map(e => e.name);

    for (const dirName of profileDirs) {
      try {
        const raw = readFileSync(join(EDGE_USER_DATA_DIR, dirName, 'Preferences'), 'utf-8');
        const prefs = JSON.parse(raw);
        const accounts = prefs?.account_info;
        if (Array.isArray(accounts) && accounts.some((a: any) => a.email?.endsWith('@microsoft.com'))) {
          return dirName;
        }
      } catch {
        // Skip unreadable profiles
      }
    }
  } catch {
    // Edge User Data dir not readable
  }
  return 'Default';
}

function copyEdgeProfile(tempProfile: string): void {
  const sourceProfileDir = findCorporateProfileDir();
  const srcDir = join(EDGE_USER_DATA_DIR, sourceProfileDir);
  const dstDefault = join(tempProfile, 'Default');
  mkdirSync(dstDefault, { recursive: true });

  for (const file of PROFILE_FILES) {
    const src = join(srcDir, file);
    const dst = join(dstDefault, file);
    if (existsSync(src)) {
      mkdirSync(join(dst, '..'), { recursive: true });
      try {
        copyFileSync(src, dst);
      } catch {
        // Some files may be locked, skip them
      }
    }
  }

  // Copy Local State (encryption keys)
  const srcState = join(EDGE_USER_DATA_DIR, 'Local State');
  const dstState = join(tempProfile, 'Local State');
  if (existsSync(srcState)) {
    try {
      copyFileSync(srcState, dstState);
    } catch {
      // May be locked
    }
  }
}

/** Load cached tokens from disk */
export function loadCachedGenevaTokens(): GenevaTokens | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    if (data.cookie && data.cookie.length > MIN_COOKIE_LENGTH && data.csrf) {
      return { cookie: data.cookie, csrf: data.csrf };
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/** Save tokens to disk */
function saveCachedTokens(tokens: GenevaTokens): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Try to gather tokens from a browser page.
 * Returns { cookie, csrf } or null if insufficient.
 */
async function gatherFromPage(
  context: any,
  page: any,
  headless: boolean,
  timeout: number
): Promise<GenevaTokens | null> {
  let capturedCsrf: string | null = null;
  let capturedCookies: string | null = null;

  // Intercept requests to capture CSRF and cookies
  page.on('request', (request: any) => {
    const headers = request.headers();
    if (headers['csrftoken']) {
      capturedCsrf = headers['csrftoken'];
    }
    if (headers['cookie'] && headers['cookie'].length > 100) {
      capturedCookies = headers['cookie'];
    }
  });

  // Navigate to Geneva DGrep portal
  try {
    await page.goto(DGREP_URL, { timeout: timeout / 2 });
    await page.waitForLoadState('networkidle', { timeout: timeout / 2 }).catch(() => {});
  } catch {
    // Navigation timeout is ok, continue
  }

  // Check for auth redirect
  const currentUrl: string = page.url();
  if (currentUrl.includes('login') || currentUrl.includes('microsoftonline')) {
    if (headless) {
      // Wait briefly for SSO auto-auth
      await sleep(15000);
      // Check if still on login page
      const urlAfterWait: string = page.url();
      if (urlAfterWait.includes('login') || urlAfterWait.includes('microsoftonline')) {
        // SSO didn't complete in headless — give up
        return null;
      }
    } else {
      // Visible mode: wait for user to complete login
      try {
        await page.waitForURL('**/dgrep**', { timeout });
      } catch {
        // Timeout waiting for login
        return null;
      }
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }
  }

  // Try running a test query to trigger API calls with CSRF
  try {
    await sleep(2000);

    const queryBox = page.locator('textarea').first();
    if (await queryBox.isVisible({ timeout: 5000 })) {
      await queryBox.click();
      await queryBox.fill('| take 1');
    }

    await sleep(1000);

    const runBtn = page.getByRole('button', { name: 'Run Query' });
    if (await runBtn.isVisible({ timeout: 5000 })) {
      await runBtn.click();
      await sleep(5000);
    }
  } catch {
    // Could not auto-run query, that's OK
  }

  // Get cookies from browser context as fallback
  const cookies = await context.cookies([PORTAL_URL]);
  const contextCookieStr = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
  let csrfFromCookie: string | null = null;

  for (const cookie of cookies) {
    if (cookie.name.toLowerCase().includes('csrf')) {
      csrfFromCookie = cookie.value;
    }
  }

  // Use captured values (from request headers) or fallback to context cookies
  const finalCookie = capturedCookies || contextCookieStr || '';
  const finalCsrf = capturedCsrf || csrfFromCookie || '';

  if (finalCookie.length > MIN_COOKIE_LENGTH && finalCsrf) {
    return { cookie: finalCookie, csrf: finalCsrf };
  }

  return null;
}

/**
 * Acquire Geneva tokens (cookie + CSRF) via Playwright browser automation.
 * Uses the corporate @microsoft.com Edge profile for SSO.
 * Tries headless first, then falls back to visible browser for manual login.
 */
export async function acquireGenevaTokens(): Promise<GenevaTokens> {
  if (!existsSync(EDGE_USER_DATA_DIR)) {
    throw new Error('Edge user data directory not found. Ensure Microsoft Edge is installed and you are signed in.');
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'taskdock-geneva-'));
  const tempProfile = join(tempDir, 'User Data');

  try {
    copyEdgeProfile(tempProfile);
    const { chromium } = await import('playwright-core');

    // Phase 1: Try headless
    let tokens: GenevaTokens | null = null;
    try {
      const context = await chromium.launchPersistentContext(tempProfile, {
        channel: 'msedge',
        headless: true,
        args: ['--profile-directory=Default', '--disable-blink-features=AutomationControlled'],
      });
      try {
        const page = context.pages()[0] || await context.newPage();
        tokens = await gatherFromPage(context, page, true, 60000);
      } finally {
        await context.close();
      }
    } catch {
      // Headless launch failed, fall through to visible
    }

    if (tokens) {
      saveCachedTokens(tokens);
      return tokens;
    }

    // Phase 2: Re-copy profile (headless may have dirtied it) and try visible browser
    rmSync(join(tempProfile, 'Default'), { recursive: true, force: true });
    copyEdgeProfile(tempProfile);

    const context = await chromium.launchPersistentContext(tempProfile, {
      channel: 'msedge',
      headless: false,
      args: ['--profile-directory=Default', '--disable-blink-features=AutomationControlled'],
    });

    try {
      const page = context.pages()[0] || await context.newPage();

      // Close extra tabs
      for (const extra of context.pages().slice(1)) {
        try { await extra.close(); } catch { /* ignore */ }
      }

      tokens = await gatherFromPage(context, page, false, 300000); // 5 minute timeout
    } finally {
      await context.close();
    }

    if (tokens) {
      saveCachedTokens(tokens);
      return tokens;
    }

    throw new Error('Failed to capture Geneva tokens. Please complete login in the browser window when prompted.');
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  }
}
