export type FilterField = 'label' | 'from' | 'to' | 'any';

export type FilterCondition =
  | { type: 'text-contains'; field: FilterField; value: string; caseSensitive?: boolean }
  | { type: 'text-not-contains'; field: FilterField; value: string; caseSensitive?: boolean }
  | { type: 'regex'; field: FilterField; pattern: string }
  | { type: 'seq-range'; from: number; to: number }
  | { type: 'time-range'; from: string; to: string }
  | { type: 'service'; column: string; direction: 'from' | 'to' | 'either' }
  | { type: 'status'; operator: 'eq' | 'gte' | 'lt'; code: number }
  | { type: 'failure'; failureOnly: boolean };

export interface FilterGroup {
  operator: 'and' | 'or';
  conditions: (FilterCondition | FilterGroup)[];
  negate?: boolean;
}

export interface FilterRule {
  id: string;
  name?: string;
  mode: 'mark' | 'filter';
  color: string;
  group: FilterGroup;
  enabled: boolean;
}

export interface FilterPreset {
  id: string;
  name: string;
  rules: FilterRule[];
}

export interface CallFilterState {
  rules: FilterRule[];
  showMatchedOnly: boolean;
}

export const FILTER_COLORS = [
  '#4A9EFF', // blue
  '#FF6B6B', // red
  '#51CF66', // green
  '#FFD43B', // yellow
  '#CC5DE8', // purple
  '#FF922B', // orange
  '#20C997', // teal
  '#F06595', // pink
] as const;

export const FILTER_CONDITION_TYPES = [
  'text-contains', 'text-not-contains', 'regex',
  'seq-range', 'time-range', 'service', 'status', 'failure',
] as const;

export const FILTER_FIELDS: { value: FilterField; label: string }[] = [
  { value: 'any', label: 'Any Field' },
  { value: 'label', label: 'Description' },
  { value: 'from', label: 'From Service' },
  { value: 'to', label: 'To Service' },
];

export function isFilterGroup(node: FilterCondition | FilterGroup): node is FilterGroup {
  return 'operator' in node;
}

export function createEmptyFilterState(): CallFilterState {
  return { rules: [], showMatchedOnly: false };
}

export function generateFilterId(): string {
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultFilterRule(colorIndex: number): FilterRule {
  return {
    id: generateFilterId(),
    mode: 'filter',
    color: FILTER_COLORS[colorIndex % FILTER_COLORS.length],
    group: { operator: 'and', conditions: [{ type: 'text-contains', field: 'any', value: '' }] },
    enabled: true,
  };
}

export function summarizeRule(rule: FilterRule): string {
  if (rule.name) return rule.name;
  const conditions = rule.group.conditions;
  if (conditions.length === 0) return '(empty)';
  const first = conditions[0];
  if (isFilterGroup(first)) {
    return `${rule.group.operator.toUpperCase()} group (${conditions.length})`;
  }
  const desc = summarizeCondition(first);
  if (conditions.length === 1) return desc;
  return `${desc} +${conditions.length - 1}`;
}

function summarizeCondition(c: FilterCondition): string {
  switch (c.type) {
    case 'text-contains': return `${c.field} ~ "${truncate(c.value, 15)}"`;
    case 'text-not-contains': return `${c.field} !~ "${truncate(c.value, 15)}"`;
    case 'regex': return `${c.field} /${truncate(c.pattern, 15)}/`;
    case 'seq-range': return `#${c.from}-${c.to}`;
    case 'time-range': return `${c.from}-${c.to}`;
    case 'service': return `${c.direction} ${c.column}`;
    case 'status': return `status ${c.operator} ${c.code}`;
    case 'failure': return 'failures';
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}
