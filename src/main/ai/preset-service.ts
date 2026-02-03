/**
 * Preset Service
 * Manages built-in and user-created presets for reviews and walkthroughs
 */

import { getAppDataPath } from '../utils/app-paths.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ReviewPreset, WalkthroughPreset } from '../../shared/ai-types.js';
import {
  BUILT_IN_REVIEW_PRESETS,
  BUILT_IN_WALKTHROUGH_PRESETS,
} from '../../shared/ai-types.js';

interface PresetsFile<T> {
  version: number;
  presets: T[];
}

class PresetService {
  private getPresetsDir(): string {
    return path.join(getAppDataPath(), 'presets');
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.getPresetsDir(), { recursive: true });
  }

  private getReviewPresetsPath(): string {
    return path.join(this.getPresetsDir(), 'review-presets.json');
  }

  private getWalkthroughPresetsPath(): string {
    return path.join(this.getPresetsDir(), 'walkthrough-presets.json');
  }

  // ==================== Review Presets ====================

  async getReviewPresets(): Promise<ReviewPreset[]> {
    const userPresets = await this.loadUserReviewPresets();
    return [...BUILT_IN_REVIEW_PRESETS, ...userPresets];
  }

  private async loadUserReviewPresets(): Promise<ReviewPreset[]> {
    try {
      const content = await fs.readFile(this.getReviewPresetsPath(), 'utf-8');
      const data = JSON.parse(content) as PresetsFile<ReviewPreset>;
      return data.presets || [];
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async saveUserReviewPresets(presets: ReviewPreset[]): Promise<void> {
    await this.ensureDir();
    const data: PresetsFile<ReviewPreset> = { version: 1, presets };
    await fs.writeFile(this.getReviewPresetsPath(), JSON.stringify(data, null, 2), 'utf-8');
  }

  async saveReviewPreset(preset: Omit<ReviewPreset, 'id' | 'isBuiltIn' | 'createdAt'>): Promise<ReviewPreset> {
    const userPresets = await this.loadUserReviewPresets();
    const now = new Date().toISOString();
    const newPreset: ReviewPreset = {
      ...preset,
      id: `user-${uuidv4()}`,
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now,
    };
    userPresets.push(newPreset);
    await this.saveUserReviewPresets(userPresets);
    return newPreset;
  }

  async updateReviewPreset(id: string, updates: Partial<ReviewPreset>): Promise<ReviewPreset | null> {
    const userPresets = await this.loadUserReviewPresets();
    const index = userPresets.findIndex(p => p.id === id);
    if (index === -1) return null;

    userPresets[index] = {
      ...userPresets[index],
      ...updates,
      id, // Preserve ID
      isBuiltIn: false, // Ensure it stays user preset
      updatedAt: new Date().toISOString(),
    };
    await this.saveUserReviewPresets(userPresets);
    return userPresets[index];
  }

  async deleteReviewPreset(id: string): Promise<boolean> {
    const userPresets = await this.loadUserReviewPresets();
    const filtered = userPresets.filter(p => p.id !== id);
    if (filtered.length === userPresets.length) return false;
    await this.saveUserReviewPresets(filtered);
    return true;
  }

  // ==================== Walkthrough Presets ====================

  async getWalkthroughPresets(): Promise<WalkthroughPreset[]> {
    const userPresets = await this.loadUserWalkthroughPresets();
    return [...BUILT_IN_WALKTHROUGH_PRESETS, ...userPresets];
  }

  private async loadUserWalkthroughPresets(): Promise<WalkthroughPreset[]> {
    try {
      const content = await fs.readFile(this.getWalkthroughPresetsPath(), 'utf-8');
      const data = JSON.parse(content) as PresetsFile<WalkthroughPreset>;
      return data.presets || [];
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async saveUserWalkthroughPresets(presets: WalkthroughPreset[]): Promise<void> {
    await this.ensureDir();
    const data: PresetsFile<WalkthroughPreset> = { version: 1, presets };
    await fs.writeFile(this.getWalkthroughPresetsPath(), JSON.stringify(data, null, 2), 'utf-8');
  }

  async saveWalkthroughPreset(preset: Omit<WalkthroughPreset, 'id' | 'isBuiltIn' | 'createdAt'>): Promise<WalkthroughPreset> {
    const userPresets = await this.loadUserWalkthroughPresets();
    const now = new Date().toISOString();
    const newPreset: WalkthroughPreset = {
      ...preset,
      id: `user-${uuidv4()}`,
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now,
    };
    userPresets.push(newPreset);
    await this.saveUserWalkthroughPresets(userPresets);
    return newPreset;
  }

  async updateWalkthroughPreset(id: string, updates: Partial<WalkthroughPreset>): Promise<WalkthroughPreset | null> {
    const userPresets = await this.loadUserWalkthroughPresets();
    const index = userPresets.findIndex(p => p.id === id);
    if (index === -1) return null;

    userPresets[index] = {
      ...userPresets[index],
      ...updates,
      id,
      isBuiltIn: false,
      updatedAt: new Date().toISOString(),
    };
    await this.saveUserWalkthroughPresets(userPresets);
    return userPresets[index];
  }

  async deleteWalkthroughPreset(id: string): Promise<boolean> {
    const userPresets = await this.loadUserWalkthroughPresets();
    const filtered = userPresets.filter(p => p.id !== id);
    if (filtered.length === userPresets.length) return false;
    await this.saveUserWalkthroughPresets(filtered);
    return true;
  }
}

// Singleton
let presetServiceInstance: PresetService | null = null;

export function getPresetService(): PresetService {
  if (!presetServiceInstance) {
    presetServiceInstance = new PresetService();
  }
  return presetServiceInstance;
}
