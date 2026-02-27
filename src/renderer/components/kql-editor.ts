import { EditorState } from '@codemirror/state';
import { EditorView, placeholder as cmPlaceholder, keymap } from '@codemirror/view';
import { history, historyKeymap } from '@codemirror/commands';
import { autocompletion, acceptCompletion } from '@codemirror/autocomplete';
import { kqlLanguage } from '../lang/kql-stream-parser.js';
import { kqlCompletionSource } from '../lang/kql-completions.js';
import { kqlEditorTheme, kqlHighlightStyle } from '../lang/kql-theme.js';

export interface KqlEditorOptions {
  parent: HTMLElement;
  placeholder?: string;
  onChange?: (value: string) => void;
  minHeight?: string;
  maxHeight?: string;
}

export class KqlEditor {
  private view: EditorView;

  constructor(opts: KqlEditorOptions) {
    const extensions = [
      kqlLanguage,
      kqlEditorTheme,
      kqlHighlightStyle,
      history(),
      autocompletion({
        override: [kqlCompletionSource],
        defaultKeymap: true,
      }),
      keymap.of([
        ...historyKeymap,
        // Tab accepts completion when menu is open
        { key: 'Tab', run: acceptCompletion },
      ]),
      EditorView.lineWrapping,
    ];

    if (opts.placeholder) {
      extensions.push(cmPlaceholder(opts.placeholder));
    }

    if (opts.onChange) {
      const cb = opts.onChange;
      extensions.push(EditorView.updateListener.of((update) => {
        if (update.docChanged) cb(update.state.doc.toString());
      }));
    }

    // Height constraints via theme override
    const minH = opts.minHeight || '42px';
    const maxH = opts.maxHeight || '120px';
    extensions.push(EditorView.theme({
      '&': {
        minHeight: minH,
        maxHeight: maxH,
      },
      '.cm-scroller': {
        maxHeight: maxH,
      },
    }));

    this.view = new EditorView({
      state: EditorState.create({ doc: '', extensions }),
      parent: opts.parent,
    });
  }

  getValue(): string {
    return this.view.state.doc.toString();
  }

  setValue(value: string): void {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: value },
    });
  }

  focus(): void {
    this.view.focus();
  }

  destroy(): void {
    this.view.destroy();
  }
}
