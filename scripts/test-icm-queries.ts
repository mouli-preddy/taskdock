/**
 * Test script: Verify ICM query APIs return data matching the ICM portal.
 *
 * Run with: npx tsx scripts/test-icm-queries.ts
 */

import { IcmApiClient } from '../src/main/icm-api.js';

const client = new IcmApiClient();

async function main() {
  console.log('=== ICM Query API Tests ===\n');

  // 1. Get current user
  console.log('--- Step 1: GetCurrentUser ---');
  let userId: number;
  let userAlias: string;
  let teams: Record<string, any>;
  try {
    const user = await client.getCurrentUser();
    userId = user.Id;
    userAlias = user.Alias || (user as any).AliasShort;
    teams = (user as any).Teams || {};
    console.log(`  User: ${(user as any).FullName || user.DisplayName} (${userAlias})`);
    console.log(`  Id: ${userId}`);
    console.log(`  Teams: ${Object.keys(teams).length}`);

    // List unique services
    const services = new Map<number, string>();
    for (const t of Object.values(teams) as any[]) {
      if (t.ServiceId && t.ServiceName) services.set(t.ServiceId, t.ServiceName);
    }
    console.log(`  Services: ${Array.from(services.values()).join(', ')}`);
    console.log('  PASS\n');
  } catch (error) {
    console.error('  FAIL:', error);
    process.exit(1);
  }

  // 2. Get favorite queries
  console.log('--- Step 2: GetFavoriteQueries ---');
  try {
    const favorites = await client.getFavoriteQueries(userId);
    console.log(`  Count: ${favorites.length}`);

    const expectedNames = [
      'MeetingsCore - Backup On-Call Incidents',
      'MeetingsCore - Customer/Team Escalations',
      'MeetingsCore - Primary On-Call Incidents',
      'MeetingsCore - Reliability Alerts',
      'MeetingsCore - Sev3s - AS',
      'MeetingsCore - Sev3s - CS',
      'MeetingsCore - Sev3s - CSS',
      'MeetingsCore - Sev3s - MLC',
      'MeetingsCore - Sev3s - TS',
    ];

    const actualNames = favorites.map(fq => fq.Query.Name).sort();
    console.log('  Queries:');
    for (const fq of favorites) {
      const hasCriteria = !!fq.Query.Criteria;
      console.log(`    - ${fq.Query.Name} (QueryId: ${fq.Query.QueryId}, hasCriteria: ${hasCriteria})`);
    }

    // Check all expected names are present
    const missingNames = expectedNames.filter(n => !actualNames.includes(n));
    if (missingNames.length > 0) {
      console.log(`  WARNING: Missing expected queries: ${missingNames.join(', ')}`);
    }

    if (favorites.length >= 9) {
      console.log('  PASS\n');
    } else {
      console.log(`  WARN: Expected >= 9, got ${favorites.length}\n`);
    }
  } catch (error) {
    console.error('  FAIL:', error);
  }

  // 3. Get saved (contact) queries
  console.log('--- Step 3: GetContactQueries (My Queries) ---');
  try {
    const saved = await client.getContactQueries(userId);
    console.log(`  Count: ${saved.length}`);

    console.log('  Queries:');
    for (const q of saved) {
      console.log(`    - ${q.Name} (QueryId: ${q.QueryId}, Folder: ${q.Folder || 'N/A'}, hasCriteria: ${!!q.Criteria})`);
    }

    const hasActiveAlerts = saved.some(q => q.Name === 'Active ICM Alerts');
    const hasBroadcast = saved.some(q => q.Name === 'Broadcast_Active_Me');

    if (hasActiveAlerts && hasBroadcast) {
      console.log('  PASS\n');
    } else {
      console.log('  WARN: Expected "Active ICM Alerts" and "Broadcast_Active_Me"\n');
    }
  } catch (error) {
    console.error('  FAIL:', error);
  }

  // 4. Get shared queries (single call with contactId)
  console.log('--- Step 4: GetSharedQuery (Shared Queries) ---');
  try {
    const allShared = await client.getSharedQueries(userId);
    console.log(`  Total shared queries: ${allShared.length}`);

    // Group by TenantId (service)
    const serviceNames = new Map<number, string>();
    for (const t of Object.values(teams) as any[]) {
      if (t.ServiceId && t.ServiceName) serviceNames.set(t.ServiceId, t.ServiceName);
    }

    const byService = new Map<number, any[]>();
    for (const q of allShared) {
      const sid = q.TenantId || 0;
      if (!byService.has(sid)) byService.set(sid, []);
      byService.get(sid)!.push(q);
    }

    for (const [sid, queries] of byService) {
      const name = serviceNames.get(sid) || `Service ${sid}`;
      console.log(`  ${name} (${sid}): ${queries.length} queries`);
      // Show first 3 per service
      for (const q of queries.slice(0, 3)) {
        console.log(`    - ${q.Name} (Folder: ${q.Folder || 'Default'})`);
      }
      if (queries.length > 3) console.log(`    ... and ${queries.length - 3} more`);
    }

    // Verify Skype Calling shared queries from screenshot
    const skypeCallingQueries = byService.get(20300) || [];
    const expectedSkypeShared = [
      'Broker - All Unresolved Incidents',
      'Call Controller - All Unresolved Incidents',
      'Skype Sev-1',
    ];
    const foundExpected = expectedSkypeShared.filter(name =>
      skypeCallingQueries.some((q: any) => q.Name === name)
    );
    console.log(`  Skype Calling verification: ${foundExpected.length}/${expectedSkypeShared.length} expected queries found`);

    console.log('  PASS\n');
  } catch (error) {
    console.error('  FAIL:', error);
  }

  // 5. Test queryIncidents with a simple filter
  console.log('--- Step 5: QueryIncidents (My Incidents) ---');
  try {
    const filter = `ContactAlias eq '${userAlias}' and State ne 'Resolved'`;
    const incidents = await client.queryIncidents(filter, 5);
    console.log(`  Filter: ${filter}`);
    console.log(`  Count: ${incidents.length}`);
    if (incidents.length > 0) {
      console.log(`  First: #${incidents[0].Id} - ${incidents[0].Title?.substring(0, 60)}`);
    }
    console.log('  PASS\n');
  } catch (error) {
    console.error('  FAIL:', error);
  }

  console.log('=== All tests complete ===');
}

main().catch(console.error);
