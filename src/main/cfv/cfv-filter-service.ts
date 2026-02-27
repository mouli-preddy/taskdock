import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { CallFilterState, FilterPreset } from '../../shared/cfv-filter-types.js';

const DEFAULT_OUTPUT_BASE = join(
  process.env.LOCALAPPDATA || join(process.env.HOME || '', 'AppData', 'Local'),
  'BrainBot',
  'cfv_calls'
);

const PRESETS_FILE = join(
  process.env.LOCALAPPDATA || join(process.env.HOME || '', 'AppData', 'Local'),
  'BrainBot',
  'cfv_filter_presets.json'
);

export class CfvFilterService {
  private outputBase: string;

  constructor(outputBase?: string) {
    this.outputBase = outputBase ?? DEFAULT_OUTPUT_BASE;
  }

  async saveCallFilters(callId: string, state: CallFilterState): Promise<void> {
    const safeId = callId.replace(/[^a-zA-Z0-9-]/g, '');
    const filePath = join(this.outputBase, safeId, 'filters.json');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  async loadCallFilters(callId: string): Promise<CallFilterState | null> {
    try {
      const safeId = callId.replace(/[^a-zA-Z0-9-]/g, '');
      const filePath = join(this.outputBase, safeId, 'filters.json');
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as CallFilterState;
    } catch {
      return null;
    }
  }

  async listFilterPresets(): Promise<FilterPreset[]> {
    try {
      const content = await readFile(PRESETS_FILE, 'utf-8');
      return JSON.parse(content) as FilterPreset[];
    } catch {
      return [];
    }
  }

  async saveFilterPreset(preset: FilterPreset): Promise<void> {
    const presets = await this.listFilterPresets();
    const idx = presets.findIndex(p => p.id === preset.id);
    if (idx >= 0) {
      presets[idx] = preset;
    } else {
      presets.push(preset);
    }
    await mkdir(dirname(PRESETS_FILE), { recursive: true });
    await writeFile(PRESETS_FILE, JSON.stringify(presets, null, 2), 'utf-8');
  }

  async deleteFilterPreset(presetId: string): Promise<void> {
    const presets = await this.listFilterPresets();
    const filtered = presets.filter(p => p.id !== presetId);
    await writeFile(PRESETS_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
  }
}

let instance: CfvFilterService | null = null;
export function getCfvFilterService(): CfvFilterService {
  if (!instance) instance = new CfvFilterService();
  return instance;
}
