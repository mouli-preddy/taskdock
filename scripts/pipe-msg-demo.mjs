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

function shorten(guid) {
  if (!guid) return '';
  return guid.split('-')[0] ?? guid;
}

function transformMessage(value) {
  if (!value) return value;
  const prefixMatch = value.match(/^\[(\w+),\S+\(\d+\)\s+\S+\s+\S+\]\s*(.+)$/);
  const method = prefixMatch ? prefixMatch[1] : null;
  const body = prefixMatch ? prefixMatch[2] : value;

  if (body.includes(' || ')) {
    const pairs = {};
    for (const segment of body.split(' || ')) {
      const eqIdx = segment.indexOf('=');
      if (eqIdx > 0) {
        const k = segment.substring(0, eqIdx).trim();
        const v = segment.substring(eqIdx + 1).trim().replace(/ \|\|$/, '');
        if (v) pairs[k] = v;
      }
    }
    const parts = [];
    if (pairs.statuscode) parts.push(`${pairs.statuscode}`);
    if (pairs.msgid) parts.push(`msg:${shorten(pairs.msgid)}`);
    else if (pairs['request.msgid']) parts.push(`req:${shorten(pairs['request.msgid'])}`);
    if (pairs.pid) parts.push(`pid:${shorten(pairs.pid)}`);

    const label = method ? `[${method}]` : '[Protocol]';
    return parts.length ? `${label} ${parts.join(' ')}` : `${label}`;
  }

  if (method) return `[${method}] ${body}`;
  return value;
}

const header = parseLine(lines[0]);
const msgIdx = header.indexOf('Message');

console.log('PIPE-DELIMITED MESSAGE TRANSFORM — Before vs After\n');
let count = 0;
for (let i = 1; i < lines.length && count < 10; i++) {
  const fields = parseLine(lines[i]);
  const msg = fields[msgIdx] || '';
  if (!msg.includes(' || ')) continue;
  count++;
  const after = transformMessage(msg);
  console.log(`#${count} BEFORE (${msg.length} chars):`);
  console.log(`   ${msg}`);
  console.log(`   AFTER (${after.length} chars):`);
  console.log(`   ${after}`);
  console.log(`   Saved: ${msg.length - after.length} chars (${Math.round((1 - after.length / msg.length) * 100)}%)\n`);
}
