#!/usr/bin/env node
// Builds the Node.js backend sidecar binary for the current architecture.
import { execSync } from 'child_process';
import { renameSync, unlinkSync } from 'fs';
import { arch } from 'os';

const hostArch = arch();

const pkgTarget = hostArch === 'arm64' ? 'node20-win-arm64' : 'node20-win-x64';
const nodePtyExternal = hostArch === 'arm64'
  ? '@lydell/node-pty-win32-arm64'
  : '@lydell/node-pty-win32-x64';
const triple = hostArch === 'arm64'
  ? 'aarch64-pc-windows-msvc'
  : 'x86_64-pc-windows-msvc';

console.log(`Building sidecar for ${triple} (${pkgTarget})...`);

// Re-bundle with the correct platform-specific node-pty external
execSync(
  `npx esbuild src-backend/bridge.ts --bundle --platform=node --target=node20 --outfile=dist/sidecar/bridge.cjs --format=cjs --external:@lydell/node-pty --external:${nodePtyExternal} --external:playwright-core`,
  { stdio: 'inherit' }
);

execSync(
  `npx pkg dist/sidecar/bridge.cjs --config pkg.config.json --targets ${pkgTarget} --output src-tauri/binaries/backend`,
  { stdio: 'inherit' }
);

const dest = `src-tauri/binaries/backend-${triple}.exe`;
try { unlinkSync(dest); } catch {}
renameSync('src-tauri/binaries/backend.exe', dest);

console.log(`Sidecar built: src-tauri/binaries/backend-${triple}.exe`);
