import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

export type AppPanel =
  | "history"
  | "agent"
  | "erd"
  | "snippets"
  | "search"
  | "sessions"
  | "overview";

interface UseAppShellUiOptions {
  onStop: () => Promise<void>;
  setEditorSql: (sql: string) => void;
}

export function useAppShellUi({ onStop, setEditorSql }: UseAppShellUiOptions) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [activePanel, setActivePanel] = useState<AppPanel>("agent");
  const [inTransaction, setInTransaction] = useState(false);
  const [autoCommit, setAutoCommit] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [fileImportOpen, setFileImportOpen] = useState(false);
  const [ddlModal, setDdlModal] = useState<{
    schema: string;
    table: string;
    customQuery?: string;
    title?: string;
    subtitle?: string;
  } | null>(null);
  const [editorPct, setEditorPct] = useState(45);
  const splitDragging = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [bindParams, setBindParams] = useState<{ open: boolean; sql: string } | null>(null);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);

  const handleStopWithToast = useCallback(async () => {
    await onStop();
    toast.info("Query cancelled");
  }, [onStop]);

  const handleInsertTemplate = useCallback(
    (tableName: string, columns: { name: string; type: string }[]) => {
      const cols = columns.map((c) => `"${c.name}"`).join(", ");
      const vals = columns.map(() => "NULL").join(", ");
      const sql = `INSERT INTO "${tableName}" (${cols})\nVALUES (${vals});`;
      setEditorSql(sql);
      toast.success("INSERT template loaded into editor");
    },
    [setEditorSql]
  );

  const handleCountRows = useCallback(
    (tableName: string) => {
      setEditorSql(`SELECT COUNT(*) AS row_count FROM "${tableName}";`);
    },
    [setEditorSql]
  );

  const handleDropTable = useCallback(
    (schema: string, tableName: string) => {
      const sql = `DROP TABLE "${schema}"."${tableName}";`;
      setEditorSql(sql);
      toast.warning("DROP TABLE loaded — review and Run to execute");
    },
    [setEditorSql]
  );

  const toggleAutoCommit = useCallback(() => {
    setAutoCommit((value) => {
      const next = !value;
      if (value) {
        setInTransaction(false);
      }
      return next;
    });
  }, []);

  return {
    isConnecting,
    setIsConnecting,
    activePanel,
    setActivePanel,
    inTransaction,
    setInTransaction,
    autoCommit,
    toggleAutoCommit,
    shortcutsOpen,
    setShortcutsOpen,
    fileImportOpen,
    setFileImportOpen,
    ddlModal,
    setDdlModal,
    editorPct,
    setEditorPct,
    splitDragging,
    splitContainerRef,
    bindParams,
    setBindParams,
    quickOpenOpen,
    setQuickOpenOpen,
    handleStopWithToast,
    handleInsertTemplate,
    handleCountRows,
    handleDropTable,
  };
}
