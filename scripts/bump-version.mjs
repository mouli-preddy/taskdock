#!/usr/bin/env node
// Usage: node scripts/bump-version.mjs 0.0.6
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('Usage: node scripts/bump-version.mjs <semver>  e.g. 0.0.6');
  process.exit(1);
}

// package.json
const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`package.json       → ${newVersion}`);

// src-tauri/tauri.conf.json
const tauriPath = resolve(root, 'src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriPath, 'utf8'));
tauriConf.version = newVersion;
writeFileSync(tauriPath, JSON.stringify(tauriConf, null, 2) + '\n');
console.log(`tauri.conf.json    → ${newVersion}`);

// src-tauri/Cargo.toml — regex replacement to preserve formatting
const cargoPath = resolve(root, 'src-tauri/Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8');
const updated = cargo.replace(/^(version\s*=\s*)"[^"]*"/m, `$1"${newVersion}"`);
writeFileSync(cargoPath, updated);
console.log(`Cargo.toml         → ${newVersion}`);

console.log(`\nDone! Next steps:`);
console.log(`  git add src-tauri/tauri.conf.json src-tauri/Cargo.toml package.json`);
console.log(`  git commit -m "chore: bump version to ${newVersion}"`);
console.log(`  git tag v${newVersion}`);
console.log(`  git push && git push --tags`);
console.log(`\nGitHub Actions will build and publish the release automatically.`);
