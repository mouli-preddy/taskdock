/**
 * Validation script for GenevaApiClient
 * Run with: npx tsx scripts/validate-geneva-api.ts
 */
import { GenevaApiClient } from '../src/main/geneva-api.js';

const ACCOUNT = 'SkypeCoreConv';
const DASHBOARD_PATH = 'ServiceHealth/CS/MQL';

async function main() {
  const client = new GenevaApiClient();
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    process.stdout.write(`\n[TEST] ${name}... `);
    try {
      await fn();
      passed++;
      console.log('PASS');
    } catch (err: any) {
      failed++;
      console.log('FAIL');
      console.log(`  Error: ${err.message}`);
    }
  }

  // ---- Test 1: Token loading ----
  await test('Token loading', async () => {
    // Access private method via cast for testing
    const tokens = (client as any).getTokens();
    assert(tokens.cookie.length > 50, `cookie too short: ${tokens.cookie.length}`);
    assert(tokens.csrf.length > 0, `csrf empty`);
    console.log(`(cookie=${tokens.cookie.length} chars, csrf=${tokens.csrf.length} chars)`);
  });

  // ---- Test 2: getDashboardTree ----
  let dashboards: any[] = [];
  await test('getDashboardTree', async () => {
    dashboards = await client.getDashboardTree(ACCOUNT);
    assert(Array.isArray(dashboards), 'expected array');
    assert(dashboards.length > 0, 'expected at least 1 dashboard');
    console.log(`(found ${dashboards.length} dashboards)`);

    // Validate shape of first entry
    const first = dashboards[0];
    assert(typeof first.path === 'string', 'missing path');
    assert(typeof first.account === 'string' || first.account === undefined, 'bad account type');
    console.log(`  Sample: ${first.path}`);
  });

  // ---- Test 3: getDashboard ----
  let dashboard: any = null;
  await test('getDashboard', async () => {
    dashboard = await client.getDashboard(ACCOUNT, DASHBOARD_PATH);
    assert(dashboard.account === ACCOUNT, `expected account=${ACCOUNT}, got ${dashboard.account}`);
    assert(typeof dashboard.id === 'string', 'missing id');
    assert(typeof dashboard.path === 'string', 'missing path');
    assert(dashboard.content?.wires?.widgets, 'missing content.wires.widgets');

    const widgetCount = dashboard.content.wires.widgets.length;
    assert(widgetCount > 0, 'expected at least 1 widget');
    console.log(`(id=${dashboard.id}, ${widgetCount} widgets)`);

    // Validate widget shape
    const w = dashboard.content.wires.widgets[0];
    assert(typeof w.guid === 'string', 'widget missing guid');
    assert(typeof w.wires?.title === 'string', 'widget missing title');
    console.log(`  First widget: "${w.wires.title}" (${w.guid})`);
  });

  // ---- Test 4: queryMetrics (single query from dashboard) ----
  await test('queryMetrics (single MQL query)', async () => {
    // Find the first widget with MQL queries
    const widgets = dashboard.content.wires.widgets;
    let mqlQuery = null;
    let widgetTitle = '';
    for (const w of widgets) {
      if (w.wires?.data?.mdmKql?.length) {
        mqlQuery = w.wires.data.mdmKql[0];
        widgetTitle = w.wires.title;
        break;
      }
    }
    assert(mqlQuery, 'no MQL queries found in any widget');

    const now = Date.now();
    const startTime = new Date(now - 86400000); // last 24h
    const endTime = new Date(now);

    console.log(`(widget="${widgetTitle}", ns=${mqlQuery.namespace})`);

    const result = await client.queryMetrics({
      account: mqlQuery.account || ACCOUNT,
      namespace: mqlQuery.namespace,
      query: mqlQuery.kqlQuery,
      startTime,
      endTime,
    });

    assert(typeof result.timeResolutionInMilliseconds === 'number', 'missing timeResolutionInMilliseconds');
    assert(typeof result.startTimeUtc === 'string', 'missing startTimeUtc');
    assert(typeof result.endTimeUtc === 'string', 'missing endTimeUtc');
    assert(Array.isArray(result.timeSeriesList), 'missing timeSeriesList');

    console.log(`  Resolution: ${result.timeResolutionInMilliseconds}ms`);
    console.log(`  Time series count: ${result.timeSeriesList.length}`);
    console.log(`  Output dimensions: ${result.outputDimensions?.join(', ') || 'none'}`);

    if (result.timeSeriesList.length > 0) {
      const ts = result.timeSeriesList[0];
      assert(Array.isArray(ts.dimensionList), 'missing dimensionList');
      assert(Array.isArray(ts.timeSeriesValues), 'missing timeSeriesValues');
      const dims = ts.dimensionList.map((d: any) => `${d.key}=${d.value}`).join(', ');
      const valueCount = ts.timeSeriesValues[0]?.value?.length ?? 0;
      console.log(`  First series: [${dims}] (${valueCount} data points)`);
    }
  });

  // ---- Test 5: getDashboardMetrics (composite) ----
  await test('getDashboardMetrics (composite)', async () => {
    const now = Date.now();
    const result = await client.getDashboardMetrics(ACCOUNT, DASHBOARD_PATH, {
      startTime: new Date(now - 86400000),
      endTime: new Date(now),
    });

    assert(result.dashboard, 'missing dashboard');
    assert(result.dashboard.account === ACCOUNT, 'wrong account');
    assert(Array.isArray(result.widgetMetrics), 'missing widgetMetrics');
    assert(result.widgetMetrics.length > 0, 'expected at least 1 widget metric result');

    console.log(`(${result.widgetMetrics.length} query results)`);

    for (const wm of result.widgetMetrics) {
      const seriesCount = wm.results.timeSeriesList?.length ?? 0;
      console.log(`  "${wm.widgetTitle}" → ${seriesCount} time series`);
    }
  });

  // ---- Summary ----
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log('='.repeat(50));

  process.exit(failed > 0 ? 1 : 0);
}

function assert(condition: any, msg: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
