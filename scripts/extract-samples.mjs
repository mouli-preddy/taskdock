import { readFileSync, writeFileSync } from 'fs';

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
console.log('msgIdx:', msgIdx);

// Collect unique patterns of pipe-delimited messages
let count = 0;
const seen = new Set();
for (let i = 1; i < lines.length && count < 8; i++) {
  const fields = parseLine(lines[i]);
  const msg = fields[msgIdx] || '';
  if (msg.includes(' || ')) {
    // Get the method name prefix
    const prefix = msg.substring(0, msg.indexOf(' || '));
    if (!seen.has(prefix)) {
      seen.add(prefix);
      count++;
      console.log(`\n=== Sample ${count} (row ${i}) ===`);
      console.log(msg.substring(0, 800));
    }
  }
}

// Also count how many pipe-delimited messages exist
let pipeCount = 0;
for (let i = 1; i < lines.length; i++) {
  const fields = parseLine(lines[i]);
  const msg = fields[msgIdx] || '';
  if (msg.includes(' || ')) pipeCount++;
}
console.log(`\n\nTotal pipe-delimited messages: ${pipeCount} / ${lines.length - 1}`);
