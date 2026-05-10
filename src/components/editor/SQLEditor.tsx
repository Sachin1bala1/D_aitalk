import React, { useRef, useEffect } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { format } from "sql-formatter";
import type { FullSchema } from "../../lib/db/DbClient";

interface SQLEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  onExecuteSelected?: (sql: string) => void;
  schema?: FullSchema | null;
  /** Column names from the most recent result set — offered as completions everywhere. */
  resultColumns?: string[];
}

// Keywords that indicate a table name follows
const TABLE_KEYWORDS = /\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+$/i;
// Keywords that indicate column access (table. prefix)
const COLUMN_DOT = /(\w+)\.\s*$/;

let _completionDisposable: { dispose: () => void } | null = null;

interface TableEntry {
  label: string;
  kind: number;
  detail: string;
  insertText: string;
}

function registerCompletions(monaco: Monaco, schema: FullSchema | null | undefined, resultColumns?: string[]) {
  _completionDisposable?.dispose();
  _completionDisposable = null;

  if (!schema) return;

  const tableEntries: TableEntry[] = [];
  const colMap: Record<string, string[]> = {};

  for (const tbl of schema.tables) {
    const bare = tbl.name;
    const qualified = `${tbl.schema}.${tbl.name}`;
    const cols = schema.columns[bare] ?? schema.columns[qualified] ?? [];

    tableEntries.push({
      label: bare,
      kind: monaco.languages.CompletionItemKind.Class,
      detail: `${tbl.schema} · ${tbl.object_type}`,
      insertText: `"${bare}"`,
    });

    tableEntries.push({
      label: qualified,
      kind: monaco.languages.CompletionItemKind.Class,
      detail: tbl.object_type,
      insertText: `"${tbl.schema}"."${bare}"`,
    });

    colMap[bare] = cols.map((c) => c.name);
    colMap[qualified] = cols.map((c) => c.name);
  }

  _completionDisposable = monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [" ", "."],
    provideCompletionItems(
      model: MonacoEditor.ITextModel,
      position: import("monaco-editor").Position
    ) {
      const lineUpto = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: position.column,
      };

      // Dot access: <tableName>.<cursor> → suggest columns
      const dotMatch = lineUpto.match(COLUMN_DOT);
      if (dotMatch) {
        const tableName = dotMatch[1];
        const cols = colMap[tableName] ?? [];
        if (cols.length > 0) {
          return {
            suggestions: cols.map((col) => ({
              label: col,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: tableName,
              insertText: `"${col}"`,
              range,
            })),
          };
        }
      }

      // After FROM / JOIN / etc → suggest tables
      if (TABLE_KEYWORDS.test(lineUpto)) {
        return {
          suggestions: tableEntries.map((entry) => ({ ...entry, range })),
        };
      }

      // Always offer result-set column names (from last query)
      if (resultColumns && resultColumns.length > 0 && word.word.length >= 1) {
        return {
          suggestions: resultColumns.map((col) => ({
            label: col,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: "result column",
            insertText: `"${col}"`,
            range,
            sortText: `z_${col}`, // sort after schema suggestions
          })),
        };
      }

      return { suggestions: [] };
    },
  });
}

export function SQLEditor({ value, onChange, onExecute, onExecuteSelected, schema, resultColumns }: SQLEditorProps) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // Re-register completions whenever schema or result columns change
  useEffect(() => {
    if (monacoRef.current) {
      registerCompletions(monacoRef.current, schema, resultColumns);
    }
  }, [schema, resultColumns]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { _completionDisposable?.dispose(); };
  }, []);

  const handleEditorChange = (val: string | undefined) => {
    if (val !== undefined) onChange(val);
  };

  const handleFormat = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const sql = editor.getValue();
    try {
      const formatted = format(sql, { language: "sql", tabWidth: 2, keywordCase: "upper" });
      editor.setValue(formatted);
      onChange(formatted);
    } catch {
      // If formatting fails (e.g., incomplete SQL), leave as-is
    }
  };

  const handleMount = (editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Register completions with the schema available at mount time
    registerCompletions(monaco, schema, resultColumns);

    // Ctrl/Cmd+Enter → execute full SQL
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onExecute();
    });

    // Ctrl+Shift+Enter → execute selected SQL (or full if no selection)
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => {
        const sel = editor.getSelection();
        const model = editor.getModel();
        if (sel && model && !sel.isEmpty()) {
          const selectedSql = model.getValueInRange(sel).trim();
          if (selectedSql) {
            onExecuteSelected ? onExecuteSelected(selectedSql) : onExecute();
            return;
          }
        }
        onExecute();
      }
    );

    // Shift+Alt+F → format SQL
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
      handleFormat
    );
  };

  return (
    <div className="h-full w-full relative group">
      <Editor
        height="100%"
        defaultLanguage="sql"
        theme="vs-dark"
        value={value}
        onChange={handleEditorChange}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: "'JetBrains Mono', monospace",
          lineNumbers: "on",
          roundedSelection: false,
          scrollBeyondLastLine: false,
          readOnly: false,
          automaticLayout: true,
          padding: { top: 16, bottom: 16 },
          suggestOnTriggerCharacters: true,
          quickSuggestions: { other: true, strings: true, comments: false },
        }}
        onMount={handleMount}
      />
      {/* Format button — appears on hover in top-right of editor */}
      <button
        onClick={handleFormat}
        className="absolute top-2 right-4 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] text-white/25 hover:text-white/60 bg-[#1e1e1e] border border-[#333] rounded px-2 py-0.5 font-mono"
        title="Format SQL (Shift+Alt+F)"
      >
        FORMAT
      </button>
    </div>
  );
}
