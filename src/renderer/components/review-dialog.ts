/**
 * Review Dialog
 * Modal dialog for starting new AI reviews with preset support
 */

import type { AIProviderType, ReviewPreset } from '../../shared/ai-types.js';
import { BUILT_IN_REVIEW_PRESETS } from '../../shared/ai-types.js';
import { escapeHtml } from '../utils/html-utils.js';
import { Toast } from './toast.js';
import { iconHtml, Bot, X, Edit, Trash2, Save } from '../utils/icons.js';

export interface ReviewDialogResult {
  provider: AIProviderType;
  depth: 'quick' | 'standard' | 'thorough';
  focusAreas: ('security' | 'performance' | 'bugs' | 'style')[];
  generateWalkthrough: boolean;
  showTerminal: boolean;
  preset?: ReviewPreset;
  customPrompt?: string;
}

export interface ReviewDialogOptions {
  presets: ReviewPreset[];
  availableProviders: { provider: AIProviderType; available: boolean; error?: string }[];
}

interface ProviderInfo {
  value: AIProviderType;
  label: string;
  available: boolean;
  error?: string;
}

/**
 * Show the review dialog and return the user's selections
 * @param options Dialog options including presets and available providers
 * @returns The user's review configuration or null if cancelled
 */
export async function showReviewDialog(options: ReviewDialogOptions): Promise<ReviewDialogResult | null> {
  return new Promise((resolve) => {
    // Combine built-in and user presets
    const allPresets = [...BUILT_IN_REVIEW_PRESETS, ...options.presets];
    const userPresets = options.presets.filter(p => !p.isBuiltIn);
    const builtInPresets = BUILT_IN_REVIEW_PRESETS;

    // Map providers to display info
    const providerInfos: ProviderInfo[] = [
      {
        value: 'claude-terminal',
        label: 'Claude Terminal',
        available: options.availableProviders.find(p => p.provider === 'claude-terminal')?.available ?? false,
        error: options.availableProviders.find(p => p.provider === 'claude-terminal')?.error
      },
      {
        value: 'claude-sdk',
        label: 'Claude API',
        available: options.availableProviders.find(p => p.provider === 'claude-sdk')?.available ?? false,
        error: options.availableProviders.find(p => p.provider === 'claude-sdk')?.error
      },
      {
        value: 'copilot-terminal',
        label: 'Copilot Terminal',
        available: options.availableProviders.find(p => p.provider === 'copilot-terminal')?.available ?? false,
        error: options.availableProviders.find(p => p.provider === 'copilot-terminal')?.error
      },
      {
        value: 'copilot-sdk',
        label: 'GitHub Copilot API',
        available: options.availableProviders.find(p => p.provider === 'copilot-sdk')?.available ?? false,
        error: options.availableProviders.find(p => p.provider === 'copilot-sdk')?.error
      },
    ];

    // Find first available provider
    const defaultProvider = providerInfos.find(p => p.available)?.value ?? 'copilot-sdk';

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-overlay review-dialog-overlay';

    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'dialog review-dialog';
    dialog.innerHTML = `
      <div class="dialog-header">
        <h2>
          ${iconHtml(Bot, { size: 20, class: 'robot-icon' })}
          Start AI Review
        </h2>
        <button class="btn btn-icon dialog-close-btn" aria-label="Close">
          ${iconHtml(X, { size: 20 })}
        </button>
      </div>
      <div class="dialog-body">
        <!-- Preset Selection -->
        <div class="form-group">
          <label for="reviewPresetSelect">Preset</label>
          <select id="reviewPresetSelect">
            <option value="">Custom Review</option>
            ${builtInPresets.length > 0 ? `
              <optgroup label="Built-in Presets">
                ${builtInPresets.map(p => `
                  <option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>
                `).join('')}
              </optgroup>
            ` : ''}
            ${userPresets.length > 0 ? `
              <optgroup label="Your Presets">
                ${userPresets.map(p => `
                  <option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>
                `).join('')}
              </optgroup>
            ` : ''}
          </select>
          <span class="form-hint preset-description" id="presetDescription"></span>
        </div>

        <!-- Provider Selection -->
        <div class="form-group">
          <label for="reviewProviderSelect">AI Provider</label>
          <select id="reviewProviderSelect">
            ${providerInfos.map(p => `
              <option value="${p.value}" ${!p.available ? 'disabled' : ''} ${p.value === defaultProvider ? 'selected' : ''}>
                ${escapeHtml(p.label)}${!p.available ? ' (unavailable)' : ''}
              </option>
            `).join('')}
          </select>
          <span class="form-hint provider-error" id="providerError" style="color: var(--error);"></span>
        </div>

        <!-- Review Depth -->
        <div class="form-group">
          <label for="reviewDepthSelect">Review Depth</label>
          <select id="reviewDepthSelect">
            <option value="quick">Quick - Critical issues only</option>
            <option value="standard" selected>Standard - Bugs, security, performance</option>
            <option value="thorough">Thorough - Full review with best practices</option>
          </select>
        </div>

        <!-- Focus Areas -->
        <div class="form-group">
          <label>Focus Areas</label>
          <div class="focus-areas-grid">
            <label class="checkbox-label">
              <input type="checkbox" name="focusArea" value="security" checked>
              <span>Security</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" name="focusArea" value="performance" checked>
              <span>Performance</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" name="focusArea" value="bugs" checked>
              <span>Bugs</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" name="focusArea" value="style" checked>
              <span>Style</span>
            </label>
          </div>
        </div>

        <!-- Generate Walkthrough -->
        <div class="form-group">
          <label class="checkbox-label inline">
            <input type="checkbox" id="generateWalkthroughCheck" checked>
            <span>Generate code walkthrough</span>
          </label>
        </div>

        <!-- Show Terminal (only visible for Claude Terminal) -->
        <div class="form-group" id="showTerminalGroup" style="display: none;">
          <label class="checkbox-label inline">
            <input type="checkbox" id="showTerminalCheck" checked>
            <span>Show Terminal</span>
          </label>
          <span class="form-hint">Display the terminal while the review runs</span>
        </div>

        <!-- Custom Prompt -->
        <div class="form-group">
          <label for="reviewCustomPrompt">Additional Instructions</label>
          <textarea id="reviewCustomPrompt" rows="3" placeholder="Optional: Add specific instructions or focus areas..."></textarea>
        </div>

        <!-- Preset Management (when user preset selected) -->
        <div class="preset-actions" id="presetActions" style="display: none;">
          <button class="btn btn-secondary btn-sm" id="editPresetBtn">
            ${iconHtml(Edit, { size: 14 })}
            Edit Preset
          </button>
          <button class="btn btn-danger btn-sm" id="deletePresetBtn">
            ${iconHtml(Trash2, { size: 14 })}
            Delete Preset
          </button>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn btn-secondary" id="savePresetBtn">
          ${iconHtml(Save, { size: 14 })}
          Save as Preset
        </button>
        <div class="dialog-actions">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary start-btn">Start Review</button>
        </div>
      </div>
    `;

    // Append to DOM
    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);

    // Get element references
    const presetSelect = dialog.querySelector('#reviewPresetSelect') as HTMLSelectElement;
    const presetDescription = dialog.querySelector('#presetDescription') as HTMLElement;
    const providerSelect = dialog.querySelector('#reviewProviderSelect') as HTMLSelectElement;
    const providerError = dialog.querySelector('#providerError') as HTMLElement;
    const depthSelect = dialog.querySelector('#reviewDepthSelect') as HTMLSelectElement;
    const focusAreaCheckboxes = dialog.querySelectorAll('input[name="focusArea"]') as NodeListOf<HTMLInputElement>;
    const generateWalkthroughCheck = dialog.querySelector('#generateWalkthroughCheck') as HTMLInputElement;
    const showTerminalGroup = dialog.querySelector('#showTerminalGroup') as HTMLElement;
    const showTerminalCheck = dialog.querySelector('#showTerminalCheck') as HTMLInputElement;
    const customPromptTextarea = dialog.querySelector('#reviewCustomPrompt') as HTMLTextAreaElement;
    const presetActions = dialog.querySelector('#presetActions') as HTMLElement;
    const editPresetBtn = dialog.querySelector('#editPresetBtn') as HTMLButtonElement;
    const deletePresetBtn = dialog.querySelector('#deletePresetBtn') as HTMLButtonElement;
    const savePresetBtn = dialog.querySelector('#savePresetBtn') as HTMLButtonElement;
    const closeBtn = dialog.querySelector('.dialog-close-btn') as HTMLButtonElement;
    const cancelBtn = dialog.querySelector('.cancel-btn') as HTMLButtonElement;
    const startBtn = dialog.querySelector('.start-btn') as HTMLButtonElement;

    // Track selected preset
    let selectedPreset: ReviewPreset | undefined;

    /**
     * Close the dialog and cleanup
     */
    const closeDialog = () => {
      backdrop.remove();
      dialog.remove();
      document.removeEventListener('keydown', handleKeydown);
    };

    /**
     * Handle keyboard events
     */
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDialog();
        resolve(null);
      } else if (e.key === 'Enter' && !e.shiftKey && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handleStart();
      }
    };

    /**
     * Update UI based on selected preset
     */
    const updatePresetUI = () => {
      const presetId = presetSelect.value;
      selectedPreset = allPresets.find(p => p.id === presetId);

      if (selectedPreset) {
        // Update description
        presetDescription.textContent = selectedPreset.description || '';

        // Update focus areas
        focusAreaCheckboxes.forEach(cb => {
          cb.checked = selectedPreset!.focusAreas.includes(cb.value as any);
        });

        // Update custom prompt
        customPromptTextarea.value = selectedPreset.customPrompt || '';

        // Show preset actions only for user presets
        presetActions.style.display = selectedPreset.isBuiltIn ? 'none' : 'flex';
      } else {
        // Custom review - clear to defaults
        presetDescription.textContent = '';
        focusAreaCheckboxes.forEach(cb => cb.checked = true);
        customPromptTextarea.value = '';
        presetActions.style.display = 'none';
      }
    };

    /**
     * Update show terminal visibility based on provider
     */
    const updateShowTerminalVisibility = () => {
      const isTerminalProvider = providerSelect.value === 'claude-terminal' || providerSelect.value === 'copilot-terminal';
      showTerminalGroup.style.display = isTerminalProvider ? 'block' : 'none';

      // Show provider error if selected provider is unavailable
      const selectedProviderInfo = providerInfos.find(p => p.value === providerSelect.value);
      if (selectedProviderInfo && !selectedProviderInfo.available && selectedProviderInfo.error) {
        providerError.textContent = selectedProviderInfo.error;
      } else {
        providerError.textContent = '';
      }
    };

    /**
     * Get current form values
     */
    const getCurrentValues = (): ReviewDialogResult => {
      const provider = providerSelect.value as AIProviderType;
      const depth = depthSelect.value as 'quick' | 'standard' | 'thorough';
      const focusAreas = Array.from(focusAreaCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value as 'security' | 'performance' | 'bugs' | 'style');
      const generateWalkthrough = generateWalkthroughCheck.checked;
      const showTerminal = showTerminalCheck.checked;
      const customPrompt = customPromptTextarea.value.trim() || undefined;

      return {
        provider,
        depth,
        focusAreas,
        generateWalkthrough,
        showTerminal,
        preset: selectedPreset,
        customPrompt,
      };
    };

    /**
     * Handle start button click
     */
    const handleStart = () => {
      const values = getCurrentValues();

      // Validate at least one focus area is selected
      if (values.focusAreas.length === 0) {
        Toast.warning('Please select at least one focus area');
        return;
      }

      // Validate provider is available
      const selectedProviderInfo = providerInfos.find(p => p.value === values.provider);
      if (selectedProviderInfo && !selectedProviderInfo.available) {
        Toast.error(`${selectedProviderInfo.label} is not available`);
        return;
      }

      closeDialog();
      resolve(values);
    };

    /**
     * Handle save as preset
     */
    const handleSaveAsPreset = async () => {
      const name = prompt('Enter a name for this preset:');
      if (!name || !name.trim()) return;

      const values = getCurrentValues();
      const preset: Omit<ReviewPreset, 'id'> & { id?: string } = {
        name: name.trim(),
        description: `Custom preset: ${values.focusAreas.join(', ')}`,
        focusAreas: values.focusAreas,
        customPrompt: values.customPrompt,
        isBuiltIn: false,
        createdAt: new Date().toISOString(),
      };

      try {
        const savedPreset = await window.electronAPI.presetsSaveReviewPreset(preset);
        Toast.success(`Preset "${name}" saved`);

        // Add to user presets and update dropdown
        options.presets.push(savedPreset);

        // Refresh the preset dropdown
        const optgroup = presetSelect.querySelector('optgroup[label="Your Presets"]');
        if (optgroup) {
          const option = document.createElement('option');
          option.value = savedPreset.id;
          option.textContent = savedPreset.name;
          optgroup.appendChild(option);
        } else {
          // Create the optgroup if it doesn't exist
          const newOptgroup = document.createElement('optgroup');
          newOptgroup.label = 'Your Presets';
          const option = document.createElement('option');
          option.value = savedPreset.id;
          option.textContent = savedPreset.name;
          newOptgroup.appendChild(option);
          presetSelect.appendChild(newOptgroup);
        }

        // Select the new preset
        presetSelect.value = savedPreset.id;
        selectedPreset = savedPreset;
        updatePresetUI();
      } catch (error: any) {
        Toast.error(error.message || 'Failed to save preset');
      }
    };

    /**
     * Handle edit preset
     */
    const handleEditPreset = async () => {
      if (!selectedPreset || selectedPreset.isBuiltIn) return;

      const newName = prompt('Enter a new name for this preset:', selectedPreset.name);
      if (!newName || !newName.trim()) return;

      const values = getCurrentValues();
      const updates = {
        name: newName.trim(),
        focusAreas: values.focusAreas,
        customPrompt: values.customPrompt,
        updatedAt: new Date().toISOString(),
      };

      try {
        const updatedPreset = await window.electronAPI.presetsUpdateReviewPreset(selectedPreset.id, updates);
        Toast.success('Preset updated');

        // Update in options
        const index = options.presets.findIndex(p => p.id === selectedPreset!.id);
        if (index >= 0) {
          options.presets[index] = updatedPreset;
        }

        // Update dropdown option text
        const option = presetSelect.querySelector(`option[value="${selectedPreset.id}"]`) as HTMLOptionElement;
        if (option) {
          option.textContent = updatedPreset.name;
        }

        selectedPreset = updatedPreset;
        updatePresetUI();
      } catch (error: any) {
        Toast.error(error.message || 'Failed to update preset');
      }
    };

    /**
     * Handle delete preset
     */
    const handleDeletePreset = async () => {
      if (!selectedPreset || selectedPreset.isBuiltIn) return;

      const confirmed = confirm(`Are you sure you want to delete the preset "${selectedPreset.name}"?`);
      if (!confirmed) return;

      try {
        await window.electronAPI.presetsDeleteReviewPreset(selectedPreset.id);
        Toast.success('Preset deleted');

        // Remove from options
        const index = options.presets.findIndex(p => p.id === selectedPreset!.id);
        if (index >= 0) {
          options.presets.splice(index, 1);
        }

        // Remove from dropdown
        const option = presetSelect.querySelector(`option[value="${selectedPreset.id}"]`);
        if (option) {
          option.remove();
        }

        // Reset to custom review
        presetSelect.value = '';
        selectedPreset = undefined;
        updatePresetUI();
      } catch (error: any) {
        Toast.error(error.message || 'Failed to delete preset');
      }
    };

    // Attach event listeners
    presetSelect.addEventListener('change', updatePresetUI);
    providerSelect.addEventListener('change', updateShowTerminalVisibility);
    closeBtn.addEventListener('click', () => {
      closeDialog();
      resolve(null);
    });
    cancelBtn.addEventListener('click', () => {
      closeDialog();
      resolve(null);
    });
    backdrop.addEventListener('click', () => {
      closeDialog();
      resolve(null);
    });
    startBtn.addEventListener('click', handleStart);
    savePresetBtn.addEventListener('click', handleSaveAsPreset);
    editPresetBtn.addEventListener('click', handleEditPreset);
    deletePresetBtn.addEventListener('click', handleDeletePreset);
    document.addEventListener('keydown', handleKeydown);

    // Prevent dialog clicks from closing
    dialog.addEventListener('click', (e) => e.stopPropagation());

    // Initialize UI
    updateShowTerminalVisibility();
    updatePresetUI();

    // Focus the preset select
    presetSelect.focus();
  });
}

// Add dialog styles
const style = document.createElement('style');
style.textContent = `
  /* Review Dialog Overlay */
  .review-dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1000;
    animation: fadeIn 0.15s ease;
  }

  /* Review Dialog */
  .review-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 480px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    background: var(--bg-secondary);
    border-radius: 12px;
    box-shadow: 0 16px 64px rgba(0, 0, 0, 0.4);
    border: 1px solid var(--border-color);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    animation: slideIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translate(-50%, -48%);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%);
    }
  }

  .review-dialog .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color);
  }

  .review-dialog .dialog-header h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .review-dialog .dialog-header .robot-icon {
    color: var(--accent-color);
  }

  .review-dialog .dialog-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .review-dialog .form-group {
    margin-bottom: 16px;
  }

  .review-dialog .form-group:last-child {
    margin-bottom: 0;
  }

  .review-dialog .form-group > label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 6px;
    color: var(--text-primary);
  }

  .review-dialog .form-hint {
    display: block;
    font-size: 11px;
    color: var(--text-tertiary);
    margin-top: 4px;
  }

  .review-dialog select,
  .review-dialog textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
  }

  .review-dialog select:focus,
  .review-dialog textarea:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px var(--accent-color-alpha, rgba(0, 120, 212, 0.2));
  }

  .review-dialog textarea {
    resize: vertical;
    min-height: 60px;
  }

  .review-dialog select option:disabled {
    color: var(--text-tertiary);
  }

  /* Focus Areas Grid */
  .review-dialog .focus-areas-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .review-dialog .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s ease;
  }

  .review-dialog .checkbox-label:hover {
    border-color: var(--accent-color);
  }

  .review-dialog .checkbox-label.inline {
    background: transparent;
    border: none;
    padding: 0;
  }

  .review-dialog .checkbox-label.inline:hover {
    border-color: transparent;
  }

  .review-dialog .checkbox-label input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent-color);
  }

  /* Preset Actions */
  .review-dialog .preset-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .review-dialog .preset-actions .btn {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* Dialog Footer */
  .review-dialog .dialog-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-top: 1px solid var(--border-color);
    background: var(--bg-primary);
    border-radius: 0 0 12px 12px;
  }

  .review-dialog .dialog-actions {
    display: flex;
    gap: 10px;
  }

  .review-dialog #savePresetBtn {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Button sizes */
  .review-dialog .btn-sm {
    padding: 6px 10px;
    font-size: 12px;
  }

  .review-dialog .btn-danger {
    background: var(--error, #d13438);
    border-color: var(--error, #d13438);
    color: white;
  }

  .review-dialog .btn-danger:hover {
    background: #b82d30;
    border-color: #b82d30;
  }
`;
document.head.appendChild(style);
