import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Editor chrome — dark theme matching project CSS variables
export const kqlEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: '12px',
    fontFamily: "'Cascadia Code', 'Consolas', monospace",
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: 'var(--accent-blue)',
    boxShadow: '0 0 0 1px var(--accent-blue)',
  },
  '.cm-content': {
    padding: '6px 8px',
    caretColor: 'var(--text-primary)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--text-primary)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(56, 139, 253, 0.25) !important',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  // No line numbers, no gutter, no active line highlight for small editors
  '.cm-gutters': {
    display: 'none',
  },
  // Placeholder
  '.cm-placeholder': {
    color: 'var(--text-secondary)',
    fontStyle: 'italic',
  },
  // Autocomplete tooltip
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
  '.cm-tooltip-autocomplete ul': {
    fontFamily: "'Cascadia Code', 'Consolas', monospace",
    fontSize: '12px',
  },
  '.cm-tooltip-autocomplete ul li': {
    padding: '3px 8px',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--bg-hover)',
    color: 'var(--text-primary)',
  },
  '.cm-completionLabel': {
    color: 'var(--text-primary)',
  },
  '.cm-completionDetail': {
    color: 'var(--text-secondary)',
    fontStyle: 'italic',
    marginLeft: '8px',
  },
  '.cm-completionMatchedText': {
    color: 'var(--accent-blue)',
    textDecoration: 'none',
    fontWeight: '600',
  },
}, { dark: true });

// Syntax highlighting colors — matching the hljs dark theme used elsewhere
export const kqlHighlightStyle = syntaxHighlighting(HighlightStyle.define([
  { tag: t.keyword, color: '#ff7b72' },          // red — keywords & tabular operators
  { tag: t.operator, color: '#ff7b72' },          // red — string operators, comparison
  { tag: t.function(t.variableName), color: '#d2a8ff' }, // purple — functions
  { tag: t.typeName, color: '#79c0ff' },          // blue — types
  { tag: t.string, color: '#a5d6ff' },            // light blue — strings
  { tag: t.number, color: '#79c0ff' },            // blue — numbers
  { tag: t.comment, color: '#8b949e', fontStyle: 'italic' }, // grey — comments
  { tag: t.variableName, color: '#c9d1d9' },      // default text — identifiers
  { tag: t.punctuation, color: '#8b949e' },        // grey — pipe, parens
]));
