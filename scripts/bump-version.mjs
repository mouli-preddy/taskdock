#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run version:bump <version>  (e.g. 0.0.8)');
  process.exit(1);
}

const files = [
  { path: 'package.json',                 pattern: /"version": "[\d.]+"/, replacement: `"version": "${version}"` },
  { path: 'src-tauri/tauri.conf.json',    pattern: /"version": "[\d.]+"/, replacement: `"version": "${version}"` },
  { path: 'src-tauri/Cargo.toml',         pattern: /^version = "[\d.]+"/m, replacement: `version = "${version}"` },
];

for (const { path, pattern, replacement } of files) {
  const content = readFileSync(path, 'utf-8');
  const updated = content.replace(pattern, replacement);
  if (updated === content) { console.warn(`  [skip] ${path} — pattern not found`); continue; }
  writeFileSync(path, updated);
  console.log(`  [ok]   ${path}`);
}

console.log(`\nBumped to ${version}. Next: git commit + npm run publish-release`);
