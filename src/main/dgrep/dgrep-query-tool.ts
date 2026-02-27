/**
 * DGrep Query Tool Generator
 * Produces a self-contained ESM script (query-logs.mjs) that the AI agent
 * can run via Bash to search and slice CSV log data.
 *
 * The tool is intentionally dumb — it just filters and slices.
 * The agent does all the analysis and decides what to search for.
 */

export function getQueryToolSource(): string {
  return `#!/usr/bin/env node
// query-logs.mjs — CSV-aware grep for log analysis
// Usage:
//   node query-logs.mjs "pattern"                  Search rows matching regex
//   node query-logs.mjs "pattern" --count           Just show match count
//   node query-logs.mjs "pattern" --limit 20        Limit output rows
//   node query-logs.mjs --rows 100-110              Get row range
//   node query-logs.mjs --row 105 --context 5       Get rows around row 105

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, 'data.csv');

// ==================== CSV Parser ====================
// Handles quoted fields with embedded commas, newlines, and escaped quotes.

function parseCSV(text) {
  const rows = [];
  let headers = null;
  let pos = 0;
  const len = text.length;

  while (pos < len) {
    const fields = [];
    // Parse one row (may span multiple lines if fields are quoted)
    while (pos < len) {
      if (text[pos] === '"') {
        // Quoted field
        pos++; // skip opening quote
        let value = '';
        while (pos < len) {
          if (text[pos] === '"') {
            if (pos + 1 < len && text[pos + 1] === '"') {
              value += '"';
              pos += 2;
            } else {
              pos++; // skip closing quote
              break;
            }
          } else {
            value += text[pos];
            pos++;
          }
        }
        fields.push(value);
        // Skip comma or newline after quoted field
        if (pos < len && text[pos] === ',') pos++;
        else if (pos < len && (text[pos] === '\\n' || text[pos] === '\\r')) {
          if (text[pos] === '\\r' && pos + 1 < len && text[pos + 1] === '\\n') pos += 2;
          else pos++;
          break; // end of row
        }
      } else {
        // Unquoted field
        let value = '';
        while (pos < len && text[pos] !== ',' && text[pos] !== '\\n' && text[pos] !== '\\r') {
          value += text[pos];
          pos++;
        }
        fields.push(value);
        if (pos < len && text[pos] === ',') {
          pos++;
        } else {
          if (text[pos] === '\\r' && pos + 1 < len && text[pos + 1] === '\\n') pos += 2;
          else if (pos < len) pos++;
          break; // end of row
        }
      }
    }

    if (fields.length === 0 || (fields.length === 1 && fields[0] === '')) continue;

    if (!headers) {
      headers = fields;
    } else {
      const row = {};
      for (let i = 0; i < headers.length; i++) {
        row[headers[i]] = fields[i] || '';
      }
      row._rowIndex = rows.length;
      rows.push(row);
    }
  }

  return { headers: headers || [], rows };
}

// ==================== Output Formatting ====================

function formatRow(row, headers) {
  const lines = ['--- Row ' + row._rowIndex + ' ---'];
  for (const h of headers) {
    const val = row[h];
    if (val === undefined || val === '') continue;
    // Truncate very long values for readability but keep Message full
    if (h.toLowerCase() === 'message' || h.toLowerCase() === 'msg' || h.toLowerCase() === 'description') {
      lines.push(h + ': ' + val);
    } else if (val.length > 200) {
      lines.push(h + ': ' + val.substring(0, 200) + '...');
    } else {
      lines.push(h + ': ' + val);
    }
  }
  return lines.join('\\n');
}

// ==================== Main ====================

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(\`Usage:
  node query-logs.mjs "pattern"                  Search rows matching regex (case-insensitive)
  node query-logs.mjs "pattern" --count          Just show match count
  node query-logs.mjs "pattern" --limit N        Limit output to N rows (default: 50)
  node query-logs.mjs --rows 100-110             Get rows in range
  node query-logs.mjs --row 105 --context 5      Get N rows before and after row 105
  node query-logs.mjs --head N                   Show first N rows (default: 5)\`);
    return;
  }

  // Parse arguments
  let pattern = null;
  let countOnly = false;
  let limit = 50;
  let rowRange = null;   // { start, end }
  let contextRow = null; // { row, context }
  let headN = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--count') {
      countOnly = true;
    } else if (arg === '--limit' && i + 1 < args.length) {
      limit = parseInt(args[++i], 10) || 50;
    } else if (arg === '--rows' && i + 1 < args.length) {
      const parts = args[++i].split('-');
      rowRange = { start: parseInt(parts[0], 10), end: parseInt(parts[1] || parts[0], 10) };
    } else if (arg === '--row' && i + 1 < args.length) {
      contextRow = { row: parseInt(args[++i], 10), context: 5 };
    } else if (arg === '--context' && i + 1 < args.length) {
      if (contextRow) contextRow.context = parseInt(args[++i], 10) || 5;
    } else if (arg === '--head') {
      headN = parseInt(args[i + 1], 10) || 5;
      if (args[i + 1] && !args[i + 1].startsWith('-')) i++;
    } else if (!arg.startsWith('-')) {
      pattern = arg;
    }
  }

  // Read and parse CSV
  let text;
  try {
    text = readFileSync(CSV_PATH, 'utf-8');
  } catch (e) {
    console.error('Error: Cannot read data.csv in ' + __dirname);
    process.exit(1);
  }

  const { headers, rows } = parseCSV(text);

  // Mode 1: Head — show first N rows
  if (headN !== null) {
    const end = Math.min(headN, rows.length);
    console.log('Columns: ' + headers.join(', '));
    console.log('Total rows: ' + rows.length);
    console.log('');
    for (let i = 0; i < end; i++) {
      console.log(formatRow(rows[i], headers));
      console.log('');
    }
    return;
  }

  // Mode 2: Row range
  if (rowRange) {
    const start = Math.max(0, rowRange.start);
    const end = Math.min(rows.length - 1, rowRange.end);
    for (let i = start; i <= end; i++) {
      console.log(formatRow(rows[i], headers));
      console.log('');
    }
    console.log('Showing rows ' + start + '-' + end + ' (of ' + rows.length + ' total)');
    return;
  }

  // Mode 3: Context around a row
  if (contextRow) {
    const r = contextRow.row;
    const c = contextRow.context;
    const start = Math.max(0, r - c);
    const end = Math.min(rows.length - 1, r + c);
    for (let i = start; i <= end; i++) {
      const marker = i === r ? ' <<<< TARGET' : '';
      console.log(formatRow(rows[i], headers) + marker);
      console.log('');
    }
    console.log('Showing rows ' + start + '-' + end + ' (context ' + c + ' around row ' + r + ')');
    return;
  }

  // Mode 4: Regex search
  if (pattern) {
    let regex;
    try {
      regex = new RegExp(pattern, 'i');
    } catch (e) {
      // Fall back to literal match if regex is invalid
      regex = new RegExp(pattern.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\\\$&'), 'i');
    }

    const matches = [];
    for (const row of rows) {
      // Search across all column values
      let found = false;
      for (const h of headers) {
        if (regex.test(row[h] || '')) {
          found = true;
          break;
        }
      }
      if (found) matches.push(row);
    }

    if (countOnly) {
      console.log('Found ' + matches.length + ' matching rows (of ' + rows.length + ' total)');
      return;
    }

    const showing = matches.slice(0, limit);
    for (const row of showing) {
      console.log(formatRow(row, headers));
      console.log('');
    }
    const moreMsg = matches.length > limit ? ' (showing first ' + limit + ', use --limit to see more)' : '';
    console.log('Found ' + matches.length + ' matching rows (of ' + rows.length + ' total)' + moreMsg);
    return;
  }

  // No mode matched — show help
  console.log('Total rows: ' + rows.length);
  console.log('Columns: ' + headers.join(', '));
  console.log('Use --help for usage.');
}

main();
`;
}
