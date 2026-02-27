import { readFileSync } from 'fs';

const csv = readFileSync(String.raw`C:\Users\kirmadi\.taskdock\dgrep\analysis\e8fb6026-3958-4a16-ba2d-87cab80d988b\data.csv`, 'utf-8');
const lines = csv.split('\n');

function parseLine(line) {
  const result = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { result.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  result.push(cur); return result;
}

const header = parseLine(lines[0]);
const msgIdx = header.indexOf('Message');

// Analyze all keys, which are empty, which are redundant with columns
const keyCounts = {};    // key -> total occurrences
const keyEmpty = {};     // key -> count of empty values
const keyValues = {};    // key -> Set of unique values (capped)

for (let i = 1; i < lines.length; i++) {
  const fields = parseLine(lines[i]);
  const msg = fields[msgIdx] || '';
  if (!msg.includes(' || ')) continue;

  const pairs = msg.split(' || ').slice(1); // skip [MethodName,...] prefix
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 0) continue;
    const key = pair.substring(0, eqIdx).trim();
    const val = pair.substring(eqIdx + 1).trim();
    if (!key) continue;

    keyCounts[key] = (keyCounts[key] || 0) + 1;
    if (!val) keyEmpty[key] = (keyEmpty[key] || 0) + 1;
    if (!keyValues[key]) keyValues[key] = new Set();
    if (keyValues[key].size < 20) keyValues[key].add(val || '(empty)');
  }
}

console.log('Key analysis (across 199 pipe-delimited messages):\n');
console.log('Key'.padEnd(20), 'Count'.padStart(6), 'Empty'.padStart(6), 'Unique'.padStart(8), '  Sample values');
console.log('-'.repeat(90));
for (const key of Object.keys(keyCounts).sort()) {
  const cnt = keyCounts[key];
  const empty = keyEmpty[key] || 0;
  const uniq = keyValues[key].size;
  const samples = [...keyValues[key]].slice(0, 3).join(', ');
  console.log(key.padEnd(20), String(cnt).padStart(6), String(empty).padStart(6), String(uniq).padStart(8), ' ', samples);
}
