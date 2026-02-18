import { EventEmitter } from 'node:events';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CfvClient } from './cfv-client.js';
import { CfvTokenService } from './cfv-token-service.js';
import type { AcquireTokenOptions, TokenProgress } from './cfv-token-service.js';
import type { CfvClientOptions, FetchProgress, FetchResult, CallFlowData, CallDetailsData } from './cfv-types.js';
import type { CfvCallSummary } from '../../shared/cfv-types.js';

const DEFAULT_OUTPUT_BASE = join(
  process.env.LOCALAPPDATA || join(process.env.HOME || '', 'AppData', 'Local'),
  'BrainBot',
  'cfv_calls'
);

const TOKEN_FILE = join(
  process.env.LOCALAPPDATA || join(process.env.HOME || '', 'AppData', 'Local'),
  'BrainBot',
  'cfv_tokens.json'
);

export class CfvService extends EventEmitter {
  private client: CfvClient | null = null;
  private token: string = '';
  private outputBase: string;
  private tokenService: CfvTokenService | null = null;

  constructor(outputBase?: string) {
    super();
    this.outputBase = outputBase ?? DEFAULT_OUTPUT_BASE;
    this.loadTokenFromDisk();
  }

  private loadTokenFromDisk(): void {
    try {
      const { readFileSync } = require('node:fs');
      const data = JSON.parse(readFileSync(TOKEN_FILE, 'utf-8'));
      if (data.token) {
        this.token = data.token;
        this.client = new CfvClient({ token: this.token, outputBase: this.outputBase });
      }
    } catch {
      // No saved token
    }
  }

  async setToken(token: string): Promise<void> {
    this.token = token;
    this.client = new CfvClient({ token, outputBase: this.outputBase });

    // Persist token
    const { mkdir, writeFile } = require('node:fs/promises');
    const { dirname } = require('node:path');
    await mkdir(dirname(TOKEN_FILE), { recursive: true });
    await writeFile(TOKEN_FILE, JSON.stringify({ token, updatedAt: new Date().toISOString() }), 'utf-8');
  }

  async getTokenStatus(): Promise<{ valid: boolean; hasToken: boolean }> {
    if (!this.token || !this.client) {
      return { valid: false, hasToken: false };
    }
    const valid = await this.client.validateToken();
    return { valid, hasToken: true };
  }

  async fetchCall(callId: string): Promise<FetchResult> {
    if (!this.client) {
      throw new Error('No token set. Please set a CFV token first.');
    }

    const result = await this.client.fetchCall(callId, (progress: FetchProgress) => {
      this.emit('progress', { callId, ...progress });
    });

    return result;
  }

  async listCachedCalls(): Promise<CfvCallSummary[]> {
    const calls: CfvCallSummary[] = [];
    try {
      const dirs = await readdir(this.outputBase);
      for (const dir of dirs) {
        try {
          const metadataPath = join(this.outputBase, dir, 'metadata.toon');
          const metaStat = await stat(metadataPath);
          if (!metaStat.isFile()) continue;

          const content = await readFile(metadataPath, 'utf-8');
          // metadata.toon is TOON format but the first few fields are parseable
          // For simplicity, read the raw JSON files to get stats
          const rawDir = join(this.outputBase, dir, 'raw');
          let messageCount = 0;
          let diagnosticFiles = 0;

          try {
            const callFlowPath = join(rawDir, 'callFlow.json');
            const cfData = JSON.parse(await readFile(callFlowPath, 'utf-8'));
            const messages = cfData?.nrtStreamingIndexAugmentedCall?.fullCallFlow?.messages;
            messageCount = Array.isArray(messages) ? messages.length : 0;
          } catch { /* no callflow data */ }

          try {
            const diagDir = join(this.outputBase, dir, 'diagnostics');
            const diagFiles = await readdir(diagDir);
            diagnosticFiles = diagFiles.filter(f => f.endsWith('.toon')).length;
          } catch { /* no diagnostics */ }

          // Get fetch time from directory stat
          const dirStat = await stat(join(this.outputBase, dir));
          calls.push({
            callId: dir,
            fetchedAt: dirStat.mtime.toISOString(),
            outputDir: join(this.outputBase, dir),
            messageCount,
            diagnosticFiles,
          });
        } catch {
          // Skip invalid directories
        }
      }
    } catch {
      // Output directory doesn't exist yet
    }

    // Sort by most recent first
    calls.sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());
    return calls;
  }

  async getCallFlowData(callId: string): Promise<CallFlowData | null> {
    try {
      const filePath = join(this.outputBase, callId, 'raw', 'callFlow.json');
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as CallFlowData;
    } catch {
      return null;
    }
  }

  async getCallDetailsData(callId: string): Promise<CallDetailsData | null> {
    try {
      const filePath = join(this.outputBase, callId, 'raw', 'callDetails.json');
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as CallDetailsData;
    } catch {
      return null;
    }
  }

  async getRawFile(callId: string, filename: string): Promise<string | null> {
    try {
      // Sanitize filename to prevent path traversal
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '');
      const filePath = join(this.outputBase, callId, 'raw', safeName);
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  getCallOutputDir(callId: string): string {
    return join(this.outputBase, callId);
  }

  async deleteCall(callId: string): Promise<void> {
    // Sanitize callId to prevent path traversal
    const safeId = callId.replace(/[^a-zA-Z0-9-]/g, '');
    const callDir = join(this.outputBase, safeId);
    await rm(callDir, { recursive: true, force: true });
  }

  async acquireToken(options?: AcquireTokenOptions): Promise<void> {
    if (!this.tokenService) {
      this.tokenService = new CfvTokenService();
      this.tokenService.on('progress', (progress: TokenProgress) => {
        this.emit('token-progress', progress);
      });
    }

    const token = await this.tokenService.acquireToken(options);
    if (token) {
      await this.setToken(token);
      this.emit('token-result', { success: true, tokenLength: token.length });
    } else {
      this.emit('token-result', { success: false, error: 'Token acquisition failed' });
    }
  }

  cancelTokenAcquisition(): void {
    this.tokenService?.cancel();
  }

  async checkPlaywrightAvailability(): Promise<{ available: boolean; reason?: string }> {
    const svc = new CfvTokenService();
    return svc.checkAvailability();
  }

  dispose(): void {
    this.tokenService?.cancel();
    this.tokenService?.removeAllListeners();
    this.tokenService = null;
    this.removeAllListeners();
    this.client = null;
  }
}

// Singleton pattern
let instance: CfvService | null = null;

export function getCfvService(): CfvService {
  if (!instance) {
    instance = new CfvService();
  }
  return instance;
}

export function disposeCfvService(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
