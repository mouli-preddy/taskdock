import type { DGrepEndpointName, OffsetSign, OffsetUnit, ScopingCondition, ScopingOperator } from './dgrep-types.js';

export interface DGrepFormState {
  endpoint: DGrepEndpointName;
  namespace: string;
  selectedEvents: string[];
  referenceTime: string;
  offsetSign: OffsetSign;
  offsetValue: number;
  offsetUnit: OffsetUnit;
  scopingConditions: ScopingCondition[];
  serverQuery: string;
  clientQuery: string;
  maxResults: number;
  showSecurityEvents: boolean;
}

export interface ParsedDGrepUrl {
  endpoint: DGrepEndpointName | null;
  namespace: string | null;
  eventNames: string[];
  referenceTime: string | null;
  offset: number | null;
  offsetUnit: OffsetUnit | null;
  offsetSign: OffsetSign;
  serverQuery: string | null;
  clientQuery: string | null;
  scopingConditions: ScopingCondition[];
}
