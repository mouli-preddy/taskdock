#!/usr/bin/env node
// Builds the Node.js backend sidecar binary for the current architecture.
import { execSync } from 'child_process';
import { renameSync } from 'fs';
import { arch } from 'os';

const hostArch = arch();

const pkgTarget = hostArch === 'arm64' ? 'node20-win-arm64' : 'node20-win-x64';
const triple = hostArch === 'arm64'
  ? 'aarch64-pc-windows-msvc'
  : 'x86_64-pc-windows-msvc';

console.log(`Building sidecar for ${triple} (${pkgTarget})...`);

execSync(
  `npx pkg dist/sidecar/bridge.cjs --config pkg.config.json --targets ${pkgTarget} --output src-tauri/binaries/backend`,
  { stdio: 'inherit' }
);

renameSync(
  'src-tauri/binaries/backend.exe',
  `src-tauri/binaries/backend-${triple}.exe`
);

console.log(`Sidecar built: src-tauri/binaries/backend-${triple}.exe`);
