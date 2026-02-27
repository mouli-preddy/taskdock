import type { DGrepEndpointName, OffsetUnit, OffsetSign, ScopingCondition, ScopingOperator } from '../../shared/dgrep-types.js';
import { DGREP_ENDPOINT_URLS } from '../../shared/dgrep-types.js';
import type { ParsedDGrepUrl, DGrepFormState } from '../../shared/dgrep-ui-types.js';

const ENDPOINT_NAME_MAP: Record<string, DGrepEndpointName> = {};
for (const [name] of Object.entries(DGREP_ENDPOINT_URLS)) {
  ENDPOINT_NAME_MAP[name.toLowerCase()] = name as DGrepEndpointName;
}

export function parseDGrepUrl(url: string): ParsedDGrepUrl | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('microsoftgeneva.com') && !parsed.hostname.includes('dgrepv2')) {
      return null;
    }

    const params = parsed.searchParams;

    // Endpoint
    const epRaw = params.get('ep');
    let endpoint: DGrepEndpointName | null = null;
    if (epRaw) {
      const lower = epRaw.toLowerCase();
      endpoint = ENDPOINT_NAME_MAP[lower] || null;
    }

    // Namespace
    const namespace = params.get('ns') || null;

    // Events (comma-separated)
    const enRaw = params.get('en');
    const eventNames = enRaw ? enRaw.split(',').map(e => e.trim()).filter(Boolean) : [];

    // Time
    const referenceTime = params.get('time') || null;

    // Offset
    const offsetRaw = params.get('offset');
    let offset: number | null = null;
    let offsetSign: OffsetSign = '~';
    if (offsetRaw) {
      if (offsetRaw.startsWith('~')) {
        offsetSign = '~';
        offset = parseInt(offsetRaw.slice(1), 10);
      } else if (offsetRaw.startsWith('+')) {
        offsetSign = '+';
        offset = parseInt(offsetRaw.slice(1), 10);
      } else if (offsetRaw.startsWith('-')) {
        offsetSign = '-';
        offset = parseInt(offsetRaw.slice(1), 10);
      } else {
        offset = parseInt(offsetRaw, 10);
      }
      if (isNaN(offset!)) offset = null;
    }

    // Offset unit
    const unitRaw = params.get('offsetUnit');
    let offsetUnit: OffsetUnit | null = null;
    if (unitRaw) {
      const normalized = unitRaw.charAt(0).toUpperCase() + unitRaw.slice(1).toLowerCase();
      if (normalized === 'Minutes' || normalized === 'Hours' || normalized === 'Days') {
        offsetUnit = normalized as OffsetUnit;
      }
    }

    // Server query
    const serverQuery = params.get('serverQuery') || null;

    // Client query
    const clientQuery = params.get('kqlClientQuery') || null;

    // Scoping conditions — use getAll() since CFV URLs can have multiple scopingConditions params
    const scopingConditions: ScopingCondition[] = [];
    for (const scopingRaw of params.getAll('scopingConditions')) {
      if (!scopingRaw) continue;
      try {
        const parsed = JSON.parse(scopingRaw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (Array.isArray(item) && item.length >= 3) {
              // Format: [column, operator, value]
              scopingConditions.push({
                column: item[0],
                operator: item[1] as ScopingOperator,
                value: item[2],
              });
            } else if (Array.isArray(item) && item.length === 2) {
              // Geneva portal format: [column, value] - defaults to '=='
              scopingConditions.push({
                column: item[0],
                operator: '==',
                value: item[1],
              });
            }
          }
        }
      } catch {
        // Ignore invalid scoping conditions JSON
      }
    }

    return {
      endpoint,
      namespace,
      eventNames,
      referenceTime,
      offset,
      offsetUnit,
      offsetSign,
      serverQuery,
      clientQuery,
      scopingConditions,
    };
  } catch {
    return null;
  }
}

export function buildDGrepUrl(state: DGrepFormState): string {
  const params = new URLSearchParams();
  params.set('page', 'logs');
  params.set('be', 'DGrep');

  if (state.endpoint) {
    params.set('ep', state.endpoint);
  }
  if (state.namespace) {
    params.set('ns', state.namespace);
  }
  if (state.selectedEvents.length > 0) {
    params.set('en', state.selectedEvents.join(','));
  }
  if (state.referenceTime) {
    params.set('time', state.referenceTime);
  }

  const sign = state.offsetSign === '~' ? '~' : state.offsetSign;
  params.set('offset', `${sign}${state.offsetValue}`);
  params.set('offsetUnit', state.offsetUnit);
  params.set('UTC', 'true');

  if (state.serverQuery) {
    params.set('serverQuery', state.serverQuery);
    params.set('serverQueryType', 'kql');
  }
  if (state.clientQuery) {
    params.set('kqlClientQuery', state.clientQuery);
  }

  if (state.scopingConditions.length > 0) {
    // Use Geneva portal format: [column, value] for == operator, [column, operator, value] for others
    const arr = state.scopingConditions.map(sc =>
      sc.operator === '==' ? [sc.column, sc.value] : [sc.column, sc.operator, sc.value]
    );
    params.set('scopingConditions', JSON.stringify(arr));
  }

  return `https://portal.microsoftgeneva.com/logs/dgrep?${params.toString()}`;
}
