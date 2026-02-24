/**
 * Log field transformation demo
 * Reads the CSV, applies transforms, and shows before/after for each field.
 */
import { readFileSync } from 'fs';

// ── Parse CSV ──────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = values[i] ?? '');
    return row;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

// ── Transformers ───────────────────────────────────────────────────

/** env_time → compact time (strip date, show HH:mm:ss.fff) */
function transformTime(value) {
  if (!value) return value;
  // Input: 2026-02-20T15:32:22.4496710Z
  const match = value.match(/T(\d{2}:\d{2}:\d{2}\.\d{3})/);
  return match ? match[1] : value;
}

/** severityText → 3-letter abbreviation */
function transformSeverity(value) {
  const map = {
    'Information': 'INF',
    'Warning':     'WRN',
    'Error':       'ERR',
    'Critical':    'CRT',
    'Fatal':       'FTL',
    'Debug':       'DBG',
    'Verbose':     'VRB',
    'Trace':       'TRC',
  };
  return map[value] ?? value;
}

/** Message → extract [MethodName] + body, strip embedded IDs */
function transformMessage(value) {
  if (!value) return value;
  // Pattern: [MethodName,File.cs(line) activityId numericId] body
  const match = value.match(/^\[(\w+),\S+\(\d+\)\s+\S+\s+\S+\]\s*(.+)$/);
  if (match) {
    return `[${match[1]}] ${match[2]}`;
  }
  // Fallback: try simpler pattern [Something,...] body
  const fallback = value.match(/^\[([^\],]+)[^\]]*\]\s*(.+)$/);
  if (fallback) {
    return `[${fallback[1]}] ${fallback[2]}`;
  }
  return value;
}

/** ActivityId → short form (first 8 chars) */
function transformActivityId(value) {
  if (!value) return value;
  // e7575c71-a082-4385-9cb6-ac7514c60be3 → e7575c71
  return value.split('-')[0] ?? value;
}

/** GenevaPodName → strip common prefix, show short pod id */
function transformPodName(value) {
  if (!value) return value;
  // conv-deployment-5b77f5d999-b9zfw → b9zfw
  const match = value.match(/-([a-z0-9]+)$/);
  return match ? match[1] : value;
}

// ── All transforms ─────────────────────────────────────────────────
const TRANSFORMS = {
  env_time:       { fn: transformTime,       label: 'Compact time' },
  severityText:   { fn: transformSeverity,   label: '3-letter severity' },
  Message:        { fn: transformMessage,     label: 'Method + body' },
  ActivityId:     { fn: transformActivityId,  label: 'Short ID (8 chars)' },
  GenevaPodName:  { fn: transformPodName,     label: 'Short pod name' },
};

// ── Main ───────────────────────────────────────────────────────────
const csvPath = process.argv[2] || String.raw`C:\Users\kirmadi\.taskdock\dgrep\analysis\e8fb6026-3958-4a16-ba2d-87cab80d988b\data.csv`;
const csv = readFileSync(csvPath, 'utf-8');
const rows = parseCSV(csv).slice(0, 15);

console.log('='.repeat(100));
console.log('LOG FIELD TRANSFORMATION DEMO — First 15 rows');
console.log('='.repeat(100));

// Show per-field before/after
for (const [field, { fn, label }] of Object.entries(TRANSFORMS)) {
  console.log(`\n${'─'.repeat(100)}`);
  console.log(`FIELD: ${field}  →  Transform: ${label}`);
  console.log(`${'─'.repeat(100)}`);
  console.log(`${'#'.padEnd(4)} ${'BEFORE'.padEnd(45)} → AFTER`);
  console.log(`${'─'.repeat(100)}`);

  rows.forEach((row, i) => {
    const before = (row[field] ?? '').substring(0, 44);
    const after = fn(row[field] ?? '');
    console.log(`${String(i + 1).padEnd(4)} ${before.padEnd(45)} → ${after}`);
  });
}

// Show combined 1-line format
console.log(`\n${'═'.repeat(100)}`);
console.log('COMBINED 1-LINE FORMAT');
console.log(`${'═'.repeat(100)}`);

rows.forEach((row, i) => {
  const time = transformTime(row.env_time);
  const sev = transformSeverity(row.severityText);
  const msg = transformMessage(row.Message);
  const padSev = sev.padEnd(3);
  const line = `${time}  ${padSev}  ${msg}`;
  console.log(`${String(i + 1).padStart(2)}│ ${line}`);
});

// Show char savings
console.log(`\n${'─'.repeat(100)}`);
console.log('SPACE SAVINGS');
console.log(`${'─'.repeat(100)}`);
let totalBefore = 0, totalAfter = 0;
for (const [field, { fn }] of Object.entries(TRANSFORMS)) {
  const befLen = rows.reduce((s, r) => s + (r[field]?.length ?? 0), 0);
  const aftLen = rows.reduce((s, r) => s + fn(r[field] ?? '').length, 0);
  totalBefore += befLen;
  totalAfter += aftLen;
  const pct = befLen > 0 ? Math.round((1 - aftLen / befLen) * 100) : 0;
  console.log(`  ${field.padEnd(20)} ${String(befLen).padStart(6)} → ${String(aftLen).padStart(6)} chars  (${pct}% reduction)`);
}
const totalPct = Math.round((1 - totalAfter / totalBefore) * 100);
console.log(`  ${'TOTAL'.padEnd(20)} ${String(totalBefore).padStart(6)} → ${String(totalAfter).padStart(6)} chars  (${totalPct}% reduction)`);
