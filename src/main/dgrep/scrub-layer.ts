/**
 * ScrubLayer — Transparent token-based data scrubbing for agent pipelines.
 * Replaces sensitive values (GUIDs, emails, etc.) with short tokens like scrub_g1,
 * and restores them on agent output. O(1) bidirectional lookup via dual Maps.
 */

import fs from 'fs';
import path from 'path';

export interface ScrubPattern {
  name: string;
  letter: string;
  regex: RegExp;
}

interface TokenMapFile {
  version: number;
  patterns: Record<string, { letter: string; regex: string }>;
  mappings: Array<{ value: string; token: string }>;
}

const TOKEN_MAP_FILENAME = 'token-map.json';

export class ScrubLayer {
  private valueToToken = new Map<string, string>();
  private tokenToValue = new Map<string, string>();
  private counters = new Map<string, number>();
  private patterns: ScrubPattern[] = [];
  private scrubRegex: RegExp | null = null;
  private static readonly UNSCRUB_REGEX = /\bscrub_[a-z]\d+\b/g;

  /** Register a pattern type. Letter must be a single lowercase character. */
  addPattern(name: string, letter: string, regex: RegExp): void {
    if (letter.length !== 1 || !/^[a-z]$/.test(letter)) {
      throw new Error(`Pattern letter must be a single lowercase char, got "${letter}"`);
    }
    if (this.patterns.some(p => p.letter === letter)) {
      throw new Error(`Pattern letter "${letter}" already registered`);
    }
    this.patterns.push({ name, letter, regex });
    if (!this.counters.has(letter)) this.counters.set(letter, 0);
    this.rebuildScrubRegex();
  }

  /** Rebuild the combined scrub regex from all registered patterns. */
  private rebuildScrubRegex(): void {
    if (this.patterns.length === 0) {
      this.scrubRegex = null;
      return;
    }
    const parts = this.patterns.map((p, i) => `(?<p${i}>${p.regex.source})`);
    this.scrubRegex = new RegExp(parts.join('|'), 'gi');
  }

  /** Get or create a token for a matched value. Normalizes to lowercase for case-insensitive dedup. */
  private getOrCreateToken(value: string, letter: string): string {
    const normalized = value.toLowerCase();
    const existing = this.valueToToken.get(normalized);
    if (existing) return existing;
    const count = (this.counters.get(letter) ?? 0) + 1;
    this.counters.set(letter, count);
    const token = `scrub_${letter}${count}`;
    this.valueToToken.set(normalized, token);
    this.tokenToValue.set(token, normalized);
    return token;
  }

  /** Replace all pattern matches in text with tokens. */
  scrubText(input: string): string {
    if (!this.scrubRegex || this.patterns.length === 0) return input;
    this.scrubRegex.lastIndex = 0;
    return input.replace(this.scrubRegex, (match, ...args) => {
      const groups = args[args.length - 1] as Record<string, string>;
      for (let i = 0; i < this.patterns.length; i++) {
        if (groups[`p${i}`] !== undefined) {
          return this.getOrCreateToken(match, this.patterns[i].letter);
        }
      }
      return match;
    });
  }

  /** Replace all tokens in text with original values. */
  unscrubText(input: string): string {
    return input.replace(ScrubLayer.UNSCRUB_REGEX, (token) => {
      return this.tokenToValue.get(token) ?? token;
    });
  }

  /** Number of stored mappings. */
  get size(): number {
    return this.valueToToken.size;
  }

  /**
   * Wrap a Claude Agent SDK tool handler — scrub response, unscrub args.
   */
  wrapSdkToolHandler<T>(
    handler: (args: T) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>
  ): (args: T) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    return async (args: T) => {
      const unscrubbed = JSON.parse(this.unscrubText(JSON.stringify(args))) as T;
      const result = await handler(unscrubbed);
      return {
        ...result,
        content: result.content.map(c =>
          c.type === 'text' ? { ...c, text: this.scrubText(c.text) } : c
        ),
      };
    };
  }

  /**
   * Wrap a Copilot SDK tool handler — scrub return, unscrub args.
   */
  wrapCopilotToolHandler(
    handler: (args: any) => Promise<string>
  ): (args: any) => Promise<string> {
    return async (args: any) => {
      const unscrubbed = JSON.parse(this.unscrubText(JSON.stringify(args)));
      const result = await handler(unscrubbed);
      return this.scrubText(result);
    };
  }

  /** Save token map to a workspace directory. Silently ignores write failures. */
  save(workspacePath: string): void {
    const data: TokenMapFile = {
      version: 1,
      patterns: {},
      mappings: [],
    };
    for (const p of this.patterns) {
      data.patterns[p.name] = { letter: p.letter, regex: p.regex.source };
    }
    for (const [value, token] of this.valueToToken) {
      data.mappings.push({ value, token });
    }
    try {
      fs.writeFileSync(
        path.join(workspacePath, TOKEN_MAP_FILENAME),
        JSON.stringify(data, null, 2),
        'utf-8'
      );
    } catch {
      // Best-effort persistence — don't crash on write failure
    }
  }

  /** Load token map from a workspace directory. Returns new ScrubLayer with defaults if file missing. */
  static load(workspacePath: string): ScrubLayer {
    const layer = new ScrubLayer();
    const filePath = path.join(workspacePath, TOKEN_MAP_FILENAME);
    if (!fs.existsSync(filePath)) {
      layer.addPattern('GUID', 'g', /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      return layer;
    }
    let data: TokenMapFile;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      // Corrupted file — fall back to defaults
      layer.addPattern('GUID', 'g', /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      return layer;
    }
    for (const [name, { letter, regex }] of Object.entries(data.patterns)) {
      layer.addPattern(name, letter, new RegExp(regex));
    }
    for (const { value, token } of data.mappings) {
      layer.valueToToken.set(value, token);
      layer.tokenToValue.set(token, value);
      const match = token.match(/^scrub_([a-z])(\d+)$/);
      if (match) {
        const [, letter, countStr] = match;
        const count = parseInt(countStr, 10);
        const current = layer.counters.get(letter) ?? 0;
        if (count > current) layer.counters.set(letter, count);
      }
    }
    return layer;
  }

  /** Create a new ScrubLayer with default GUID pattern. */
  static createDefault(): ScrubLayer {
    const layer = new ScrubLayer();
    layer.addPattern('GUID', 'g', /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    return layer;
  }
}
