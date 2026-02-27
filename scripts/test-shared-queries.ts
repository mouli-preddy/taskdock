/**
 * Debug: Find the correct parameter for GetSharedQuery
 *
 * Run with: npx tsx scripts/test-shared-queries.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const TOKEN_CACHE_DIR = join(
  process.env.LOCALAPPDATA || join(process.env.HOME || '', 'AppData', 'Local'),
  'BrainBot'
);
const TOKEN_CACHE_FILE = join(TOKEN_CACHE_DIR, 'icm_tokens.json');

async function getToken(): Promise<string> {
  const data = readFileSync(TOKEN_CACHE_FILE, 'utf-8');
  const cache = JSON.parse(data);
  return cache.bearer_token;
}

async function tryGetSharedQuery(token: string, body: any): Promise<any> {
  const url = 'https://prod.microsofticm.com/api2/incidentapi/GetSharedQuery?$filter=Criteria%20ne%20null&$orderby=Name';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  return { status: resp.status, body: text };
}

async function main() {
  const token = await getToken();

  // Try various parameter names
  const tests = [
    { contactId: 87914 },
  ];

  for (const body of tests) {
    const result = await tryGetSharedQuery(token, body);
    const label = JSON.stringify(body);
    try {
      if (result.status === 200) {
        const parsed = JSON.parse(result.body);
        const count = parsed.value?.length ?? 'N/A';
        console.log(`${label} => ${result.status} OK (${count} items)`);
        if (count !== 'N/A' && count > 0) {
          // Group by TenantId (service)
          const byService = new Map<number, any[]>();
          for (const q of parsed.value) {
            const sid = q.TenantId;
            if (!byService.has(sid)) byService.set(sid, []);
            byService.get(sid)!.push(q);
          }
          for (const [sid, queries] of byService) {
            console.log(`  Service ${sid}:`);
            for (const q of queries) {
              console.log(`    - ${q.Name} (Folder: ${q.Folder || 'Default'}, TeamId: ${q.TeamId || 'N/A'})`);
            }
          }
        }
      } else {
        const err = JSON.parse(result.body);
        console.log(`${label} => ${result.status} - ${err.error?.innererror?.message?.substring(0, 120) || err.error?.message?.substring(0, 120)}`);
      }
    } catch {
      console.log(`${label} => ${result.status} - ${result.body.substring(0, 200)}`);
    }
  }
}

main().catch(console.error);
