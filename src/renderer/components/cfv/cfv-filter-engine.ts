import type { CallFlowMessage } from '../../../main/cfv/cfv-types.js';
import type { FilterCondition, FilterGroup, FilterRule, CallFilterState } from '../../../shared/cfv-filter-types.js';
import { isFilterGroup } from '../../../shared/cfv-filter-types.js';

export interface FilterResult {
  visible: boolean;
  marks: { color: string; ruleId: string }[];
}

export function evaluateFilters(
  messages: CallFlowMessage[],
  state: CallFilterState
): Map<number, FilterResult> {
  const results = new Map<number, FilterResult>();
  const enabledRules = state.rules.filter(r => r.enabled);
  const filterRules = enabledRules.filter(r => r.mode === 'filter');
  const markRules = enabledRules.filter(r => r.mode === 'mark');
  const hasFilterRules = filterRules.length > 0;

  for (const msg of messages) {
    const marks: { color: string; ruleId: string }[] = [];

    for (const rule of markRules) {
      if (evaluateGroup(rule.group, msg)) {
        marks.push({ color: rule.color, ruleId: rule.id });
      }
    }

    let passesFilter = true;
    if (hasFilterRules) {
      passesFilter = filterRules.some(rule => {
        const matched = evaluateGroup(rule.group, msg);
        if (matched) {
          marks.push({ color: rule.color, ruleId: rule.id });
        }
        return matched;
      });
    }

    let visible = passesFilter;
    if (state.showMatchedOnly && marks.length === 0 && !hasFilterRules) {
      visible = false;
    }
    if (state.showMatchedOnly && hasFilterRules && marks.length === 0 && !passesFilter) {
      visible = false;
    }

    results.set(msg.index, { visible, marks });
  }

  return results;
}

export function evaluateGroup(group: FilterGroup, msg: CallFlowMessage): boolean {
  if (group.conditions.length === 0) return true;
  const result = group.operator === 'and'
    ? group.conditions.every(c => evaluateNode(c, msg))
    : group.conditions.some(c => evaluateNode(c, msg));
  return group.negate ? !result : result;
}

function evaluateNode(node: FilterCondition | FilterGroup, msg: CallFlowMessage): boolean {
  if (isFilterGroup(node)) return evaluateGroup(node, msg);
  return evaluateCondition(node, msg);
}

function evaluateCondition(cond: FilterCondition, msg: CallFlowMessage): boolean {
  switch (cond.type) {
    case 'text-contains': {
      const text = resolveField(cond.field, msg);
      const value = cond.caseSensitive ? cond.value : cond.value.toLowerCase();
      const target = cond.caseSensitive ? text : text.toLowerCase();
      return target.includes(value);
    }
    case 'text-not-contains': {
      const text = resolveField(cond.field, msg);
      const value = cond.caseSensitive ? cond.value : cond.value.toLowerCase();
      const target = cond.caseSensitive ? text : text.toLowerCase();
      return !target.includes(value);
    }
    case 'regex': {
      try {
        const text = resolveField(cond.field, msg);
        const re = new RegExp(cond.pattern, 'i');
        return re.test(text);
      } catch {
        return false;
      }
    }
    case 'seq-range':
      return msg.index >= cond.from && msg.index <= cond.to;
    case 'time-range': {
      const msgMs = parseTimeToMs(msg.reqTime || msg.time || '');
      if (msgMs === -1) return false;
      const fromMs = parseTimeToMs(cond.from);
      const toMs = parseTimeToMs(cond.to);
      if (fromMs === -1 || toMs === -1) return false;
      return msgMs >= fromMs && msgMs <= toMs;
    }
    case 'service': {
      const from = (msg.from || '').toLowerCase();
      const to = (msg.to || '').toLowerCase();
      const col = cond.column.toLowerCase();
      if (cond.direction === 'from') return from.includes(col);
      if (cond.direction === 'to') return to.includes(col);
      return from.includes(col) || to.includes(col);
    }
    case 'status': {
      const statusNum = parseInt(msg.status, 10);
      if (isNaN(statusNum)) return false;
      if (cond.operator === 'eq') return statusNum === cond.code;
      if (cond.operator === 'gte') return statusNum >= cond.code;
      if (cond.operator === 'lt') return statusNum < cond.code;
      return false;
    }
    case 'failure':
      if (cond.failureOnly) {
        const statusNum = parseInt(msg.status, 10);
        return msg.isFailure || (!isNaN(statusNum) && statusNum >= 400);
      }
      return true;
  }
}

function resolveField(field: string, msg: CallFlowMessage): string {
  switch (field) {
    case 'label': return msg.label || '';
    case 'from': return msg.from || '';
    case 'to': return msg.to || '';
    case 'any': return [msg.label, msg.from, msg.to, msg.req, msg.resp].filter(Boolean).join(' ');
    default: return '';
  }
}

function parseTimeToMs(timeStr: string): number {
  if (!timeStr) return -1;
  const short = timeStr.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  if (short) {
    return (
      parseInt(short[1]) * 3600000 +
      parseInt(short[2]) * 60000 +
      parseInt(short[3]) * 1000 +
      parseInt(short[4])
    );
  }
  const iso = timeStr.match(/T(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  if (iso) {
    return (
      parseInt(iso[1]) * 3600000 +
      parseInt(iso[2]) * 60000 +
      parseInt(iso[3]) * 1000 +
      parseInt(iso[4])
    );
  }
  return -1;
}
