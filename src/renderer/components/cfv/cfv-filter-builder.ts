import type { FilterCondition, FilterGroup, FilterRule, FilterField } from '../../../shared/cfv-filter-types.js';
import {
  FILTER_COLORS,
  FILTER_FIELDS,
  FILTER_CONDITION_TYPES,
  isFilterGroup,
  generateFilterId,
} from '../../../shared/cfv-filter-types.js';
import { SERVICE_COLUMNS } from '../../../shared/cfv-types.js';
import { escapeHtml } from '../../utils/html-utils.js';
import { getIcon, Plus, Trash2, X } from '../../utils/icons.js';

export interface FilterBuilderCallbacks {
  onApply: (rule: FilterRule) => void;
  onCancel: () => void;
}

type ConditionType = FilterCondition['type'];

const CONDITION_TYPE_LABELS: Record<ConditionType, string> = {
  'text-contains': 'Contains',
  'text-not-contains': 'Not Contains',
  'regex': 'Regex',
  'seq-range': 'Seq Range',
  'time-range': 'Time Range',
  'service': 'Service',
  'status': 'Status Code',
  'failure': 'Failures Only',
};

/**
 * CfvFilterBuilder renders a dropdown panel for creating/editing filter rules.
 * It supports recursive group building (AND/OR groups with nested conditions).
 * The panel appears as an overlay and is dismissed via Cancel, Apply, Escape, or backdrop click.
 */
export class CfvFilterBuilder {
  private container: HTMLElement;
  private callbacks: FilterBuilderCallbacks;
  private rule: FilterRule;
  private backdrop: HTMLElement | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(container: HTMLElement, rule: FilterRule, callbacks: FilterBuilderCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    // Deep clone the rule so we don't mutate the original
    this.rule = JSON.parse(JSON.stringify(rule));
    this.render();
    this.setupKeyboardHandler();
  }

  // ---------------------------------------------------------------------------
  // Tree traversal helpers
  // ---------------------------------------------------------------------------

  /**
   * Get the node (condition or group) at a given path within the root group.
   * Path is a number array, e.g. [1, 2] means root.conditions[1].conditions[2].
   */
  private getNodeAtPath(group: FilterGroup, path: number[]): FilterCondition | FilterGroup | null {
    if (path.length === 0) return group;
    let current: FilterCondition | FilterGroup = group;
    for (const idx of path) {
      if (!isFilterGroup(current)) return null;
      if (idx < 0 || idx >= current.conditions.length) return null;
      current = current.conditions[idx];
    }
    return current;
  }

  /**
   * Get the parent group and the index of the child at the given path.
   * Returns null if the path is empty (root has no parent) or invalid.
   */
  private getParentAndIndex(group: FilterGroup, path: number[]): { parent: FilterGroup; index: number } | null {
    if (path.length === 0) return null;
    const parentPath = path.slice(0, -1);
    const index = path[path.length - 1];
    const parent = this.getNodeAtPath(group, parentPath);
    if (!parent || !isFilterGroup(parent)) return null;
    return { parent, index };
  }

  /**
   * Update a node at the given path by replacing it with the result of the updater function.
   */
  private updateNodeAtPath(
    group: FilterGroup,
    path: number[],
    updater: (node: FilterCondition | FilterGroup) => FilterCondition | FilterGroup
  ): void {
    const info = this.getParentAndIndex(group, path);
    if (!info) return;
    const { parent, index } = info;
    if (index >= 0 && index < parent.conditions.length) {
      parent.conditions[index] = updater(parent.conditions[index]);
    }
  }

  /**
   * Remove the node at the given path from its parent group.
   */
  private removeNodeAtPath(group: FilterGroup, path: number[]): void {
    const info = this.getParentAndIndex(group, path);
    if (!info) return;
    const { parent, index } = info;
    if (index >= 0 && index < parent.conditions.length) {
      parent.conditions.splice(index, 1);
    }
  }

  /**
   * Add a condition or group to the group at the given path.
   */
  private addToGroupAtPath(group: FilterGroup, path: number[], node: FilterCondition | FilterGroup): void {
    const target = this.getNodeAtPath(group, path);
    if (target && isFilterGroup(target)) {
      target.conditions.push(node);
    }
  }

  // ---------------------------------------------------------------------------
  // Default condition factories
  // ---------------------------------------------------------------------------

  private createDefaultCondition(type: ConditionType): FilterCondition {
    switch (type) {
      case 'text-contains':
        return { type: 'text-contains', field: 'any', value: '' };
      case 'text-not-contains':
        return { type: 'text-not-contains', field: 'any', value: '' };
      case 'regex':
        return { type: 'regex', field: 'any', pattern: '' };
      case 'seq-range':
        return { type: 'seq-range', from: 0, to: 100 };
      case 'time-range':
        return { type: 'time-range', from: '', to: '' };
      case 'service':
        return { type: 'service', column: SERVICE_COLUMNS[0], direction: 'either' };
      case 'status':
        return { type: 'status', operator: 'gte', code: 400 };
      case 'failure':
        return { type: 'failure', failureOnly: true };
    }
  }

  private createDefaultGroup(): FilterGroup {
    return {
      operator: 'and',
      conditions: [{ type: 'text-contains', field: 'any', value: '' }],
    };
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private render(): void {
    this.container.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'cfv-filter-builder';

    // Header
    panel.appendChild(this.renderHeader());

    // Body - scrollable group tree
    const body = document.createElement('div');
    body.className = 'cfv-filter-builder-body';
    body.appendChild(this.renderGroup(this.rule.group, []));
    panel.appendChild(body);

    // Footer
    panel.appendChild(this.renderFooter());

    // Backdrop
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'cfv-filter-builder-backdrop';
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) {
        this.cancel();
      }
    });

    this.container.appendChild(this.backdrop);
    this.container.appendChild(panel);
  }

  private renderHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'cfv-filter-builder-header';

    // Row 1: Name input and close button
    const titleRow = document.createElement('div');
    titleRow.className = 'cfv-filter-builder-title-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'cfv-filter-builder-name-input';
    nameInput.placeholder = 'Rule name (optional)';
    nameInput.value = this.rule.name || '';
    nameInput.addEventListener('input', () => {
      this.rule.name = nameInput.value.trim() || undefined;
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-icon cfv-filter-builder-close';
    closeBtn.innerHTML = getIcon(X, 16);
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => this.cancel());

    titleRow.appendChild(nameInput);
    titleRow.appendChild(closeBtn);
    header.appendChild(titleRow);

    // Row 2: Color picker and mode toggle
    const optionsRow = document.createElement('div');
    optionsRow.className = 'cfv-filter-builder-options-row';

    // Color picker
    const colorPicker = document.createElement('div');
    colorPicker.className = 'cfv-filter-builder-color-picker';

    const colorLabel = document.createElement('span');
    colorLabel.className = 'cfv-filter-builder-label';
    colorLabel.textContent = 'Color';
    colorPicker.appendChild(colorLabel);

    const colorDots = document.createElement('div');
    colorDots.className = 'cfv-filter-builder-color-dots';
    for (const color of FILTER_COLORS) {
      const dot = document.createElement('button');
      dot.className = 'cfv-filter-builder-color-dot';
      if (this.rule.color === color) {
        dot.classList.add('selected');
      }
      dot.style.backgroundColor = color;
      dot.title = color;
      dot.addEventListener('click', () => {
        this.rule.color = color;
        this.render();
      });
      colorDots.appendChild(dot);
    }
    colorPicker.appendChild(colorDots);
    optionsRow.appendChild(colorPicker);

    // Mode toggle
    const modeToggle = document.createElement('div');
    modeToggle.className = 'cfv-filter-builder-mode-toggle';

    const modeLabel = document.createElement('span');
    modeLabel.className = 'cfv-filter-builder-label';
    modeLabel.textContent = 'Mode';
    modeToggle.appendChild(modeLabel);

    const markBtn = document.createElement('button');
    markBtn.className = 'cfv-filter-builder-mode-btn';
    if (this.rule.mode === 'mark') markBtn.classList.add('active');
    markBtn.textContent = 'Mark';
    markBtn.title = 'Highlight matching rows with color';
    markBtn.addEventListener('click', () => {
      this.rule.mode = 'mark';
      this.render();
    });

    const filterBtn = document.createElement('button');
    filterBtn.className = 'cfv-filter-builder-mode-btn';
    if (this.rule.mode === 'filter') filterBtn.classList.add('active');
    filterBtn.textContent = 'Filter';
    filterBtn.title = 'Show only matching rows';
    filterBtn.addEventListener('click', () => {
      this.rule.mode = 'filter';
      this.render();
    });

    modeToggle.appendChild(markBtn);
    modeToggle.appendChild(filterBtn);
    optionsRow.appendChild(modeToggle);

    header.appendChild(optionsRow);

    return header;
  }

  private renderFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'cfv-filter-builder-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary cfv-filter-builder-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.cancel());

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary cfv-filter-builder-apply-btn';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', () => this.apply());

    footer.appendChild(cancelBtn);
    footer.appendChild(applyBtn);

    return footer;
  }

  // ---------------------------------------------------------------------------
  // Recursive group rendering
  // ---------------------------------------------------------------------------

  private renderGroup(group: FilterGroup, path: number[]): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cfv-filter-builder-group';
    if (path.length > 0) {
      el.classList.add('cfv-filter-builder-group-nested');
    }

    // Group header: operator toggle, negate, add condition, add group, remove group
    const groupHeader = document.createElement('div');
    groupHeader.className = 'cfv-filter-builder-group-header';

    // Operator button (AND/OR toggle)
    const operatorBtn = document.createElement('button');
    operatorBtn.className = 'cfv-filter-builder-operator-btn';
    operatorBtn.textContent = group.operator.toUpperCase();
    operatorBtn.title = `Click to toggle between AND/OR (currently: ${group.operator.toUpperCase()})`;
    operatorBtn.addEventListener('click', () => {
      group.operator = group.operator === 'and' ? 'or' : 'and';
      this.render();
    });
    groupHeader.appendChild(operatorBtn);

    // Negate checkbox
    const negateLabel = document.createElement('label');
    negateLabel.className = 'cfv-filter-builder-negate-label';
    const negateCheckbox = document.createElement('input');
    negateCheckbox.type = 'checkbox';
    negateCheckbox.checked = !!group.negate;
    negateCheckbox.addEventListener('change', () => {
      group.negate = negateCheckbox.checked;
      this.render();
    });
    negateLabel.appendChild(negateCheckbox);
    const negateText = document.createElement('span');
    negateText.textContent = 'NOT';
    negateText.title = 'Negate this group (invert the result)';
    negateLabel.appendChild(negateText);
    groupHeader.appendChild(negateLabel);

    // Spacer
    const spacer = document.createElement('div');
    spacer.className = 'cfv-filter-builder-spacer';
    groupHeader.appendChild(spacer);

    // Add condition button
    const addCondBtn = document.createElement('button');
    addCondBtn.className = 'btn btn-secondary btn-small cfv-filter-builder-add-btn';
    addCondBtn.innerHTML = `${getIcon(Plus, 12)} Condition`;
    addCondBtn.title = 'Add a new condition to this group';
    addCondBtn.addEventListener('click', () => {
      this.addToGroupAtPath(this.rule.group, path, this.createDefaultCondition('text-contains'));
      this.render();
    });
    groupHeader.appendChild(addCondBtn);

    // Add group button
    const addGroupBtn = document.createElement('button');
    addGroupBtn.className = 'btn btn-secondary btn-small cfv-filter-builder-add-btn';
    addGroupBtn.innerHTML = `${getIcon(Plus, 12)} Group`;
    addGroupBtn.title = 'Add a nested condition group';
    addGroupBtn.addEventListener('click', () => {
      this.addToGroupAtPath(this.rule.group, path, this.createDefaultGroup());
      this.render();
    });
    groupHeader.appendChild(addGroupBtn);

    // Remove group button (only for nested groups)
    if (path.length > 0) {
      const removeGroupBtn = document.createElement('button');
      removeGroupBtn.className = 'btn btn-icon btn-small cfv-filter-builder-remove-btn';
      removeGroupBtn.innerHTML = getIcon(Trash2, 14);
      removeGroupBtn.title = 'Remove this group';
      removeGroupBtn.addEventListener('click', () => {
        this.removeNodeAtPath(this.rule.group, path);
        this.render();
      });
      groupHeader.appendChild(removeGroupBtn);
    }

    el.appendChild(groupHeader);

    // Conditions list
    const conditionsList = document.createElement('div');
    conditionsList.className = 'cfv-filter-builder-conditions';

    if (group.conditions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cfv-filter-builder-empty';
      empty.textContent = 'No conditions. Click "+ Condition" to add one.';
      conditionsList.appendChild(empty);
    } else {
      for (let i = 0; i < group.conditions.length; i++) {
        const condPath = [...path, i];
        const node = group.conditions[i];
        if (isFilterGroup(node)) {
          // Render operator label between items (except first)
          if (i > 0) {
            const opLabel = document.createElement('div');
            opLabel.className = 'cfv-filter-builder-op-label';
            opLabel.textContent = group.operator.toUpperCase();
            conditionsList.appendChild(opLabel);
          }
          conditionsList.appendChild(this.renderGroup(node, condPath));
        } else {
          if (i > 0) {
            const opLabel = document.createElement('div');
            opLabel.className = 'cfv-filter-builder-op-label';
            opLabel.textContent = group.operator.toUpperCase();
            conditionsList.appendChild(opLabel);
          }
          conditionsList.appendChild(this.renderConditionRow(node, condPath));
        }
      }
    }

    el.appendChild(conditionsList);

    return el;
  }

  // ---------------------------------------------------------------------------
  // Condition row rendering
  // ---------------------------------------------------------------------------

  private renderConditionRow(cond: FilterCondition, path: number[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cfv-filter-builder-condition-row';

    // Type dropdown
    const typeSelect = this.createSelect(
      FILTER_CONDITION_TYPES as unknown as string[],
      cond.type,
      CONDITION_TYPE_LABELS,
      (newType) => {
        const typed = newType as ConditionType;
        this.updateNodeAtPath(this.rule.group, path, () => this.createDefaultCondition(typed));
        this.render();
      }
    );
    typeSelect.className = 'cfv-filter-builder-type-select';
    typeSelect.title = 'Condition type';
    row.appendChild(typeSelect);

    // Type-specific fields
    const fields = this.renderConditionFields(cond, path);
    for (const field of fields) {
      row.appendChild(field);
    }

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-icon btn-small cfv-filter-builder-remove-btn';
    removeBtn.innerHTML = getIcon(X, 14);
    removeBtn.title = 'Remove this condition';
    removeBtn.addEventListener('click', () => {
      this.removeNodeAtPath(this.rule.group, path);
      // Ensure the root group always has at least one condition
      if (this.rule.group.conditions.length === 0) {
        this.rule.group.conditions.push(this.createDefaultCondition('text-contains'));
      }
      this.render();
    });
    row.appendChild(removeBtn);

    return row;
  }

  private renderConditionFields(cond: FilterCondition, path: number[]): HTMLElement[] {
    switch (cond.type) {
      case 'text-contains':
        return this.renderTextContainsFields(cond, path);
      case 'text-not-contains':
        return this.renderTextNotContainsFields(cond, path);
      case 'regex':
        return this.renderRegexFields(cond, path);
      case 'seq-range':
        return this.renderSeqRangeFields(cond, path);
      case 'time-range':
        return this.renderTimeRangeFields(cond, path);
      case 'service':
        return this.renderServiceFields(cond, path);
      case 'status':
        return this.renderStatusFields(cond, path);
      case 'failure':
        return this.renderFailureFields(cond, path);
    }
  }

  private renderTextContainsFields(
    cond: Extract<FilterCondition, { type: 'text-contains' }>,
    path: number[]
  ): HTMLElement[] {
    const fieldSelect = this.createFieldDropdown(cond.field, (newField) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'text-contains') {
          return { ...node, field: newField as FilterField };
        }
        return node;
      });
      this.render();
    });

    const valueInput = this.createTextInput(cond.value, 'Search text...', (newValue) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'text-contains') {
          return { ...node, value: newValue };
        }
        return node;
      });
    });

    const caseSensitiveLabel = this.createCaseSensitiveToggle(!!cond.caseSensitive, (checked) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'text-contains') {
          return { ...node, caseSensitive: checked || undefined };
        }
        return node;
      });
    });

    return [fieldSelect, valueInput, caseSensitiveLabel];
  }

  private renderTextNotContainsFields(
    cond: Extract<FilterCondition, { type: 'text-not-contains' }>,
    path: number[]
  ): HTMLElement[] {
    const fieldSelect = this.createFieldDropdown(cond.field, (newField) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'text-not-contains') {
          return { ...node, field: newField as FilterField };
        }
        return node;
      });
      this.render();
    });

    const valueInput = this.createTextInput(cond.value, 'Exclude text...', (newValue) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'text-not-contains') {
          return { ...node, value: newValue };
        }
        return node;
      });
    });

    const caseSensitiveLabel = this.createCaseSensitiveToggle(!!cond.caseSensitive, (checked) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'text-not-contains') {
          return { ...node, caseSensitive: checked || undefined };
        }
        return node;
      });
    });

    return [fieldSelect, valueInput, caseSensitiveLabel];
  }

  private renderRegexFields(
    cond: Extract<FilterCondition, { type: 'regex' }>,
    path: number[]
  ): HTMLElement[] {
    const fieldSelect = this.createFieldDropdown(cond.field, (newField) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'regex') {
          return { ...node, field: newField as FilterField };
        }
        return node;
      });
      this.render();
    });

    const patternInput = this.createTextInput(cond.pattern, 'Regex pattern...', (newPattern) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'regex') {
          return { ...node, pattern: newPattern };
        }
        return node;
      });
    });
    patternInput.classList.add('cfv-filter-builder-regex-input');

    // Regex validation indicator
    const validIndicator = document.createElement('span');
    validIndicator.className = 'cfv-filter-builder-regex-indicator';
    if (cond.pattern) {
      try {
        new RegExp(cond.pattern);
        validIndicator.textContent = 'Valid';
        validIndicator.classList.add('valid');
      } catch {
        validIndicator.textContent = 'Invalid';
        validIndicator.classList.add('invalid');
      }
    }

    return [fieldSelect, patternInput, validIndicator];
  }

  private renderSeqRangeFields(
    cond: Extract<FilterCondition, { type: 'seq-range' }>,
    path: number[]
  ): HTMLElement[] {
    const fromLabel = document.createElement('span');
    fromLabel.className = 'cfv-filter-builder-field-label';
    fromLabel.textContent = '#';

    const fromInput = this.createNumberInput(cond.from, 'From', 0, undefined, (val) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'seq-range') {
          return { ...node, from: val };
        }
        return node;
      });
    });

    const toLabel = document.createElement('span');
    toLabel.className = 'cfv-filter-builder-field-label';
    toLabel.textContent = 'to';

    const toInput = this.createNumberInput(cond.to, 'To', 0, undefined, (val) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'seq-range') {
          return { ...node, to: val };
        }
        return node;
      });
    });

    return [fromLabel, fromInput, toLabel, toInput];
  }

  private renderTimeRangeFields(
    cond: Extract<FilterCondition, { type: 'time-range' }>,
    path: number[]
  ): HTMLElement[] {
    const fromInput = this.createTextInput(cond.from, 'HH:MM:SS.mmm', (val) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'time-range') {
          return { ...node, from: val };
        }
        return node;
      });
    });
    fromInput.classList.add('cfv-filter-builder-time-input');

    const toLabel = document.createElement('span');
    toLabel.className = 'cfv-filter-builder-field-label';
    toLabel.textContent = 'to';

    const toInput = this.createTextInput(cond.to, 'HH:MM:SS.mmm', (val) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'time-range') {
          return { ...node, to: val };
        }
        return node;
      });
    });
    toInput.classList.add('cfv-filter-builder-time-input');

    return [fromInput, toLabel, toInput];
  }

  private renderServiceFields(
    cond: Extract<FilterCondition, { type: 'service' }>,
    path: number[]
  ): HTMLElement[] {
    const columnLabels: Record<string, string> = {};
    for (const col of SERVICE_COLUMNS) {
      columnLabels[col] = col;
    }

    const columnSelect = this.createSelect(
      SERVICE_COLUMNS as unknown as string[],
      cond.column,
      columnLabels,
      (newColumn) => {
        this.updateNodeAtPath(this.rule.group, path, (node) => {
          if (!isFilterGroup(node) && node.type === 'service') {
            return { ...node, column: newColumn };
          }
          return node;
        });
        this.render();
      }
    );
    columnSelect.className = 'cfv-filter-builder-service-select';
    columnSelect.title = 'Service column';

    const directionLabels: Record<string, string> = {
      from: 'From',
      to: 'To',
      either: 'Either',
    };
    const directionSelect = this.createSelect(
      ['from', 'to', 'either'],
      cond.direction,
      directionLabels,
      (newDir) => {
        this.updateNodeAtPath(this.rule.group, path, (node) => {
          if (!isFilterGroup(node) && node.type === 'service') {
            return { ...node, direction: newDir as 'from' | 'to' | 'either' };
          }
          return node;
        });
        this.render();
      }
    );
    directionSelect.className = 'cfv-filter-builder-direction-select';
    directionSelect.title = 'Direction';

    return [columnSelect, directionSelect];
  }

  private renderStatusFields(
    cond: Extract<FilterCondition, { type: 'status' }>,
    path: number[]
  ): HTMLElement[] {
    const operatorLabels: Record<string, string> = {
      eq: '=',
      gte: '>=',
      lt: '<',
    };
    const operatorSelect = this.createSelect(
      ['eq', 'gte', 'lt'],
      cond.operator,
      operatorLabels,
      (newOp) => {
        this.updateNodeAtPath(this.rule.group, path, (node) => {
          if (!isFilterGroup(node) && node.type === 'status') {
            return { ...node, operator: newOp as 'eq' | 'gte' | 'lt' };
          }
          return node;
        });
        this.render();
      }
    );
    operatorSelect.className = 'cfv-filter-builder-operator-select';
    operatorSelect.title = 'Comparison operator';

    const codeInput = this.createNumberInput(cond.code, 'Status code', 100, 599, (val) => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'status') {
          return { ...node, code: val };
        }
        return node;
      });
    });
    codeInput.classList.add('cfv-filter-builder-status-input');

    return [operatorSelect, codeInput];
  }

  private renderFailureFields(
    cond: Extract<FilterCondition, { type: 'failure' }>,
    path: number[]
  ): HTMLElement[] {
    const label = document.createElement('label');
    label.className = 'cfv-filter-builder-failure-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = cond.failureOnly;
    checkbox.addEventListener('change', () => {
      this.updateNodeAtPath(this.rule.group, path, (node) => {
        if (!isFilterGroup(node) && node.type === 'failure') {
          return { ...node, failureOnly: checkbox.checked };
        }
        return node;
      });
    });
    label.appendChild(checkbox);

    const text = document.createElement('span');
    text.textContent = 'Failures only';
    label.appendChild(text);

    return [label];
  }

  // ---------------------------------------------------------------------------
  // Form element helpers
  // ---------------------------------------------------------------------------

  private createSelect(
    options: string[],
    currentValue: string,
    labelMap: Record<string, string>,
    onChange: (value: string) => void
  ): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'cfv-filter-builder-select';
    for (const opt of options) {
      const optEl = document.createElement('option');
      optEl.value = opt;
      optEl.textContent = labelMap[opt] || opt;
      if (opt === currentValue) optEl.selected = true;
      select.appendChild(optEl);
    }
    select.addEventListener('change', () => {
      onChange(select.value);
    });
    return select;
  }

  private createFieldDropdown(currentField: FilterField, onChange: (field: string) => void): HTMLSelectElement {
    const labelMap: Record<string, string> = {};
    const values: string[] = [];
    for (const f of FILTER_FIELDS) {
      values.push(f.value);
      labelMap[f.value] = f.label;
    }
    const select = this.createSelect(values, currentField, labelMap, onChange);
    select.className = 'cfv-filter-builder-field-select';
    select.title = 'Field to match against';
    return select;
  }

  private createTextInput(
    value: string,
    placeholder: string,
    onChange: (value: string) => void
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cfv-filter-builder-text-input';
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener('input', () => {
      onChange(input.value);
    });
    return input;
  }

  private createNumberInput(
    value: number,
    placeholder: string,
    min?: number,
    max?: number,
    onChange?: (value: number) => void
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'cfv-filter-builder-number-input';
    input.value = String(value);
    input.placeholder = placeholder;
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    if (onChange) {
      input.addEventListener('input', () => {
        const parsed = parseInt(input.value, 10);
        if (!isNaN(parsed)) {
          onChange(parsed);
        }
      });
    }
    return input;
  }

  private createCaseSensitiveToggle(
    checked: boolean,
    onChange: (checked: boolean) => void
  ): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'cfv-filter-builder-case-label';
    label.title = 'Case sensitive matching';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.addEventListener('change', () => {
      onChange(checkbox.checked);
    });
    label.appendChild(checkbox);

    const text = document.createElement('span');
    text.textContent = 'Aa';
    text.className = 'cfv-filter-builder-case-text';
    label.appendChild(text);

    return label;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private apply(): void {
    this.cleanup();
    this.callbacks.onApply(this.rule);
  }

  private cancel(): void {
    this.cleanup();
    this.callbacks.onCancel();
  }

  private cleanup(): void {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.container.innerHTML = '';
    this.backdrop = null;
  }

  private setupKeyboardHandler(): void {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);
  }

  /**
   * Programmatically close the builder and clean up event listeners.
   * Called externally when the parent component needs to tear down.
   */
  dispose(): void {
    this.cleanup();
  }
}
