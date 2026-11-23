import { useEffect, useRef } from 'react';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { sql, StandardSQL } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';

interface SqlEditorProps {
  value: string;
  schema: Record<string, string[]>;
  onChange: (nextValue: string) => void;
  onRun: () => void;
}

const DEWPOND_SQL_HIGHLIGHT = HighlightStyle.define([
  { tag: tags.keyword, color: '#7dd3fc', fontWeight: '700' },
  { tag: tags.string, color: '#86efac' },
  { tag: tags.number, color: '#fcd34d' },
  { tag: tags.comment, color: '#64748b', fontStyle: 'italic' },
  { tag: tags.operator, color: '#93c5fd' },
  { tag: tags.name, color: '#e2e8f0' },
]);

const DEWPOND_SQL_THEME = EditorView.theme(
  {
    '&': {
      backgroundColor: '#07101e',
      color: '#e2e8f0',
      border: '1px solid #243b5e',
      borderRadius: '8px',
      fontSize: '13px',
    },
    '.cm-scroller': {
      minHeight: '116px',
      maxHeight: '220px',
      fontFamily: "var(--wb-mono, 'SF Mono', ui-monospace, monospace)",
      lineHeight: '1.5',
    },
    '.cm-gutters': {
      backgroundColor: '#0a1628',
      color: '#64748b',
      borderRight: '1px solid #1e3252',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(56, 189, 248, 0.08)',
    },
    '.cm-cursor': {
      borderLeftColor: '#38bdf8',
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      backgroundColor: '#0f1f38',
      border: '1px solid #243b5e',
      color: '#e2e8f0',
    },
  },
  { dark: true },
);

export function SqlEditor({ value, schema, onChange, onRun }: SqlEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const schemaCompRef = useRef<Compartment>(new Compartment());
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const initialValueRef = useRef(value);
  const initialSchemaRef = useRef(schema);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const schemaCompartment = schemaCompRef.current;
    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        autocompletion(),
        syntaxHighlighting(DEWPOND_SQL_HIGHLIGHT),
        DEWPOND_SQL_THEME,
        schemaCompartment.of(sql({ dialect: StandardSQL, schema: initialSchemaRef.current })),
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                onRunRef.current();
                return true;
              },
            },
          ]),
        ),
        keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.contentAttributes.of({ 'aria-label': 'DuckDB SQL editor' }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  const schemaKey = JSON.stringify(schema);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const parsedSchema = JSON.parse(schemaKey) as Record<string, string[]>;
    view.dispatch({
      effects: schemaCompRef.current.reconfigure(
        sql({ dialect: StandardSQL, schema: parsedSchema }),
      ),
    });
  }, [schemaKey]);

  return <div ref={hostRef} className="wb-cm-wrap" />;
}
