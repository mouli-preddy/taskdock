import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { invoke } from '@tauri-apps/api/core';

interface DeepLinkReviewAction {
  action: 'review';
  org: string;
  project: string;
  prId: number;
}

type DeepLinkAction = DeepLinkReviewAction;

interface DeepLinkTarget {
  openPRByUrl(org: string, project: string, prId: number): Promise<void>;
  switchSection(section: string): void;
}

function parseDeepLink(url: string): DeepLinkAction | null {
  try {
    // URL format: taskdock://review/{org}/{project}/{prId}
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);

    if (parsed.protocol !== 'taskdock:') return null;

    // parsed.hostname is the first segment after taskdock://
    // So taskdock://review/org/proj/123 → hostname="review", pathname="/org/proj/123"
    const action = parsed.hostname;

    if (action === 'review' && segments.length === 3) {
      const prId = Number(segments[2]);
      if (isNaN(prId)) return null;
      return {
        action: 'review',
        org: segments[0],
        project: segments[1],
        prId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function dispatch(target: DeepLinkTarget, action: DeepLinkAction) {
  if (action.action === 'review') {
    target.switchSection('review');
    target.openPRByUrl(action.org, action.project, action.prId).catch(e => {
      console.error('[deep-link] Failed to open PR:', e);
    });
  }
}

export async function initDeepLinkHandler(target: DeepLinkTarget) {
  // Warm start: listen for deep-link events (works cross-platform with
  // single-instance "deep-link" feature)
  await onOpenUrl((urls: string[]) => {
    for (const url of urls) {
      console.log('[deep-link] Received URL:', url);
      const action = parseDeepLink(url);
      if (action) {
        dispatch(target, action);
      }
    }
  });

  // Cold start: check if app was launched via protocol URL
  try {
    const initialUrl = await invoke<string | null>('get_initial_deep_link');
    if (initialUrl) {
      console.log('[deep-link] Initial URL:', initialUrl);
      const action = parseDeepLink(initialUrl);
      if (action) {
        dispatch(target, action);
      }
    }
  } catch (e) {
    console.warn('[deep-link] Failed to get initial deep link:', e);
  }
}
