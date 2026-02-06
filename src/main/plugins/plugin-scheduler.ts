// src/main/plugins/plugin-scheduler.ts
import { getLogger } from '../services/logger-service.js';
import type { LoadedPlugin, PollingTrigger, ScheduledTrigger } from '../../shared/plugin-types.js';

export interface SchedulerCallbacks {
  executeTrigger: (plugin: LoadedPlugin, triggerId: string, input?: any) => Promise<void>;
}

interface ActiveTimer {
  pluginId: string;
  triggerId: string;
  timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>;
  type: 'polling' | 'scheduled';
}

export class PluginScheduler {
  private activeTimers: Map<string, ActiveTimer> = new Map();
  private callbacks: SchedulerCallbacks;

  constructor(callbacks: SchedulerCallbacks) {
    this.callbacks = callbacks;
  }

  /** Start all polling and scheduled triggers for a plugin */
  startPlugin(plugin: LoadedPlugin): void {
    if (!plugin.enabled) return;

    for (const trigger of plugin.manifest.triggers) {
      if (trigger.type === 'polling') {
        this.startPolling(plugin, trigger);
      } else if (trigger.type === 'scheduled') {
        this.startScheduled(plugin, trigger);
      }
    }
  }

  /** Stop all triggers for a plugin */
  stopPlugin(pluginId: string): void {
    for (const [key, timer] of this.activeTimers) {
      if (timer.pluginId === pluginId) {
        clearInterval(timer.timer as any);
        clearTimeout(timer.timer as any);
        this.activeTimers.delete(key);
      }
    }
  }

  /** Stop all triggers */
  stopAll(): void {
    for (const [key, timer] of this.activeTimers) {
      clearInterval(timer.timer as any);
      clearTimeout(timer.timer as any);
    }
    this.activeTimers.clear();
  }

  private startPolling(plugin: LoadedPlugin, trigger: PollingTrigger): void {
    const logger = getLogger();
    const intervalMs = this.parseInterval(trigger.interval, plugin.config);
    if (intervalMs <= 0) {
      logger.warn('PluginScheduler', `Invalid polling interval for ${plugin.id}:${trigger.id}`);
      return;
    }

    const key = `${plugin.id}:${trigger.id}`;
    const timer = setInterval(async () => {
      try {
        await this.callbacks.executeTrigger(plugin, trigger.id);
      } catch (err: any) {
        logger.error('PluginScheduler', `Polling trigger failed: ${key}`, { error: err.message });
      }
    }, intervalMs);

    this.activeTimers.set(key, { pluginId: plugin.id, triggerId: trigger.id, timer, type: 'polling' });
    logger.info('PluginScheduler', `Started polling: ${key} every ${intervalMs}ms`);
  }

  private startScheduled(plugin: LoadedPlugin, trigger: ScheduledTrigger): void {
    const logger = getLogger();
    const key = `${plugin.id}:${trigger.id}`;

    // Simple cron implementation: check every minute if the cron matches
    const timer = setInterval(() => {
      if (this.cronMatches(trigger.cron)) {
        this.callbacks.executeTrigger(plugin, trigger.id).catch(err => {
          logger.error('PluginScheduler', `Scheduled trigger failed: ${key}`, { error: err.message });
        });
      }
    }, 60_000);

    this.activeTimers.set(key, { pluginId: plugin.id, triggerId: trigger.id, timer, type: 'scheduled' });
    logger.info('PluginScheduler', `Started scheduled: ${key} with cron "${trigger.cron}"`);
  }

  /** Parse interval string like "30s" or "{{config.pollInterval}}s" */
  private parseInterval(interval: string, config: Record<string, any>): number {
    // Replace config references
    let resolved = interval.replace(/\{\{config\.(\w+)\}\}/g, (_, key) => String(config[key] || '30'));

    // Parse number + unit
    const match = resolved.match(/^(\d+)(s|m|ms)?$/);
    if (!match) return 30_000; // Default 30 seconds
    const value = parseInt(match[1], 10);
    const unit = match[2] || 's';
    if (unit === 'ms') return value;
    if (unit === 'm') return value * 60_000;
    return value * 1000; // seconds
  }

  /** Simple cron matching (minute hour day month weekday) */
  private cronMatches(cron: string): boolean {
    const now = new Date();
    const parts = cron.split(/\s+/);
    if (parts.length < 5) return false;

    const [minute, hour, day, month, weekday] = parts;
    return (
      this.fieldMatches(minute, now.getMinutes()) &&
      this.fieldMatches(hour, now.getHours()) &&
      this.fieldMatches(day, now.getDate()) &&
      this.fieldMatches(month, now.getMonth() + 1) &&
      this.fieldMatchesWeekday(weekday, now.getDay())
    );
  }

  private fieldMatches(field: string, value: number): boolean {
    if (field === '*') return true;
    if (field.includes('-')) {
      const [min, max] = field.split('-').map(Number);
      return value >= min && value <= max;
    }
    if (field.includes(',')) {
      return field.split(',').map(Number).includes(value);
    }
    if (field.startsWith('*/')) {
      const step = parseInt(field.substring(2), 10);
      return value % step === 0;
    }
    return parseInt(field, 10) === value;
  }

  private fieldMatchesWeekday(field: string, value: number): boolean {
    if (field === '*') return true;
    if (field.includes('-')) {
      const [min, max] = field.split('-').map(Number);
      return value >= min && value <= max;
    }
    if (field.includes(',')) {
      return field.split(',').map(Number).includes(value);
    }
    const target = parseInt(field, 10);
    return target === value || (target === 7 && value === 0);
  }
}
