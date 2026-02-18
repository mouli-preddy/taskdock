import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import {
  TABULAR_OPERATORS,
  SCALAR_FUNCTIONS,
  AGGREGATION_FUNCTIONS,
  KEYWORDS,
  TYPES,
  STRING_OPERATORS,
} from '../../shared/kql-vocabulary.js';

// Build completion items once

const tabularCompletions: Completion[] = TABULAR_OPERATORS.map(op => ({
  label: op,
  type: 'keyword',
  detail: 'tabular operator',
  boost: 2,
}));

const scalarFnCompletions: Completion[] = SCALAR_FUNCTIONS.map(fn => ({
  label: fn,
  type: 'function',
  detail: 'scalar function',
  apply: fn + '(',
}));

const aggFnCompletions: Completion[] = AGGREGATION_FUNCTIONS.map(fn => ({
  label: fn,
  type: 'function',
  detail: 'aggregation',
  apply: fn + '(',
}));

const keywordCompletions: Completion[] = KEYWORDS.map(kw => ({
  label: kw,
  type: 'keyword',
  detail: 'keyword',
}));

const typeCompletions: Completion[] = TYPES.map(t => ({
  label: t,
  type: 'type',
  detail: 'type',
}));

const stringOpCompletions: Completion[] = STRING_OPERATORS
  .filter(op => !op.startsWith('!')) // negated versions are less commonly typed manually
  .map(op => ({
    label: op,
    type: 'keyword',
    detail: 'string operator',
    ...(op.includes(' ') ? { apply: op } : {}), // "matches regex" needs apply
  }));

const allCompletions: Completion[] = [
  ...tabularCompletions,
  ...scalarFnCompletions,
  ...aggFnCompletions,
  ...keywordCompletions,
  ...typeCompletions,
  ...stringOpCompletions,
];

export function kqlCompletionSource(context: CompletionContext): CompletionResult | null {
  // Get text before cursor on the current line
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);

  // Check if we're right after a pipe (with optional whitespace)
  const afterPipe = /\|\s*(\w*)$/.test(textBefore);

  // Match the current word being typed
  const word = context.matchBefore(/[a-zA-Z_]\w*(-\w*)*/);
  if (!word && !afterPipe) return null;

  // If no word started and not explicit, don't show completions
  if (!word && !context.explicit) return null;

  const from = word ? word.from : context.pos;

  const options = afterPipe ? tabularCompletions : allCompletions;

  return {
    from,
    options,
    validFor: /^[a-zA-Z_]\w*(-\w*)*$/,
  };
}
