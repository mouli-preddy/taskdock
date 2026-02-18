/**
 * explore-icm-portal.js
 *
 * Uses Playwright with Edge to browse the ICM portal and capture:
 * - All API calls (URLs, methods, headers, request/response bodies)
 * - Full DOM structure and UI elements
 * - Screenshots at various states
 * - Form elements, dropdowns, filters
 *
 * Usage: npx playwright test --config=playwright.config.js scripts/explore-icm-portal.js
 *   or:  node scripts/explore-icm-portal.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Output directory for captured data
const OUTPUT_DIR = path.join(__dirname, '..', 'icm-exploration');
const SCREENSHOTS_DIR = path.join(OUTPUT_DIR, 'screenshots');

// Edge profile location
const EDGE_USER_DATA = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data');

// Files to copy from Edge profile for SSO
const PROFILE_FILES = [
  'Cookies',
  'Cookies-journal',
  'Login Data',
  'Login Data-journal',
  'Preferences',
  'Secure Preferences',
  'Web Data',
  'Web Data-journal',
  path.join('Network', 'Cookies'),
  path.join('Network', 'Cookies-journal'),
];

// Captured data
const capturedAPICalls = [];
const capturedUIElements = {};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyEdgeProfile(tempDir) {
  const srcDefault = path.join(EDGE_USER_DATA, 'Default');
  const dstDefault = path.join(tempDir, 'Default');
  ensureDir(dstDefault);

  for (const file of PROFILE_FILES) {
    const src = path.join(srcDefault, file);
    const dst = path.join(dstDefault, file);
    if (fs.existsSync(src)) {
      ensureDir(path.dirname(dst));
      try {
        fs.copyFileSync(src, dst);
      } catch (e) {
        console.warn(`  [WARN] Could not copy ${file}: ${e.message}`);
      }
    }
  }

  // Copy Local State (encryption keys)
  const srcState = path.join(EDGE_USER_DATA, 'Local State');
  const dstState = path.join(tempDir, 'Local State');
  if (fs.existsSync(srcState)) {
    try {
      fs.copyFileSync(srcState, dstState);
    } catch (e) {
      console.warn(`  [WARN] Could not copy Local State: ${e.message}`);
    }
  }
}

async function captureAPICall(request, response) {
  const url = request.url();
  const method = request.method();

  // Only capture ICM-related API calls
  if (!url.includes('microsofticm.com') && !url.includes('microsoftgeneva.com')) {
    return;
  }

  // Skip static assets
  if (url.match(/\.(css|js|woff|woff2|ttf|png|jpg|gif|svg|ico)(\?|$)/)) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    method,
    url,
    requestHeaders: request.headers(),
    requestPostData: null,
    responseStatus: null,
    responseHeaders: null,
    responseBody: null,
  };

  // Capture request body
  try {
    entry.requestPostData = request.postData();
  } catch (e) { /* no post data */ }

  // Capture response
  if (response) {
    entry.responseStatus = response.status();
    entry.responseHeaders = response.headers();

    try {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('json') || contentType.includes('text') || contentType.includes('xml')) {
        const body = await response.text();
        // Truncate very large responses but keep enough to understand structure
        if (body.length > 50000) {
          entry.responseBody = body.substring(0, 50000) + '\n... [TRUNCATED]';
        } else {
          entry.responseBody = body;
        }

        // Try to parse JSON for cleaner output
        if (contentType.includes('json')) {
          try {
            entry.responseBodyParsed = JSON.parse(body.substring(0, 50000));
          } catch (e) { /* not valid JSON */ }
        }
      }
    } catch (e) {
      entry.responseBody = `[Error reading response: ${e.message}]`;
    }
  }

  capturedAPICalls.push(entry);
  console.log(`  [API] ${method} ${url.substring(0, 100)}${url.length > 100 ? '...' : ''} -> ${entry.responseStatus || '?'}`);
}

async function extractUIElements(page, name) {
  console.log(`\n[*] Extracting UI elements: ${name}`);

  const elements = await page.evaluate(() => {
    const result = {
      forms: [],
      buttons: [],
      inputs: [],
      selects: [],
      dropdowns: [],
      links: [],
      tables: [],
      tabs: [],
      modals: [],
      panels: [],
      dataAttributes: [],
      angularComponents: [],
      reactComponents: [],
    };

    // Forms
    document.querySelectorAll('form').forEach(form => {
      result.forms.push({
        id: form.id,
        action: form.action,
        method: form.method,
        className: form.className,
        fields: Array.from(form.elements).map(el => ({
          tag: el.tagName,
          type: el.type,
          name: el.name,
          id: el.id,
          placeholder: el.placeholder,
          className: el.className,
        })),
      });
    });

    // Buttons
    document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a.btn').forEach(btn => {
      result.buttons.push({
        tag: btn.tagName,
        text: btn.textContent?.trim().substring(0, 100),
        id: btn.id,
        className: btn.className,
        type: btn.type,
        ariaLabel: btn.getAttribute('aria-label'),
        disabled: btn.disabled,
        title: btn.title,
      });
    });

    // Inputs
    document.querySelectorAll('input, textarea').forEach(input => {
      result.inputs.push({
        tag: input.tagName,
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        className: input.className,
        value: input.type !== 'password' ? input.value : '[REDACTED]',
        ariaLabel: input.getAttribute('aria-label'),
        dataBindings: Array.from(input.attributes)
          .filter(a => a.name.startsWith('data-') || a.name.startsWith('ng-') || a.name.startsWith('v-'))
          .map(a => ({ name: a.name, value: a.value })),
      });
    });

    // Select dropdowns
    document.querySelectorAll('select').forEach(sel => {
      result.selects.push({
        name: sel.name,
        id: sel.id,
        className: sel.className,
        options: Array.from(sel.options).map(opt => ({
          value: opt.value,
          text: opt.textContent?.trim(),
          selected: opt.selected,
        })),
      });
    });

    // Custom dropdowns (common in React/Angular apps)
    document.querySelectorAll('[role="listbox"], [role="combobox"], [role="menu"], .dropdown, .dropdown-menu, [class*="dropdown"], [class*="Dropdown"]').forEach(dd => {
      result.dropdowns.push({
        tag: dd.tagName,
        id: dd.id,
        className: dd.className,
        role: dd.getAttribute('role'),
        ariaLabel: dd.getAttribute('aria-label'),
        items: Array.from(dd.querySelectorAll('[role="option"], [role="menuitem"], li, .dropdown-item')).map(item => ({
          text: item.textContent?.trim().substring(0, 100),
          value: item.getAttribute('data-value') || item.getAttribute('value'),
        })).slice(0, 50),
      });
    });

    // Tables
    document.querySelectorAll('table, [role="grid"], [role="table"]').forEach(table => {
      const headers = Array.from(table.querySelectorAll('th, [role="columnheader"]')).map(th => th.textContent?.trim());
      result.tables.push({
        id: table.id,
        className: table.className,
        headers,
        rowCount: table.querySelectorAll('tr, [role="row"]').length,
      });
    });

    // Tabs
    document.querySelectorAll('[role="tab"], .nav-tab, .tab, [class*="tab"]').forEach(tab => {
      result.tabs.push({
        text: tab.textContent?.trim().substring(0, 100),
        id: tab.id,
        className: tab.className,
        selected: tab.getAttribute('aria-selected'),
      });
    });

    // Navigation/sidebar items
    document.querySelectorAll('nav a, [role="navigation"] a, .sidebar a, .nav-item').forEach(link => {
      result.links.push({
        text: link.textContent?.trim().substring(0, 100),
        href: link.href,
        className: link.className,
      });
    });

    // Data attributes on key elements (framework bindings)
    document.querySelectorAll('[data-bind], [ng-model], [ng-controller], [data-reactid], [class*="Component"]').forEach(el => {
      result.dataAttributes.push({
        tag: el.tagName,
        className: el.className?.substring?.(0, 100),
        dataBind: el.getAttribute('data-bind'),
        ngModel: el.getAttribute('ng-model'),
        ngController: el.getAttribute('ng-controller'),
      });
    });

    // Try to detect framework
    result.framework = {
      angular: !!document.querySelector('[ng-app], [ng-controller], [data-ng-app]') || !!window.angular,
      react: !!document.querySelector('[data-reactid], [data-reactroot]') || !!document.querySelector('#root'),
      vue: !!document.querySelector('[data-v-]') || !!window.__VUE__,
      knockout: !!window.ko,
      jquery: !!window.jQuery,
    };

    // Get overall page structure
    result.pageStructure = {
      title: document.title,
      bodyClasses: document.body.className,
      mainSections: Array.from(document.querySelectorAll('main, [role="main"], .main-content, #content, .content-area, header, footer, nav, aside, .sidebar')).map(section => ({
        tag: section.tagName,
        id: section.id,
        className: section.className?.substring?.(0, 200),
        role: section.getAttribute('role'),
        childCount: section.children.length,
      })),
    };

    return result;
  });

  capturedUIElements[name] = elements;

  // Summary
  console.log(`    Forms: ${elements.forms.length}`);
  console.log(`    Buttons: ${elements.buttons.length}`);
  console.log(`    Inputs: ${elements.inputs.length}`);
  console.log(`    Selects: ${elements.selects.length}`);
  console.log(`    Custom dropdowns: ${elements.dropdowns.length}`);
  console.log(`    Tables: ${elements.tables.length}`);
  console.log(`    Tabs: ${elements.tabs.length}`);
  console.log(`    Framework: ${JSON.stringify(elements.framework)}`);

  return elements;
}

async function extractFullDOM(page, name) {
  console.log(`[*] Extracting full DOM: ${name}`);

  const html = await page.content();
  const filePath = path.join(OUTPUT_DIR, `dom-${name}.html`);
  fs.writeFileSync(filePath, html, 'utf-8');
  console.log(`    Saved to: ${filePath} (${html.length} chars)`);

  return html;
}

async function captureAccessibilityTree(page, name) {
  console.log(`[*] Capturing accessibility tree: ${name}`);

  try {
    const tree = await page.accessibility.snapshot({ interestingOnly: true });
    const filePath = path.join(OUTPUT_DIR, `accessibility-${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(tree, null, 2), 'utf-8');
    console.log(`    Saved accessibility tree`);
    return tree;
  } catch (e) {
    console.warn(`    [WARN] Could not capture accessibility tree: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('  ICM Portal Explorer (Playwright + Edge)');
  console.log('='.repeat(60));
  console.log();

  // Setup output directories
  ensureDir(OUTPUT_DIR);
  ensureDir(SCREENSHOTS_DIR);

  // Create temp directory for Edge profile copy
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge_profile_'));
  console.log(`[*] Edge profile: ${EDGE_USER_DATA}`);
  console.log(`[*] Temp profile: ${tempDir}`);

  // Copy Edge profile
  console.log('[*] Copying Edge profile...');
  copyEdgeProfile(tempDir);
  console.log('[OK] Profile copied\n');

  let context;
  try {
    // Launch Edge with profile
    console.log('[*] Launching Edge...');
    context = await chromium.launchPersistentContext(tempDir, {
      channel: 'msedge',
      headless: false,  // Non-headless so we can see what's happening
      args: [
        '--profile-directory=Default',
        '--disable-blink-features=AutomationControlled',
      ],
      viewport: { width: 1920, height: 1080 },
    });

    const page = context.pages[0] || await context.newPage();

    // Track all API calls via response event (which gives us both request and response)
    const pendingRequests = new Map();

    page.on('request', request => {
      const url = request.url();
      if (url.includes('microsofticm.com')) {
        pendingRequests.set(url + request.method(), request);
      }
    });

    page.on('response', async response => {
      const request = response.request();
      const url = request.url();
      if (url.includes('microsofticm.com') || url.includes('oncallapi') || url.includes('upsapi') || url.includes('outageapi')) {
        await captureAPICall(request, response);
      }
    });

    // ======================================
    // PHASE 1: Navigate to ICM Advanced Search
    // ======================================
    console.log('\n[PHASE 1] Navigating to ICM Advanced Search...');
    await page.goto('https://portal.microsofticm.com/imp/v3/incidents/search/advanced', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    // Handle SSO flow
    console.log('[*] Waiting for authentication...');
    let currentUrl = page.url();
    console.log(`    URL: ${currentUrl}`);

    // Handle Identity Provider Selection
    if (currentUrl.includes('IdentityProviderSelection')) {
      console.log('[*] Identity Provider selection - clicking EntraID-OIDC...');
      try {
        const idpLink = page.locator("a[href*='EntraID-OIDC']").first;
        await idpLink.click({ timeout: 5000 });
        console.log('    Clicked EntraID-OIDC');
      } catch (e) {
        console.log('    Trying alternative selectors...');
        try {
          await page.locator("a[href*='IcMdSTS']").first.click({ timeout: 5000 });
        } catch (e2) {
          console.log('    Could not auto-select IDP, waiting for manual selection...');
        }
      }
    }

    // Wait for final page load
    console.log('[*] Waiting for ICM page to fully load...');
    try {
      await page.waitForURL('**/incidents/**', { timeout: 120000 });
    } catch (e) {
      console.log(`    Current URL: ${page.url()}`);
      console.log('    Waiting additional time...');
    }

    // Wait for network idle
    try {
      await page.waitForLoadState('networkidle', { timeout: 60000 });
    } catch (e) {
      console.log('    Network did not fully idle, continuing...');
    }

    // Extra wait for SPA to render
    await page.waitForTimeout(5000);

    console.log(`[OK] Page loaded: ${page.url()}`);

    // ======================================
    // PHASE 2: Capture Initial Page State
    // ======================================
    console.log('\n[PHASE 2] Capturing initial page state...');

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-advanced-search-initial.png'), fullPage: true });
    console.log('    Screenshot: 01-advanced-search-initial.png');

    await extractUIElements(page, 'advanced-search-initial');
    await extractFullDOM(page, 'advanced-search-initial');
    await captureAccessibilityTree(page, 'advanced-search-initial');

    // ======================================
    // PHASE 3: Explore Search Filters
    // ======================================
    console.log('\n[PHASE 3] Exploring search filters...');

    // Try to find and interact with filter/search elements
    // Look for common ICM search fields
    const searchFields = [
      { label: 'Status', selectors: ['[data-test*="status"]', '[aria-label*="Status"]', 'label:has-text("Status")'] },
      { label: 'Severity', selectors: ['[data-test*="severity"]', '[aria-label*="Severity"]', 'label:has-text("Severity")'] },
      { label: 'OwningTeam', selectors: ['[data-test*="team"]', '[aria-label*="Team"]', '[aria-label*="Owning"]', 'label:has-text("Owning")'] },
      { label: 'Service', selectors: ['[data-test*="service"]', '[aria-label*="Service"]', 'label:has-text("Service")'] },
      { label: 'Title', selectors: ['[data-test*="title"]', '[aria-label*="Title"]', 'label:has-text("Title")'] },
      { label: 'IncidentId', selectors: ['[data-test*="incident"]', '[aria-label*="Incident"]', 'label:has-text("Incident")'] },
      { label: 'DateRange', selectors: ['[data-test*="date"]', '[aria-label*="Date"]', 'label:has-text("Date")'] },
    ];

    for (const field of searchFields) {
      for (const selector of field.selectors) {
        try {
          const el = page.locator(selector).first;
          if (await el.isVisible({ timeout: 1000 })) {
            console.log(`    Found filter: ${field.label} (${selector})`);
            // Try to click to expand/open dropdown
            try {
              await el.click({ timeout: 2000 });
              await page.waitForTimeout(1000);
              await page.screenshot({
                path: path.join(SCREENSHOTS_DIR, `02-filter-${field.label.toLowerCase()}.png`),
                fullPage: true
              });
              // Click elsewhere to close
              await page.click('body', { position: { x: 10, y: 10 } });
              await page.waitForTimeout(500);
            } catch (e) { /* couldn't click */ }
            break;
          }
        } catch (e) { /* selector not found */ }
      }
    }

    // Capture state after exploring filters
    await extractUIElements(page, 'after-filter-exploration');

    // ======================================
    // PHASE 4: Try to execute a search
    // ======================================
    console.log('\n[PHASE 4] Attempting to execute a search...');

    // Look for search/execute button
    const searchButtonSelectors = [
      'button:has-text("Search")',
      'button:has-text("Execute")',
      'button:has-text("Run")',
      '[aria-label*="Search"]',
      '[aria-label*="Execute"]',
      'button.search-button',
      'button.btn-primary',
      'input[type="submit"]',
    ];

    let searchClicked = false;
    for (const selector of searchButtonSelectors) {
      try {
        const btn = page.locator(selector).first;
        if (await btn.isVisible({ timeout: 1000 })) {
          console.log(`    Found search button: ${selector}`);
          console.log(`    Text: ${await btn.textContent()}`);
          await btn.click({ timeout: 3000 });
          searchClicked = true;
          console.log('    Clicked search!');
          break;
        }
      } catch (e) { /* not found */ }
    }

    if (searchClicked) {
      // Wait for search results
      console.log('    Waiting for search results...');
      await page.waitForTimeout(5000);
      try {
        await page.waitForLoadState('networkidle', { timeout: 30000 });
      } catch (e) { /* timeout ok */ }

      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-search-results.png'), fullPage: true });
      console.log('    Screenshot: 03-search-results.png');

      await extractUIElements(page, 'search-results');
      await extractFullDOM(page, 'search-results');
    }

    // ======================================
    // PHASE 5: Explore Navigation
    // ======================================
    console.log('\n[PHASE 5] Exploring navigation...');

    // Capture all navigation links
    const navLinks = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a[href], [role="link"], nav a, .nav-item a, .sidebar a, .menu-item a').forEach(a => {
        const href = a.getAttribute('href') || '';
        const text = a.textContent?.trim();
        if (text && href && !href.startsWith('javascript:') && !href.startsWith('#')) {
          links.push({ text: text.substring(0, 100), href: href.substring(0, 200) });
        }
      });
      return links;
    });

    console.log(`    Found ${navLinks.length} navigation links`);
    capturedUIElements.navigationLinks = navLinks;

    // ======================================
    // PHASE 6: Explore an individual incident (if search returned results)
    // ======================================
    console.log('\n[PHASE 6] Looking for incident links...');

    try {
      // Try to find incident links in search results
      const incidentLink = page.locator('a[href*="/incidents/details/"], a[href*="incidentId="], [data-incident-id]').first;
      if (await incidentLink.isVisible({ timeout: 3000 })) {
        const href = await incidentLink.getAttribute('href');
        console.log(`    Found incident link: ${href}`);
        await incidentLink.click({ timeout: 5000 });

        console.log('    Waiting for incident detail page...');
        await page.waitForTimeout(5000);
        try {
          await page.waitForLoadState('networkidle', { timeout: 30000 });
        } catch (e) { /* timeout ok */ }

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-incident-detail.png'), fullPage: true });
        console.log('    Screenshot: 04-incident-detail.png');

        await extractUIElements(page, 'incident-detail');
        await extractFullDOM(page, 'incident-detail');
        await captureAccessibilityTree(page, 'incident-detail');
      } else {
        console.log('    No incident links found in results');
      }
    } catch (e) {
      console.log(`    Could not navigate to incident detail: ${e.message}`);
    }

    // ======================================
    // PHASE 7: Navigate to other key pages
    // ======================================
    console.log('\n[PHASE 7] Exploring other ICM pages...');

    const pagesToExplore = [
      { name: 'dashboard', url: 'https://portal.microsofticm.com/imp/v3/incidents/dashboard' },
      { name: 'my-incidents', url: 'https://portal.microsofticm.com/imp/v3/incidents/search/basic' },
    ];

    for (const pageInfo of pagesToExplore) {
      try {
        console.log(`\n  Navigating to: ${pageInfo.name}`);
        await page.goto(pageInfo.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);
        try {
          await page.waitForLoadState('networkidle', { timeout: 20000 });
        } catch (e) { /* timeout ok */ }

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `05-${pageInfo.name}.png`), fullPage: true });
        await extractUIElements(page, pageInfo.name);
        console.log(`    Done: ${pageInfo.name}`);
      } catch (e) {
        console.log(`    [WARN] Could not explore ${pageInfo.name}: ${e.message}`);
      }
    }

    // ======================================
    // PHASE 8: Capture JavaScript API client info
    // ======================================
    console.log('\n[PHASE 8] Extracting JavaScript API client info...');

    const jsInfo = await page.evaluate(() => {
      const info = {};

      // Check for global API objects
      const globalChecks = [
        'IcmApi', 'icmApi', 'ICM', 'icm', 'apiClient', 'ApiClient',
        'window.__INITIAL_STATE__', 'window.__APP_STATE__',
        'window.__ICM__', 'window.__CONFIG__',
      ];

      for (const name of globalChecks) {
        try {
          const val = eval(name);
          if (val) {
            info[name] = typeof val === 'object' ? Object.keys(val).slice(0, 50) : typeof val;
          }
        } catch (e) { /* not defined */ }
      }

      // Check for service worker registrations
      if (navigator.serviceWorker) {
        info.serviceWorker = !!navigator.serviceWorker.controller;
      }

      // Check localStorage keys
      try {
        info.localStorageKeys = Object.keys(localStorage).slice(0, 50);
      } catch (e) { /* no access */ }

      // Check sessionStorage keys
      try {
        info.sessionStorageKeys = Object.keys(sessionStorage).slice(0, 50);
      } catch (e) { /* no access */ }

      // Get all script sources
      info.scriptSources = Array.from(document.querySelectorAll('script[src]')).map(s => s.src).slice(0, 50);

      // Get meta tags
      info.metaTags = Array.from(document.querySelectorAll('meta')).map(m => ({
        name: m.name || m.getAttribute('property') || m.httpEquiv,
        content: m.content?.substring(0, 200),
      })).filter(m => m.name);

      return info;
    });

    capturedUIElements.jsInfo = jsInfo;
    console.log(`    localStorage keys: ${jsInfo.localStorageKeys?.length || 0}`);
    console.log(`    sessionStorage keys: ${jsInfo.sessionStorageKeys?.length || 0}`);
    console.log(`    Script sources: ${jsInfo.scriptSources?.length || 0}`);
    console.log(`    Global objects: ${Object.keys(jsInfo).filter(k => !['localStorageKeys', 'sessionStorageKeys', 'scriptSources', 'metaTags', 'serviceWorker'].includes(k)).join(', ') || 'none'}`);

    // ======================================
    // Save all captured data
    // ======================================
    console.log('\n[*] Saving captured data...');

    // Save API calls
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'api-calls.json'),
      JSON.stringify(capturedAPICalls, null, 2),
      'utf-8'
    );
    console.log(`    Saved ${capturedAPICalls.length} API calls`);

    // Save UI elements
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'ui-elements.json'),
      JSON.stringify(capturedUIElements, null, 2),
      'utf-8'
    );
    console.log('    Saved UI elements');

    // Generate summary report
    const summary = generateSummaryReport();
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'EXPLORATION-REPORT.md'),
      summary,
      'utf-8'
    );
    console.log('    Saved exploration report');

    console.log('\n' + '='.repeat(60));
    console.log('  Exploration Complete!');
    console.log('='.repeat(60));
    console.log(`\nOutput directory: ${OUTPUT_DIR}`);
    console.log('Files:');
    console.log('  - api-calls.json          (all captured API calls)');
    console.log('  - ui-elements.json        (all UI elements)');
    console.log('  - EXPLORATION-REPORT.md   (summary report)');
    console.log('  - dom-*.html              (full DOM snapshots)');
    console.log('  - accessibility-*.json    (accessibility trees)');
    console.log('  - screenshots/            (page screenshots)');

    // Keep browser open briefly so user can see final state
    console.log('\n[*] Closing browser in 5 seconds...');
    await page.waitForTimeout(5000);

    await context.close();

  } catch (error) {
    console.error(`\n[ERROR] ${error.message}`);
    console.error(error.stack);

    // Save whatever we have so far
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'api-calls-partial.json'),
      JSON.stringify(capturedAPICalls, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'ui-elements-partial.json'),
      JSON.stringify(capturedUIElements, null, 2),
      'utf-8'
    );

    if (context) {
      try { await context.close(); } catch (e) { /* ignore */ }
    }
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log('[OK] Cleaned up temp profile');
    } catch (e) {
      console.warn(`[WARN] Could not clean temp dir: ${e.message}`);
    }
  }
}

function generateSummaryReport() {
  const lines = [];
  lines.push('# ICM Portal Exploration Report');
  lines.push(`\nGenerated: ${new Date().toISOString()}\n`);

  // API Endpoints Summary
  lines.push('## API Endpoints Discovered\n');

  const uniqueEndpoints = new Map();
  for (const call of capturedAPICalls) {
    // Normalize URL (remove query params for grouping)
    const urlObj = new URL(call.url);
    const baseUrl = `${urlObj.origin}${urlObj.pathname}`;
    const key = `${call.method} ${baseUrl}`;

    if (!uniqueEndpoints.has(key)) {
      uniqueEndpoints.set(key, {
        method: call.method,
        baseUrl,
        fullUrls: [],
        hasAuth: !!call.requestHeaders?.authorization,
        contentType: call.requestHeaders?.['content-type'],
        responseStatus: call.responseStatus,
        postDataExample: call.requestPostData,
        responseBodySample: call.responseBody?.substring(0, 500),
      });
    }
    uniqueEndpoints.get(key).fullUrls.push(call.url);
  }

  // Group by domain
  const byDomain = {};
  for (const [key, info] of uniqueEndpoints) {
    const domain = new URL(info.baseUrl).hostname;
    if (!byDomain[domain]) byDomain[domain] = [];
    byDomain[domain].push({ key, ...info });
  }

  for (const [domain, endpoints] of Object.entries(byDomain)) {
    lines.push(`### ${domain}\n`);
    for (const ep of endpoints) {
      lines.push(`- **${ep.method}** \`${ep.baseUrl}\``);
      lines.push(`  - Auth: ${ep.hasAuth ? 'Bearer token' : 'None'}`);
      if (ep.contentType) lines.push(`  - Content-Type: ${ep.contentType}`);
      lines.push(`  - Status: ${ep.responseStatus}`);
      if (ep.postDataExample) {
        lines.push(`  - Request body: \`${ep.postDataExample.substring(0, 200)}\``);
      }
    }
    lines.push('');
  }

  // UI Elements Summary
  lines.push('## UI Elements Summary\n');

  for (const [pageName, elements] of Object.entries(capturedUIElements)) {
    if (pageName === 'navigationLinks' || pageName === 'jsInfo') continue;

    lines.push(`### Page: ${pageName}\n`);

    if (elements.framework) {
      const frameworks = Object.entries(elements.framework).filter(([k, v]) => v).map(([k]) => k);
      if (frameworks.length) {
        lines.push(`**Frameworks detected:** ${frameworks.join(', ')}\n`);
      }
    }

    if (elements.buttons?.length) {
      lines.push(`**Buttons (${elements.buttons.length}):**`);
      for (const btn of elements.buttons.slice(0, 30)) {
        lines.push(`- "${btn.text}" ${btn.ariaLabel ? `(aria: ${btn.ariaLabel})` : ''} ${btn.disabled ? '[disabled]' : ''}`);
      }
      lines.push('');
    }

    if (elements.inputs?.length) {
      lines.push(`**Input fields (${elements.inputs.length}):**`);
      for (const input of elements.inputs.slice(0, 30)) {
        lines.push(`- ${input.type || 'text'}: name="${input.name}" placeholder="${input.placeholder}" ${input.ariaLabel ? `aria="${input.ariaLabel}"` : ''}`);
      }
      lines.push('');
    }

    if (elements.selects?.length) {
      lines.push(`**Select dropdowns (${elements.selects.length}):**`);
      for (const sel of elements.selects.slice(0, 10)) {
        lines.push(`- ${sel.name || sel.id}: ${sel.options?.length} options`);
        for (const opt of sel.options?.slice(0, 10) || []) {
          lines.push(`  - "${opt.text}" = ${opt.value}`);
        }
      }
      lines.push('');
    }

    if (elements.tables?.length) {
      lines.push(`**Tables/Grids (${elements.tables.length}):**`);
      for (const table of elements.tables) {
        lines.push(`- Headers: ${table.headers?.join(', ') || 'none'}`);
        lines.push(`  Rows: ${table.rowCount}`);
      }
      lines.push('');
    }

    if (elements.tabs?.length) {
      lines.push(`**Tabs (${elements.tabs.length}):**`);
      for (const tab of elements.tabs.slice(0, 20)) {
        lines.push(`- "${tab.text}" ${tab.selected === 'true' ? '[SELECTED]' : ''}`);
      }
      lines.push('');
    }
  }

  // Navigation Links
  if (capturedUIElements.navigationLinks?.length) {
    lines.push('## Navigation Structure\n');
    for (const link of capturedUIElements.navigationLinks) {
      lines.push(`- [${link.text}](${link.href})`);
    }
    lines.push('');
  }

  // JS Info
  if (capturedUIElements.jsInfo) {
    lines.push('## JavaScript/Client Info\n');
    const js = capturedUIElements.jsInfo;

    if (js.localStorageKeys?.length) {
      lines.push(`**localStorage keys:** ${js.localStorageKeys.join(', ')}\n`);
    }
    if (js.scriptSources?.length) {
      lines.push(`**Script sources (${js.scriptSources.length}):**`);
      for (const src of js.scriptSources.slice(0, 20)) {
        lines.push(`- ${src}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

main().catch(console.error);
