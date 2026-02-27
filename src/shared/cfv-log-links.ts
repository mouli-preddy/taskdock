/**
 * CFV Log Links Helper
 * Converts CFV LogComponent URLs (MQL conditions) to DGrepFormState (KQL serverQuery).
 */

import type { DGrepFormState } from './dgrep-ui-types.js';
import type { DGrepEndpointName, OffsetSign, OffsetUnit, ScopingCondition } from './dgrep-types.js';

export interface CfvLogComponent {
  name: string;
  location: string;
}

/**
 * Convert a single CFV LogComponent URL to a DGrepFormState with KQL serverQuery.
 *
 * CFV URLs use:   &conditions=[["ActivityId","==","<id>"]]
 * We convert to:  serverQuery = 'source | where ActivityId == "<id>"'
 */
export function cfvLogComponentToFormState(logComponent: CfvLogComponent): DGrepFormState | null {
  try {
    const url = new URL(logComponent.location.replace(/ /g, '%20'));
    const params = url.searchParams;

    const endpoint = (params.get('ep') || 'Diagnostics PROD') as DGrepEndpointName;

    const namespace = params.get('ns') || '';
    const enRaw = params.get('en') || '';
    const selectedEvents = enRaw.split(',').map(e => e.trim()).filter(Boolean);

    const timeRaw = params.get('time') || '';
    let referenceTime = '';
    if (timeRaw) {
      const dt = new Date(timeRaw);
      if (!isNaN(dt.getTime())) {
        referenceTime = dt.toISOString().slice(0, 16);
      }
    }

    const offsetRaw = params.get('offset') || '+30';
    let offsetSign: OffsetSign = '+';
    let offsetStr = offsetRaw;
    if (offsetRaw.startsWith('~')) { offsetSign = '~'; offsetStr = offsetRaw.slice(1); }
    else if (offsetRaw.startsWith('+')) { offsetSign = '+'; offsetStr = offsetRaw.slice(1); }
    else if (offsetRaw.startsWith('-')) { offsetSign = '-'; offsetStr = offsetRaw.slice(1); }
    const offsetValue = parseInt(offsetStr, 10) || 30;

    const unitRaw = params.get('offsetUnit') || 'Minutes';
    let offsetUnit: OffsetUnit = 'Minutes';
    if (unitRaw.toLowerCase().startsWith('min')) offsetUnit = 'Minutes';
    else if (unitRaw.toLowerCase().startsWith('hour')) offsetUnit = 'Hours';
    else if (unitRaw.toLowerCase().startsWith('day')) offsetUnit = 'Days';

    // CFV URLs can have multiple scopingConditions params (empty default + tenant values).
    // Use getAll() to collect all of them.
    const scopingConditions: ScopingCondition[] = [];
    for (const scopingRaw of params.getAll('scopingConditions')) {
      if (!scopingRaw) continue;
      try {
        const parsed = JSON.parse(scopingRaw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (Array.isArray(item) && item.length >= 2) {
              scopingConditions.push({
                column: item[0],
                operator: item.length >= 3 ? item[1] : '==',
                value: item.length >= 3 ? item[2] : item[1],
              });
            }
          }
        }
      } catch { /* ignore invalid JSON */ }
    }

    const serverQuery = conditionsToKql(params.get('conditions'));
    const clientQueryRaw = params.get('clientQuery') || '';
    const clientQuery = clientQueryToKql(clientQueryRaw);

    return {
      endpoint,
      namespace,
      selectedEvents,
      referenceTime,
      offsetSign,
      offsetValue,
      offsetUnit,
      scopingConditions,
      serverQuery,
      clientQuery,
      maxResults: 10000,
      showSecurityEvents: false,
    };
  } catch {
    return null;
  }
}

function conditionsToKql(conditionsStr: string | null): string {
  if (!conditionsStr) return '';

  try {
    const conditions: string[][] = JSON.parse(decodeURIComponent(conditionsStr));
    if (!Array.isArray(conditions) || conditions.length === 0) return '';

    const whereClauses = conditions.map(cond => {
      if (!Array.isArray(cond) || cond.length < 3) return null;

      const [column, operator, value] = cond;
      const op = decodeURIComponent(operator);

      if (column === 'AnyField') {
        return `* ${mapOperator(op)} "${value}"`;
      }

      if (op === 'equals any of') {
        const values = value.split(',').map(v => `"${v.trim()}"`).join(', ');
        return `${column} in (${values})`;
      }

      if (op === 'contains' || op === 'contains any of') {
        return `${column} contains "${value}"`;
      }

      return `${column} ${mapOperator(op)} "${value}"`;
    }).filter(Boolean);

    if (whereClauses.length === 0) return '';
    return `source | where ${whereClauses.join(' and ')}`;
  } catch {
    return '';
  }
}

function mapOperator(op: string): string {
  switch (op) {
    case '==':
    case '%3D%3D':
      return '==';
    case '!=':
      return '!=';
    case 'contains':
    case 'contains any of':
      return 'contains';
    case 'startswith':
      return 'startswith';
    default:
      return op;
  }
}

function clientQueryToKql(raw: string): string {
  if (!raw) return '';
  const kql = raw.replace(/\borderby\b/gi, 'sort by');
  return `source | ${kql}`;
}

/**
 * Extract log components from CFV raw callFlow data.
 * The data is at: nrtStreamingIndexAugmentedCall.logComponents[]
 */
export function extractLogComponents(callFlowData: Record<string, unknown>): CfvLogComponent[] {
  const nrt = (callFlowData?.nrtStreamingIndexAugmentedCall ?? {}) as Record<string, unknown>;
  const raw = nrt?.logComponents;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((lc: any) => lc?.name && lc?.location)
    .map((lc: any) => ({
      name: String(lc.name),
      location: String(lc.location),
    }));
}
