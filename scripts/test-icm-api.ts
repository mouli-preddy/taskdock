/**
 * ICM API Client Integration Test
 *
 * Tests every public method on IcmApiClient against the live ICM API.
 * Requires a valid token in %LOCALAPPDATA%\BrainBot\icm_tokens.json
 *
 * Usage: npx tsx scripts/test-icm-api.ts
 */

import { IcmApiClient } from '../src/main/icm-api.js';

const client = new IcmApiClient();

interface TestResult {
  method: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  detail: string;
}

const results: TestResult[] = [];

// Context collected from earlier tests to feed into later ones
let currentUserAlias = '';
let currentUserObjectId = 0;
let sampleIncidentId = 0;
let sampleOwningTeamId = 0;
let sampleAlertSourceId = '';
let sampleServiceId = 0;

async function runTest(
  name: string,
  fn: () => Promise<string>,
  skipReason?: string
): Promise<void> {
  if (skipReason) {
    results.push({ method: name, status: 'SKIP', duration: 0, detail: skipReason });
    console.log(`  [SKIP] ${name} — ${skipReason}`);
    return;
  }
  const start = Date.now();
  try {
    const detail = await fn();
    const duration = Date.now() - start;
    results.push({ method: name, status: 'PASS', duration, detail });
    console.log(`  [PASS] ${name} (${duration}ms) — ${detail}`);
  } catch (err: any) {
    const duration = Date.now() - start;
    const msg = err?.message || String(err);
    results.push({ method: name, status: 'FAIL', duration, detail: msg });
    console.log(`  [FAIL] ${name} (${duration}ms) — ${msg}`);
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('  ICM API Client — Integration Test Suite');
  console.log('='.repeat(70));
  console.log();

  // ===== Token Management =====
  console.log('--- Token Management ---');

  await runTest('getToken', async () => {
    const token = await client.getToken();
    if (!token || token.length < 100) throw new Error('Token too short');
    return `JWT ${token.length} chars`;
  });

  // ===== User & Auth =====
  console.log('\n--- User & Auth ---');

  await runTest('getCurrentUser', async () => {
    const user = await client.getCurrentUser() as any;
    if (!user) throw new Error('No user returned');
    currentUserAlias = user.Alias || user.alias || user.EmailAddress || '';
    currentUserObjectId = user.ObjectId || user.objectId || user.Id || user.id || 0;
    return `User: ${currentUserAlias} (ObjectId: ${currentUserObjectId})`;
  });

  await runTest('getPermissions', async () => {
    const perms = await client.getPermissions();
    // Permissions may come back as array or object
    const count = Array.isArray(perms) ? perms.length : Object.keys(perms).length;
    return `${count} permissions`;
  });

  // ===== Incidents (Query) =====
  console.log('\n--- Incidents ---');

  await runTest('queryIncidents', async () => {
    const incidents = await client.queryIncidents(
      "State ne 'Resolved'",
      5,
      'Id,Severity,State,Title,OwningTeamName,OwningTeamId,OwningServiceId,ContactAlias,CreatedDate',
      'CustomFields,AlertSource',
      'CreatedDate desc'
    );
    if (!Array.isArray(incidents)) throw new Error('Expected array');
    if (incidents.length > 0) {
      sampleIncidentId = incidents[0].Id;
      sampleOwningTeamId = incidents[0].OwningTeamId;
      sampleServiceId = incidents[0].OwningServiceId;
      if (incidents[0].AlertSource) {
        sampleAlertSourceId = incidents[0].AlertSource.AlertSourceId;
      }
    }
    return `${incidents.length} incidents (first: ${sampleIncidentId})`;
  });

  await runTest('getIncidentCount', async () => {
    const count = await client.getIncidentCount("State ne 'Resolved'");
    return `Count: ${count}`;
  });

  await runTest('getIncident', async () => {
    if (!sampleIncidentId) throw new Error('No sample incident ID');
    const incident = await client.getIncident(sampleIncidentId);
    if (!incident || !incident.Id) throw new Error('No incident returned');
    return `Incident ${incident.Id}: "${incident.Title?.slice(0, 50)}"`;
  });

  await runTest('getIncidentBridges', async () => {
    if (!sampleIncidentId) throw new Error('No sample incident ID');
    const bridges = await client.getIncidentBridges(sampleIncidentId);
    return `${bridges.length} bridges`;
  });

  // ===== Discussion =====
  console.log('\n--- Discussion ---');

  await runTest('getDiscussionEntries', async () => {
    if (!sampleIncidentId) throw new Error('No sample incident ID');
    const entries = await client.getDiscussionEntries(sampleIncidentId);
    return `${entries.length} discussion entries`;
  });

  // Skip write operations (acknowledge, transfer, mitigate, resolve, addDiscussion) — they mutate state
  await runTest(
    'acknowledgeIncident',
    async () => '',
    'Skipped — mutates incident state'
  );
  await runTest(
    'transferIncident',
    async () => '',
    'Skipped — mutates incident state'
  );
  await runTest(
    'mitigateIncident',
    async () => '',
    'Skipped — mutates incident state'
  );
  await runTest(
    'resolveIncident',
    async () => '',
    'Skipped — mutates incident state'
  );
  await runTest(
    'addDiscussionEntry',
    async () => '',
    'Skipped — mutates incident state'
  );

  // ===== Queries =====
  console.log('\n--- Queries ---');

  await runTest('getFavoriteQueries', async () => {
    if (!currentUserObjectId) throw new Error('No user ObjectId available');
    const queries = await client.getFavoriteQueries(currentUserObjectId, 'Contact');
    return `${queries.length} favorite queries`;
  });

  await runTest('getContactQueries', async () => {
    if (!currentUserObjectId) throw new Error('No user ObjectId available');
    const queries = await client.getContactQueries(currentUserObjectId);
    return `${queries.length} saved queries`;
  });

  // ===== Teams & Services =====
  console.log('\n--- Teams & Services ---');

  await runTest('getTeams', async () => {
    if (!sampleOwningTeamId) throw new Error('No sample team ID');
    const teams = await client.getTeams([sampleOwningTeamId]);
    if (teams.length === 0) throw new Error('No teams returned');
    return `Team: ${teams[0].Name} (ID ${teams[0].Id})`;
  });

  await runTest('searchTeams', async () => {
    if (!sampleOwningTeamId) throw new Error('No sample team ID');
    const teams = await client.searchTeams(sampleOwningTeamId);
    return `${teams.length} team(s) found`;
  });

  await runTest('searchServices', async () => {
    if (!sampleServiceId) throw new Error('No sample service ID');
    const services = await client.searchServices(sampleServiceId);
    return `${services.length} service(s) found`;
  });

  await runTest('getAlertSources', async () => {
    if (!sampleAlertSourceId) return 'No alert source in sample data — skipping';
    const sources = await client.getAlertSources(sampleAlertSourceId);
    return `${sources.length} alert source(s)`;
  });

  // ===== Contacts =====
  console.log('\n--- Contacts ---');

  await runTest('resolveContacts', async () => {
    if (!currentUserAlias) throw new Error('No user alias available');
    // Try the alias we collected (might be email or alias)
    const contacts = await client.resolveContacts([currentUserAlias]);
    return `${contacts.length} contact(s) resolved`;
  });

  // ===== Preferences =====
  console.log('\n--- Preferences ---');

  await runTest('getUserPreferences', async () => {
    const alias = currentUserAlias || 'test';
    const prefs = await client.getUserPreferences(alias);
    return `${prefs.length} preference(s)`;
  });

  await runTest('getFeatureFlags', async () => {
    const alias = currentUserAlias || 'test';
    const flags = await client.getFeatureFlags('incidents', alias);
    const count = typeof flags === 'object' ? Object.keys(flags).length : 0;
    return `${count} feature flag(s)`;
  });

  // ===== Collaboration =====
  console.log('\n--- Collaboration ---');

  await runTest('getTeamsChannel', async () => {
    if (!sampleIncidentId) throw new Error('No sample incident ID');
    const channel = await client.getTeamsChannel(sampleIncidentId);
    return channel ? `Channel: ${channel.ChannelId || JSON.stringify(channel).slice(0, 60)}` : 'No channel (null — expected for most incidents)';
  });

  await runTest('getBreakingNews', async () => {
    const news = await client.getBreakingNews();
    return `${news.length} breaking news event(s)`;
  });

  // ===== Metadata =====
  console.log('\n--- Metadata ---');

  await runTest('getPropertyGroups', async () => {
    const groups = await client.getPropertyGroups();
    return `${groups.length} property group(s)`;
  });

  await runTest('getCloudInstances', async () => {
    const instances = await client.getCloudInstances();
    return `${instances.length} cloud instance(s)`;
  });

  // ===== Summary =====
  console.log('\n' + '='.repeat(70));
  console.log('  Test Summary');
  console.log('='.repeat(70));

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const totalTime = results.reduce((acc, r) => acc + r.duration, 0);

  console.log(`  Total:   ${results.length}`);
  console.log(`  Passed:  ${passed}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Time:    ${totalTime}ms`);
  console.log();

  if (failed > 0) {
    console.log('  Failed tests:');
    for (const r of results.filter((r) => r.status === 'FAIL')) {
      console.log(`    - ${r.method}: ${r.detail}`);
    }
    console.log();
  }

  console.log(passed > 0 && failed === 0 ? '  ALL TESTS PASSED' : `  ${failed} TEST(S) FAILED`);
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
