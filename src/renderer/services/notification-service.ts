import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import type { NotificationSettings } from '../../shared/types.js';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../shared/types.js';

export type NotificationEvent =
  | 'aiReviewComplete'
  | 'aiAnalysisComplete'
  | 'newComments'
  | 'newIterations'
  | 'taskComplete';

class NotificationService {
  private settings: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
  private permissionGranted: boolean | null = null;

  updateSettings(settings: NotificationSettings): void {
    this.settings = settings;
  }

  getSettings(): NotificationSettings {
    return { ...this.settings };
  }

  async notify(event: NotificationEvent, title: string, body: string): Promise<void> {
    if (!this.settings.enabled) return;
    if (!this.settings[event]) return;

    // Cache permission check to avoid repeated calls
    if (this.permissionGranted === null) {
      this.permissionGranted = await isPermissionGranted();
      if (!this.permissionGranted) {
        const result = await requestPermission();
        this.permissionGranted = result === 'granted';
      }
    }

    if (!this.permissionGranted) return;

    try {
      sendNotification({ title, body });
    } catch (err) {
      console.error('Failed to send notification:', err);
    }
  }

  async sendTest(): Promise<void> {
    if (this.permissionGranted === null) {
      this.permissionGranted = await isPermissionGranted();
      if (!this.permissionGranted) {
        const result = await requestPermission();
        this.permissionGranted = result === 'granted';
      }
    }
    if (!this.permissionGranted) return;

    try {
      sendNotification({ title: 'TaskDock', body: 'This is a test notification.' });
    } catch (err) {
      console.error('Failed to send test notification:', err);
    }
  }

  async loadSettings(): Promise<void> {
    try {
      this.settings = await window.electronAPI.getNotificationSettings();
    } catch {
      // Settings not yet saved — use defaults
      this.settings = { ...DEFAULT_NOTIFICATION_SETTINGS };
    }
  }
}

export const notificationService = new NotificationService();
