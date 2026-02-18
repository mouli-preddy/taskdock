import { join } from 'path';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const PORTAL_HOST = 'https://portal.microsofticm.com';
const ICM_ADVANCED_SEARCH = `${PORTAL_HOST}/imp/v3/incidents/search/advanced`;

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

export class IcmAuthService {
  private cookie: string | null = null;
  private bearerToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private acquiring: Promise<string> | null = null;

  /**
   * Get valid token. Auto-refreshes if expired.
   */
  async getToken(): Promise<string> {
    if (this.hasValidToken()) {
      return this.bearerToken!;
    }

    // Have cookie -> try refresh first (fast, no browser)
    if (this.cookie) {
      try {
        return await this.refreshToken();
      } catch {
        // Cookie expired or refresh failed, fall through to full acquire
      }
    }

    return this.acquireToken();
  }

  /**
   * Check if token exists and is not expired (with 60s buffer).
   */
  hasValidToken(): boolean {
    return !!(this.bearerToken && Date.now() < this.tokenExpiresAt - 60000);
  }

  /**
   * Refresh using saved cookie (fast, no browser). Falls back to full acquire.
   */
  async refreshToken(): Promise<string> {
    if (!this.cookie) {
      return this.acquireToken();
    }

    const response = await fetch(`${PORTAL_HOST}/sso2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Cookie': this.cookie,
      },
      body: 'grant_type=cookie',
    });

    if (!response.ok) {
      // Cookie expired, need full browser auth
      this.cookie = null;
      return this.acquireToken();
    }

    const tokenData = await response.text();
    const token = tokenData.replace(/^"|"$/g, '');
    const expiresAt = parseJwtExpiration(token) || Date.now() + 3600000;

    this.bearerToken = token;
    this.tokenExpiresAt = expiresAt;
    return token;
  }

  /**
   * Acquire token via Playwright + Edge profile. Returns bearer JWT.
   * Serializes concurrent calls so only one browser launches at a time.
   */
  async acquireToken(): Promise<string> {
    // If already acquiring, wait for that to finish
    if (this.acquiring) {
      return this.acquiring;
    }

    this.acquiring = this.doAcquireToken();
    try {
      return await this.acquiring;
    } finally {
      this.acquiring = null;
    }
  }

  private async doAcquireToken(): Promise<string> {
    const edgeUserData = getEdgeUserDataDir();
    if (!existsSync(edgeUserData)) {
      throw new Error('Edge user data directory not found. Ensure Microsoft Edge is installed and you are signed in.');
    }

    const tempDir = mkdtempSync(join(tmpdir(), 'taskdock-edge-'));
    const tempProfile = join(tempDir, 'User Data');

    try {
      // Copy essential profile files
      copyEdgeProfile(edgeUserData, tempProfile);

      // Dynamically import playwright to keep it lazy
      const { chromium } = await import('playwright');

      let capturedBearer: string | null = null;
      let capturedCookie: string | null = null;

      const context = await chromium.launchPersistentContext(tempProfile, {
        channel: 'msedge',
        headless: true,
        args: [
          '--profile-directory=Default',
          '--disable-blink-features=AutomationControlled',
        ],
      });

      try {
        const pages = context.pages();
        const page = pages[0] || await context.newPage();

        // Intercept requests to capture auth headers
        page.on('request', (request: any) => {
          const url = request.url();
          if (!url.includes('microsofticm.com')) return;

          const headers = request.headers();
          if (headers['authorization']?.startsWith('Bearer ')) {
            capturedBearer = headers['authorization'].slice(7);
          }
          if (headers['cookie'] && headers['cookie'].length > 50) {
            capturedCookie = headers['cookie'];
          }
        });

        // Navigate to ICM
        await page.goto(ICM_ADVANCED_SEARCH);
        await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

        // Handle IdP selection page
        const currentUrl = page.url();
        if (currentUrl.includes('IdentityProviderSelection')) {
          await this.handleIdpSelection(page);
        }

        // Handle Microsoft login redirect (SSO should auto-complete)
        const urlAfterIdp = page.url();
        if (urlAfterIdp.includes('login') || urlAfterIdp.includes('microsoftonline')) {
          await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
        }

        // Wait for redirect to incidents page
        if (!page.url().toLowerCase().includes('incidents')) {
          await page.waitForURL('**/incidents/**', { timeout: 30000 }).catch(() => {});
        }
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Give a moment for API calls to fire
        await page.waitForTimeout(3000);

        // If we didn't capture a bearer token from requests, try triggering API calls
        if (!capturedBearer) {
          try {
            const searchBtn = page.getByRole('button', { name: 'Search' });
            if (await searchBtn.isVisible({ timeout: 3000 })) {
              await searchBtn.click();
              await page.waitForTimeout(3000);
            }
          } catch {
            // Search button not found, that's OK
          }
        }

        // Get cookies from browser context as fallback
        if (!capturedCookie) {
          const cookies = await context.cookies(['https://portal.microsofticm.com']);
          capturedCookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        }
      } finally {
        await context.close();
      }

      if (!capturedBearer) {
        throw new Error(
          'Failed to capture ICM bearer token. Ensure you are signed into ICM in Microsoft Edge.'
        );
      }

      // Store in memory
      this.bearerToken = capturedBearer;
      this.tokenExpiresAt = parseJwtExpiration(capturedBearer) || Date.now() + 3600000;
      this.cookie = capturedCookie;

      return capturedBearer;
    } finally {
      // Clean up temp directory
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }
  }

  private async handleIdpSelection(page: any): Promise<void> {
    // Try known IdP selectors in order
    const idpNames = ['EntraID-OIDC', 'IcMdSTS', 'EntraID'];
    for (const name of idpNames) {
      try {
        const link = page.locator(`a[href*='${name}']`).first();
        if (await link.isVisible({ timeout: 2000 })) {
          await link.click();
          await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
          return;
        }
      } catch {
        continue;
      }
    }

    // Fallback selectors
    const fallbacks = [
      "a:has-text('Microsoft')",
      "a:has-text('Corporate')",
      "a:has-text('Sign in')",
      "button:has-text('Microsoft')",
      "button:has-text('Sign in')",
    ];
    for (const selector of fallbacks) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
          return;
        }
      } catch {
        continue;
      }
    }
  }
}

function getEdgeUserDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data');
  }
  return join(process.env.HOME || '', '.config', 'microsoft-edge');
}

function copyEdgeProfile(edgeUserData: string, tempProfile: string): void {
  const srcDefault = join(edgeUserData, 'Default');
  const dstDefault = join(tempProfile, 'Default');
  mkdirSync(dstDefault, { recursive: true });

  for (const file of PROFILE_FILES) {
    const src = join(srcDefault, file);
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
  const srcState = join(edgeUserData, 'Local State');
  const dstState = join(tempProfile, 'Local State');
  if (existsSync(srcState)) {
    try {
      copyFileSync(srcState, dstState);
    } catch {
      // May be locked
    }
  }
}

export function parseJwtExpiration(jwt: string): number | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
