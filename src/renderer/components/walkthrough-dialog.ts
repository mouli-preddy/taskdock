/**
 * Walkthrough Dialog
 * Modal dialog for requesting standalone walkthroughs with preset support
 */

import type { AIProviderType, WalkthroughPreset } from '../../shared/ai-types.js';
import { BUILT_IN_WALKTHROUGH_PRESETS } from '../../shared/ai-types.js';
import { escapeHtml } from '../utils/html-utils.js';
import { Toast } from './toast.js';
import { iconHtml, FileText, X, Edit, Trash2, Save } from '../utils/icons.js';

export interface WalkthroughDialogResult {
  provider: AIProviderType;
  showTerminal: boolean;
  preset?: WalkthroughPreset;
  customPrompt?: string;
  displayName: string;
}

export interface WalkthroughDialogOptions {
  presets: WalkthroughPreset[];
  availableProviders: { provider: AIProviderType; available: boolean; error?: string }[];
}

interface ProviderInfo {
  value: AIProviderType;
  label: string;
  available: boolean;
  error?: string;
}

/**
 * Show the walkthrough dialog and return the user's selections
 * @param options Dialog options including presets and available providers
 * @returns The user's walkthrough configuration or null if cancelled
 */
export async function showWalkthroughDialog(options: WalkthroughDialogOptions): Promise<WalkthroughDialogResult | null> {
  return new Promise((resolve) => {
    // Combine built-in and user presets
    const allPresets = [...BUILT_IN_WALKTHROUGH_PRESETS, ...options.presets];
    const userPresets = options.presets.filter(p => !p.isBuiltIn);
    const builtInPresets = BUILT_IN_WALKTHROUGH_PRESETS;

    // Helper to get provider availability info
    function getProviderStatus(provider: AIProviderType): { available: boolean; error?: string } {
      const info = options.availableProviders.find(p => p.provider === provider);
      return { available: info?.available ?? false, error: info?.error };
    }

    // Map providers to display info
    const providerInfos: ProviderInfo[] = [
      { value: 'claude-terminal', label: 'Claude Terminal', ...getProviderStatus('claude-terminal') },
      { value: 'claude-sdk', label: 'Claude API', ...getProviderStatus('claude-sdk') },
      { value: 'copilot-terminal', label: 'Copilot Terminal', ...getProviderStatus('copilot-terminal') },
      { value: 'copilot-sdk', label: 'GitHub Copilot API', ...getProviderStatus('copilot-sdk') },
    ];

    // Find first available provider
    const defaultProvider = providerInfos.find(p => p.available)?.value ?? 'claude-terminal';

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-overlay walkthrough-dialog-overlay';

    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'dialog walkthrough-dialog';
    dialog.innerHTML = `
      <div class="dialog-header">
        <h2>
          ${iconHtml(FileText, { size: 20, class: 'walkthrough-icon' })}
          Request Walkthrough
        </h2>
        <button class="btn btn-icon dialog-close-btn" aria-label="Close">
          ${iconHtml(X, { size: 20 })}
        </button>
      </div>
      <div class="dialog-body">
        <!-- Preset Selection -->
        <div class="form-group">
          <label for="walkthroughPresetSelect">Preset</label>
          <select id="walkthroughPresetSelect">
            <option value="">Custom Walkthrough</option>
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
          <label for="walkthroughProviderSelect">AI Provider</label>
          <select id="walkthroughProviderSelect">
            ${providerInfos.map(p => `
              <option value="${p.value}" ${!p.available ? 'disabled' : ''} ${p.value === defaultProvider ? 'selected' : ''}>
                ${escapeHtml(p.label)}${!p.available ? ' (unavailable)' : ''}
              </option>
            `).join('')}
          </select>
          <span class="form-hint provider-error" id="providerError" style="color: var(--error);"></span>
        </div>

        <!-- Show Terminal (only visible for Claude Terminal) -->
        <div class="form-group" id="showTerminalGroup" style="display: none;">
          <label class="checkbox-label inline">
            <input type="checkbox" id="showTerminalCheck" checked>
            <span>Show Terminal</span>
          </label>
          <span class="form-hint">Display the terminal while the walkthrough generates</span>
        </div>

        <!-- Custom Prompt -->
        <div class="form-group">
          <label for="walkthroughCustomPrompt">Additional Instructions</label>
          <textarea id="walkthroughCustomPrompt" rows="3" placeholder="Optional: Add specific instructions for the walkthrough..."></textarea>
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
          <button class="btn btn-primary start-btn">Generate Walkthrough</button>
        </div>
      </div>
    `;

    // Append to DOM
    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);

    // Get element references
    const presetSelect = dialog.querySelector('#walkthroughPresetSelect') as HTMLSelectElement;
    const presetDescription = dialog.querySelector('#presetDescription') as HTMLElement;
    const providerSelect = dialog.querySelector('#walkthroughProviderSelect') as HTMLSelectElement;
    const providerError = dialog.querySelector('#providerError') as HTMLElement;
    const showTerminalGroup = dialog.querySelector('#showTerminalGroup') as HTMLElement;
    const showTerminalCheck = dialog.querySelector('#showTerminalCheck') as HTMLInputElement;
    const customPromptTextarea = dialog.querySelector('#walkthroughCustomPrompt') as HTMLTextAreaElement;
    const presetActions = dialog.querySelector('#presetActions') as HTMLElement;
    const editPresetBtn = dialog.querySelector('#editPresetBtn') as HTMLButtonElement;
    const deletePresetBtn = dialog.querySelector('#deletePresetBtn') as HTMLButtonElement;
    const savePresetBtn = dialog.querySelector('#savePresetBtn') as HTMLButtonElement;
    const closeBtn = dialog.querySelector('.dialog-close-btn') as HTMLButtonElement;
    const cancelBtn = dialog.querySelector('.cancel-btn') as HTMLButtonElement;
    const startBtn = dialog.querySelector('.start-btn') as HTMLButtonElement;

    // Track selected preset
    let selectedPreset: WalkthroughPreset | undefined;

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

        // Update custom prompt
        customPromptTextarea.value = selectedPreset.customPrompt || '';

        // Show preset actions only for user presets
        presetActions.style.display = selectedPreset.isBuiltIn ? 'none' : 'flex';
      } else {
        // Custom walkthrough - clear to defaults
        presetDescription.textContent = '';
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
     * Generate display name from preset or custom prompt
     */
    const generateDisplayName = (): string => {
      if (selectedPreset) {
        return selectedPreset.name;
      }
      const prompt = customPromptTextarea.value.trim();
      if (prompt) {
        const truncated = prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;
        return `Custom: ${truncated}`;
      }
      return 'Custom Walkthrough';
    };

    /**
     * Get current form values
     */
    const getCurrentValues = (): WalkthroughDialogResult => {
      const provider = providerSelect.value as AIProviderType;
      const showTerminal = showTerminalCheck.checked;
      const customPrompt = customPromptTextarea.value.trim() || undefined;

      return {
        provider,
        showTerminal,
        preset: selectedPreset,
        customPrompt,
        displayName: generateDisplayName(),
      };
    };

    /**
     * Handle start button click
     */
    const handleStart = () => {
      const values = getCurrentValues();

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
      const preset: Omit<WalkthroughPreset, 'id'> & { id?: string } = {
        name: name.trim(),
        description: values.customPrompt ? `Custom: ${values.customPrompt.substring(0, 50)}...` : 'Custom walkthrough preset',
        customPrompt: values.customPrompt,
        isBuiltIn: false,
        createdAt: new Date().toISOString(),
      };

      try {
        const savedPreset = await window.electronAPI.presetsSaveWalkthroughPreset(preset);
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
        customPrompt: values.customPrompt,
        updatedAt: new Date().toISOString(),
      };

      try {
        const updatedPreset = await window.electronAPI.presetsUpdateWalkthroughPreset(selectedPreset.id, updates);
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
        await window.electronAPI.presetsDeleteWalkthroughPreset(selectedPreset.id);
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

        // Reset to custom walkthrough
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
  /* Walkthrough Dialog Overlay */
  .walkthrough-dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1000;
    animation: fadeIn 0.15s ease;
  }

  /* Walkthrough Dialog */
  .walkthrough-dialog {
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

  .walkthrough-dialog .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color);
  }

  .walkthrough-dialog .dialog-header h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .walkthrough-dialog .dialog-header .walkthrough-icon {
    color: var(--accent-color);
  }

  .walkthrough-dialog .dialog-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .walkthrough-dialog .dialog-close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .walkthrough-dialog .dialog-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .walkthrough-dialog .form-group {
    margin-bottom: 16px;
  }

  .walkthrough-dialog .form-group:last-child {
    margin-bottom: 0;
  }

  .walkthrough-dialog .form-group > label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 6px;
    color: var(--text-primary);
  }

  .walkthrough-dialog .form-hint {
    display: block;
    font-size: 11px;
    color: var(--text-tertiary);
    margin-top: 4px;
  }

  .walkthrough-dialog select,
  .walkthrough-dialog textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
  }

  .walkthrough-dialog select:focus,
  .walkthrough-dialog textarea:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px var(--accent-color-alpha, rgba(0, 120, 212, 0.2));
  }

  .walkthrough-dialog textarea {
    resize: vertical;
    min-height: 60px;
  }

  .walkthrough-dialog select option:disabled {
    color: var(--text-tertiary);
  }

  .walkthrough-dialog .checkbox-label {
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

  .walkthrough-dialog .checkbox-label:hover {
    border-color: var(--accent-color);
  }

  .walkthrough-dialog .checkbox-label.inline {
    background: transparent;
    border: none;
    padding: 0;
  }

  .walkthrough-dialog .checkbox-label.inline:hover {
    border-color: transparent;
  }

  .walkthrough-dialog .checkbox-label input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent-color);
  }

  /* Preset Actions */
  .walkthrough-dialog .preset-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .walkthrough-dialog .preset-actions .btn {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* Dialog Footer */
  .walkthrough-dialog .dialog-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-top: 1px solid var(--border-color);
    background: var(--bg-primary);
    border-radius: 0 0 12px 12px;
  }

  .walkthrough-dialog .dialog-actions {
    display: flex;
    gap: 10px;
  }

  .walkthrough-dialog #savePresetBtn {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Button sizes */
  .walkthrough-dialog .btn-sm {
    padding: 6px 10px;
    font-size: 12px;
  }

  .walkthrough-dialog .btn-danger {
    background: var(--error, #d13438);
    border-color: var(--error, #d13438);
    color: white;
  }

  .walkthrough-dialog .btn-danger:hover {
    background: #b82d30;
    border-color: #b82d30;
  }
`;
document.head.appendChild(style);
