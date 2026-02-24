/**
 * Generates an HTML page showing before/after log transformations side by side.
 */
import { readFileSync, writeFileSync } from 'fs';

// ── Parse CSV ──────────────────────────────────────────────────────
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

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);
  return { headers, rows: lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = values[i] ?? '');
    return row;
  })};
}

// ── Transformers ───────────────────────────────────────────────────
function transformTime(value) {
  if (!value) return value;
  const match = value.match(/T(\d{2}:\d{2}:\d{2}\.\d{3})/);
  return match ? match[1] : value;
}

function transformSeverity(value) {
  const map = { 'Information': 'INF', 'Warning': 'WRN', 'Error': 'ERR', 'Critical': 'CRT', 'Fatal': 'FTL', 'Debug': 'DBG', 'Verbose': 'VRB', 'Trace': 'TRC' };
  return map[value] ?? value;
}

function transformMessage(value) {
  if (!value) return value;

  // 1) Extract [MethodName, ...] prefix from all structured messages
  const prefixMatch = value.match(/^\[(\w+),\S+\(\d+\)\s+\S+\s+\S+\]\s*(.+)$/);
  const method = prefixMatch ? prefixMatch[1] : null;
  const body = prefixMatch ? prefixMatch[2] : value;

  // 2) Pipe-delimited key=value messages (LogProtocolMessage etc.)
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
    // Build compact summary: statuscode + msgid (the useful fields)
    // Drop: activityid (redundant w/ column), fid (always empty), ltid (noise),
    //        local.msgid (internal), request.msgid when same as msgid
    const parts = [];
    if (pairs.statuscode) parts.push(`${pairs.statuscode}`);
    if (pairs.msgid) parts.push(`msg:${shorten(pairs.msgid)}`);
    else if (pairs['request.msgid']) parts.push(`req:${shorten(pairs['request.msgid'])}`);
    if (pairs.pid) parts.push(`pid:${shorten(pairs.pid)}`);

    const label = method ? `[${method}]` : '[Protocol]';
    return parts.length ? `${label} ${parts.join(' ')}` : `${label}`;
  }

  // 3) Normal structured message — just method + body
  if (method) return `[${method}] ${body}`;

  // 4) Fallback for other [Something,...] patterns
  const fallback = value.match(/^\[([^\],]+)[^\]]*\]\s*(.+)$/);
  if (fallback) return `[${fallback[1]}] ${fallback[2]}`;
  return value;
}

/** Shorten a GUID to first 8 chars */
function shorten(guid) {
  if (!guid) return '';
  return guid.split('-')[0] ?? guid;
}

function transformActivityId(value) {
  if (!value) return value;
  return value.split('-')[0] ?? value;
}

function transformPodName(value) {
  if (!value) return value;
  const match = value.match(/-([a-z0-9]+)$/);
  return match ? match[1] : value;
}

const TRANSFORMS = {
  env_time: transformTime,
  severityText: transformSeverity,
  Message: transformMessage,
  ActivityId: transformActivityId,
  GenevaPodName: transformPodName,
};

function esc(s) {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sevClass(raw) {
  const v = (raw ?? '').toLowerCase();
  if (v === 'error' || v === 'critical' || v === 'fatal') return 'sev-err';
  if (v === 'warning' || v === 'warn') return 'sev-wrn';
  if (v === 'debug' || v === 'verbose' || v === 'trace') return 'sev-dbg';
  return 'sev-inf';
}

// ── Main ───────────────────────────────────────────────────────────
const csvPath = process.argv[2] || String.raw`C:\Users\kirmadi\.taskdock\dgrep\analysis\e8fb6026-3958-4a16-ba2d-87cab80d988b\data.csv`;
const csv = readFileSync(csvPath, 'utf-8');
const { headers, rows } = parseCSV(csv);

// All columns for the "before" table
const allCols = headers;

// Visible columns for "after" table (the important ones, transformed)
const afterCols = ['env_time', 'severityText', 'Message', 'ActivityId', 'RoleInstance', 'GenevaPodName'];

function buildBeforeTable(data) {
  let html = '<table class="log-table raw-table"><thead><tr><th class="row-num">#</th>';
  for (const col of allCols) {
    html += `<th>${esc(col)}</th>`;
  }
  html += '</tr></thead><tbody>';
  data.forEach((row, i) => {
    const sc = sevClass(row.severityText);
    html += `<tr class="${sc}"><td class="row-num">${i + 1}</td>`;
    for (const col of allCols) {
      const val = row[col] ?? '';
      html += `<td title="${esc(val)}">${esc(val)}</td>`;
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function buildAfterTable(data) {
  const colConfig = {
    env_time:      { label: 'Time',     width: '100px' },
    severityText:  { label: 'Sev',      width: '40px' },
    Message:       { label: 'Message',  width: 'auto' },   // takes remaining space
    ActivityId:    { label: 'Activity', width: '80px' },
    RoleInstance:  { label: 'Instance', width: '110px' },
    GenevaPodName: { label: 'Pod',      width: '55px' },
  };
  let html = '<table class="log-table after-table"><colgroup><col style="width:30px">';
  for (const col of afterCols) {
    const w = colConfig[col]?.width ?? '100px';
    if (w === 'auto') html += '<col>';
    else html += `<col style="width:${w}">`;
  }
  html += '</colgroup><thead><tr><th class="row-num">#</th>';
  for (const col of afterCols) {
    html += `<th>${esc(colConfig[col]?.label || col)}</th>`;
  }
  html += '</tr></thead><tbody>';
  data.forEach((row, i) => {
    const sc = sevClass(row.severityText);
    html += `<tr class="${sc}"><td class="row-num">${i + 1}</td>`;
    for (const col of afterCols) {
      const raw = row[col] ?? '';
      const transformed = TRANSFORMS[col] ? TRANSFORMS[col](raw) : raw;
      let cls = '';
      if (col === 'severityText') cls = ` class="sev-pill ${sc}"`;
      if (col === 'Message') cls = ' class="msg-cell"';
      if (col === 'env_time') cls = ' class="time-cell"';
      html += `<td${cls} title="${esc(raw)}">${esc(transformed)}</td>`;
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Log Transform — Before &amp; After</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #c9d1d9; --text-dim: #8b949e; --text-bright: #f0f6fc;
    --accent: #58a6ff; --err: #f85149; --wrn: #e5a100; --inf: #8b949e; --dbg: #6e7681;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; padding: 24px; }
  h1 { color: var(--text-bright); font-size: 20px; margin-bottom: 4px; }
  h2 { color: var(--accent); font-size: 15px; font-weight: 600; margin: 24px 0 8px; display: flex; align-items: center; gap: 8px; }
  h2 .badge { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 2px 10px; font-size: 12px; color: var(--text-dim); font-weight: 400; }
  .subtitle { color: var(--text-dim); font-size: 13px; margin-bottom: 20px; }
  .section { margin-bottom: 32px; }
  .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
  .log-table { border-collapse: collapse; font-size: 12px; font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; white-space: nowrap; width: 100%; }
  .log-table th { background: #1c2128; color: var(--text-dim); font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; position: sticky; top: 0; z-index: 1; }
  .log-table td { padding: 4px 10px; border-bottom: 1px solid #21262d; overflow: hidden; text-overflow: ellipsis; }
  .log-table tbody tr:hover { background: #1c2128; }
  .row-num { color: var(--text-dim); text-align: right; font-size: 11px; }

  /* Raw table: auto layout, compact cells */
  .raw-table { table-layout: auto; }
  .raw-table td { max-width: 200px; color: var(--text-dim); }
  .raw-table td:nth-child(10) { max-width: 400px; color: var(--text); }

  /* After table: fixed layout so colgroup widths are respected */
  .after-table { table-layout: fixed; }
  .after-table td { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .time-cell { color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .msg-cell { color: var(--text-bright) !important; }

  /* Severity pills */
  .sev-pill { font-weight: 700; text-align: center; padding: 2px 6px !important; border-radius: 3px; font-size: 11px; }
  .sev-pill.sev-err { color: var(--err); background: #f8514922; }
  .sev-pill.sev-wrn { color: var(--wrn); background: #e5a10022; }
  .sev-pill.sev-inf { color: var(--inf); }
  .sev-pill.sev-dbg { color: var(--dbg); }

  /* Row severity stripe */
  tr.sev-err { border-left: 3px solid var(--err); }
  tr.sev-wrn { border-left: 3px solid var(--wrn); }

  /* Stats bar */
  .stats { display: flex; gap: 24px; margin: 12px 0; flex-wrap: wrap; }
  .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; min-width: 140px; }
  .stat-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .stat-value { font-size: 18px; font-weight: 700; color: var(--text-bright); }
  .stat-detail { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
  .reduced { color: #3fb950; }

  /* Tabs */
  .tabs { display: flex; gap: 0; margin-bottom: 0; }
  .tab { padding: 10px 20px; cursor: pointer; border: 1px solid var(--border); border-bottom: none; border-radius: 8px 8px 0 0; background: var(--bg); color: var(--text-dim); font-size: 13px; font-weight: 600; transition: all 0.15s; }
  .tab:hover { color: var(--text); background: var(--surface); }
  .tab.active { background: var(--surface); color: var(--accent); border-color: var(--border); }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
</style>
</head>
<body>

<h1>Log Field Transformations</h1>
<p class="subtitle">${rows.length} total rows &middot; Showing all logs &middot; 5 field transforms applied</p>

<div class="stats">
  <div class="stat">
    <div class="stat-label">Columns</div>
    <div class="stat-value">${allCols.length} &rarr; ${afterCols.length}</div>
    <div class="stat-detail">${allCols.length - afterCols.length} columns hidden</div>
  </div>
  <div class="stat">
    <div class="stat-label">Fields Transformed</div>
    <div class="stat-value">${Object.keys(TRANSFORMS).length}</div>
    <div class="stat-detail">time, severity, message, activityId, pod</div>
  </div>
  <div class="stat">
    <div class="stat-label">Avg Chars/Row</div>
    <div class="stat-value stat-before-chars"></div>
    <div class="stat-detail stat-savings-detail"></div>
  </div>
</div>

<div class="tabs">
  <div class="tab active" onclick="switchTab('after')">After (Transformed)</div>
  <div class="tab" onclick="switchTab('before')">Before (Raw)</div>
</div>

<div id="tab-after" class="tab-content active">
  <div class="section">
    <div class="table-wrap" style="max-height: 80vh; overflow-y: auto;">
      ${buildAfterTable(rows)}
    </div>
  </div>
</div>

<div id="tab-before" class="tab-content">
  <div class="section">
    <div class="table-wrap" style="max-height: 80vh; overflow-y: auto;">
      ${buildBeforeTable(rows)}
    </div>
  </div>
</div>

<script>
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', (name === 'after' && i === 0) || (name === 'before' && i === 1));
  });
  document.getElementById('tab-after').classList.toggle('active', name === 'after');
  document.getElementById('tab-before').classList.toggle('active', name === 'before');
}
</script>

</body>
</html>`;

const outPath = 'D:\\git\\taskdock\\scripts\\log-transform-preview.html';
writeFileSync(outPath, page, 'utf-8');
console.log('Written to:', outPath);
console.log('Rows:', rows.length);
