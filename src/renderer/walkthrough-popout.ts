/**
 * Walkthrough Popout Window
 * Separate entry point for the popped-out walkthrough window.
 * Receives data from the main window via Tauri events.
 */

import type { CodeWalkthrough, WalkthroughStep, WalkthroughPreset } from '../shared/ai-types.js';
import { renderStepHtml, renderSummaryHtml, renderMarkdownInContainer } from './components/walkthrough-renderer.js';
import { initializeMermaid } from './utils/markdown-renderer.js';
import { escapeHtml } from './utils/html-utils.js';
import {
  iconHtml,
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock,
} from './utils/icons.js';
import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './styles/walkthrough-popout.css';

interface PopoutData {
  walkthrough: CodeWalkthrough;
  currentStep: number;
  displayName?: string;
  preset?: WalkthroughPreset;
  customPrompt?: string;
}

let walkthrough: CodeWalkthrough | null = null;
let currentStep = 0;
let displayName = 'Code Walkthrough';

const root = document.getElementById('walkthroughPopoutRoot')!;

function getTotalPages(): number {
  return 1 + (walkthrough?.steps.length || 0);
}

function getCurrentStepObj(): WalkthroughStep | null {
  if (!walkthrough || currentStep === 0) return null;
  return walkthrough.steps[currentStep - 1] || null;
}

function render(): void {
  if (!walkthrough) {
    root.innerHTML = '<div class="popout-loading">Waiting for walkthrough data...</div>';
    return;
  }

  const totalPages = getTotalPages();
  const step = getCurrentStepObj();
  const progress = totalPages > 0 ? ((currentStep + 1) / totalPages) * 100 : 0;

  const stepIndicatorText = currentStep === 0
    ? 'Overview'
    : `Step ${currentStep} of ${walkthrough.steps.length}`;

  root.innerHTML = `
    <div class="popout-header">
      <div class="popout-title">
        ${iconHtml(Bot, { size: 18, class: 'robot-icon' })}
        <span>${escapeHtml(displayName)}</span>
      </div>
      <button class="btn btn-secondary btn-sm popout-pop-back-btn" title="Return to main window">
        Pop back in
      </button>
    </div>

    <div class="walkthrough-progress">
      <div class="walkthrough-progress-bar" style="width: ${progress}%"></div>
    </div>

    <div class="walkthrough-meta">
      <span class="walkthrough-step-indicator">${stepIndicatorText}</span>
      <span class="walkthrough-time">
        ${iconHtml(Clock, { size: 12 })}
        ~${walkthrough.estimatedReadTime || Math.max(1, Math.ceil(walkthrough.steps.length * 0.5))} min read
      </span>
    </div>

    <div class="walkthrough-content">
      ${step ? renderStepHtml(step) : renderSummaryHtml(walkthrough)}
    </div>

    <div class="walkthrough-nav">
      <button class="btn btn-secondary walkthrough-prev-btn" ${currentStep === 0 ? 'disabled' : ''}>
        ${iconHtml(ChevronLeft, { size: 16 })}
        Previous
      </button>
      <div class="walkthrough-step-dots">
        <button class="step-dot ${currentStep === 0 ? 'active' : ''}" data-step="0" title="Overview"></button>
        ${walkthrough.steps.map((_, i) => `
          <button class="step-dot ${(i + 1) === currentStep ? 'active' : ''}"
                  data-step="${i + 1}"
                  title="Step ${i + 1}">
          </button>
        `).join('')}
      </div>
      <button class="btn btn-primary walkthrough-next-btn" ${currentStep >= totalPages - 1 ? 'disabled' : ''}>
        Next
        ${iconHtml(ChevronRight, { size: 16 })}
      </button>
    </div>

    <div class="walkthrough-keyboard-hint">
      <kbd>←</kbd> <kbd>→</kbd> or <kbd>n</kbd> <kbd>p</kbd> to navigate
    </div>
  `;

  attachEventListeners();
  renderMarkdownInContainer(root);
}

function navigateToStep(): void {
  const step = getCurrentStepObj();
  if (step) {
    emit('walkthrough:navigate', { filePath: step.filePath, line: step.startLine });
  }
}

/** Sync current step back to main window so state saves correctly */
function syncStep(): void {
  emit('walkthrough:step-changed', { currentStep });
}

function nextStep(): void {
  if (!walkthrough) return;
  const totalPages = getTotalPages();
  if (currentStep < totalPages - 1) {
    currentStep++;
    render();
    navigateToStep();
    syncStep();
  }
}

function previousStep(): void {
  if (currentStep > 0) {
    currentStep--;
    render();
    if (currentStep > 0) {
      navigateToStep();
    }
    syncStep();
  }
}

function goToStep(pageNumber: number): void {
  if (!walkthrough) return;
  const totalPages = getTotalPages();
  if (pageNumber >= 0 && pageNumber < totalPages) {
    currentStep = pageNumber;
    render();
    if (currentStep > 0) {
      navigateToStep();
    }
    syncStep();
  }
}

function attachEventListeners(): void {
  // Pop back in button
  root.querySelector('.popout-pop-back-btn')?.addEventListener('click', () => {
    emit('walkthrough:pop-back', { currentStep });
  });

  // Navigation buttons
  root.querySelectorAll('.walkthrough-prev-btn').forEach(btn => {
    btn.addEventListener('click', () => previousStep());
  });

  root.querySelectorAll('.walkthrough-next-btn').forEach(btn => {
    btn.addEventListener('click', () => nextStep());
  });

  // Step dots
  root.querySelectorAll('.step-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const step = parseInt((dot as HTMLElement).dataset.step || '0');
      goToStep(step);
    });
  });

  // Location click - navigate to file
  root.querySelector('.walkthrough-step-location')?.addEventListener('click', () => {
    navigateToStep();
  });

  // Related file clicks
  root.querySelectorAll('.walkthrough-related-file').forEach(el => {
    el.addEventListener('click', () => {
      const file = (el as HTMLElement).dataset.file;
      if (file) {
        emit('walkthrough:navigate', { filePath: file, line: 1 });
      }
    });
  });
}

// Keyboard navigation
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  if (e.key === 'ArrowRight' || e.key === 'n') {
    nextStep();
  } else if (e.key === 'ArrowLeft' || e.key === 'p') {
    previousStep();
  }
});

// Initialize
async function init(): Promise<void> {
  initializeMermaid();
  render(); // Show loading state

  // Listen for walkthrough data from main window
  await listen<PopoutData>('walkthrough:popout-data', (event) => {
    walkthrough = event.payload.walkthrough;
    currentStep = event.payload.currentStep;
    displayName = event.payload.displayName || 'Code Walkthrough';

    // Update window title
    getCurrentWindow().setTitle(displayName).catch(console.error);

    render();
  });

  // Listen for close command from main window
  await listen('walkthrough:close-popout', () => {
    getCurrentWindow().close().catch(console.error);
  });

  // Signal to main window that we're ready to receive data
  await emit('walkthrough:popout-ready', {});
}

init().catch(console.error);
