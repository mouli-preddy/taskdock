/**
 * App Paths - Cross-platform helper for app directories
 * For Tauri application with Node.js backend sidecar
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Get app data directory path
 */
export function getAppDataPath(): string {
  const appName = 'taskdock';
  let appDataPath: string;

  switch (process.platform) {
    case 'win32':
      appDataPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
      break;
    case 'darwin':
      appDataPath = path.join(os.homedir(), 'Library', 'Application Support', appName);
      break;
    default:
      appDataPath = path.join(os.homedir(), '.config', appName);
  }

  // Ensure directory exists
  if (!fs.existsSync(appDataPath)) {
    fs.mkdirSync(appDataPath, { recursive: true });
  }

  return appDataPath;
}

/**
 * Get temp directory path
 */
export function getTempPath(): string {
  return os.tmpdir();
}

/**
 * Get home directory path
 */
export function getHomePath(): string {
  return os.homedir();
}

export const appPaths = {
  userData: getAppDataPath,
  temp: getTempPath,
  home: getHomePath,
};
