import { StreamLanguage, type StreamParser } from '@codemirror/language';
import {
  TABULAR_OPERATOR_SET,
  KEYWORD_SET,
  FUNCTION_SET,
  TYPE_SET,
  NEGATED_OPERATORS,
} from '../../shared/kql-vocabulary.js';

interface KqlState {
  afterPipe: boolean;
}

const kqlParser: StreamParser<KqlState> = {
  startState(): KqlState {
    return { afterPipe: false };
  },

  token(stream, state): string | null {
    // Skip whitespace
    if (stream.eatSpace()) return null;

    // Line comments
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }

    // String literals
    if (stream.match('"')) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') stream.next(); // skip escaped char
        else if (ch === '"') break;
      }
      return 'string';
    }
    if (stream.match("'")) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') stream.next();
        else if (ch === "'") break;
      }
      return 'string';
    }

    // Pipe — punctuation, sets afterPipe
    if (stream.match('|')) {
      state.afterPipe = true;
      return 'punctuation';
    }

    // Multi-char operators
    if (stream.match('==') || stream.match('!=') || stream.match('=~') ||
        stream.match('!~') || stream.match('<=') || stream.match('>=')) {
      return 'operator';
    }

    // Single-char operators / punctuation
    const ch = stream.peek();
    if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === ',' || ch === ';' || ch === '=' || ch === '<' || ch === '>') {
      stream.next();
      return 'punctuation';
    }

    // Negated word operators: !contains, !startswith, etc.
    if (ch === '!') {
      const saved = stream.pos;
      stream.next(); // consume '!'
      const word = stream.match(/^[a-zA-Z_]\w*/);
      if (word && NEGATED_OPERATORS.has((word as unknown as string[])[0])) {
        state.afterPipe = false;
        return 'operator';
      }
      // Not a negated operator — backtrack
      stream.pos = saved;
      stream.next();
      return 'operator';
    }

    // Numbers (including timespan suffixes like 1d, 2h, 30m, 1s, 100ms, 100tick)
    if (/[0-9]/.test(ch!)) {
      stream.match(/^[0-9]+(\.[0-9]+)?/);
      stream.match(/^(ms|tick|[dhms])\b/); // optional timespan suffix
      return 'number';
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch!)) {
      // Match hyphenated identifiers like project-away, project-rename
      stream.match(/^[a-zA-Z_]\w*(-\w+)*/);
      const word = stream.current();
      const lower = word.toLowerCase();

      // Check if it's a tabular operator (after pipe)
      if (TABULAR_OPERATOR_SET.has(lower)) {
        state.afterPipe = false;
        return 'keyword';
      }

      // Check types
      if (TYPE_SET.has(lower)) {
        state.afterPipe = false;
        return 'typeName';
      }

      // Check functions
      if (FUNCTION_SET.has(lower)) {
        state.afterPipe = false;
        return 'variableName.function';
      }

      // Check string operators used as infix (contains, startswith, etc.)
      if (lower === 'contains' || lower === 'contains_cs' ||
          lower === 'startswith' || lower === 'startswith_cs' ||
          lower === 'endswith' || lower === 'endswith_cs' ||
          lower === 'matches' || lower === 'in') {
        state.afterPipe = false;
        // Consume "regex" after "matches"
        if (lower === 'matches') {
          stream.eatSpace();
          stream.match(/^regex\b/);
        }
        return 'operator';
      }

      // Check keywords
      if (KEYWORD_SET.has(lower)) {
        state.afterPipe = false;
        return 'keyword';
      }

      state.afterPipe = false;
      return 'variableName';
    }

    // Dot accessor
    if (ch === '.') {
      stream.next();
      return 'punctuation';
    }

    // Anything else — advance one char
    stream.next();
    return null;
  },
};

export const kqlLanguage = StreamLanguage.define(kqlParser);
