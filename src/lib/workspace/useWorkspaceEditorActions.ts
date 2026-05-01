import { useCallback } from "react";
import { format as formatSql } from "sql-formatter";
import type { ConnectionConfig } from "../db/DbClient";
import { toast } from "sonner";

interface ActiveTabLike {
  sql?: string;
  title?: string;
}

interface UseWorkspaceEditorActionsOptions {
  activeConnectionId: string | null;
  activeTab?: ActiveTabLike;
  connections: ConnectionConfig[];
  setEditorSql: (sql: string) => void;
}

export function useWorkspaceEditorActions({
  activeConnectionId,
  activeTab,
  connections,
  setEditorSql,
}: UseWorkspaceEditorActionsOptions) {
  const handleFormatSql = useCallback(() => {
    const sql = activeTab?.sql;
    if (!sql) return;

    const driver = connections.find((connection) => connection.id === activeConnectionId)?.driver ?? "postgresql";
    const dialect = driver === "mysql" || driver === "mariadb"
      ? "mysql"
      : driver === "mssql"
      ? "tsql"
      : driver === "sqlite"
      ? "sqlite"
      : driver === "clickhouse"
      ? "spark"
      : "postgresql";

    try {
      const formatted = formatSql(sql, {
        language: dialect,
        tabWidth: 4,
        keywordCase: "upper",
      });
      setEditorSql(formatted);
      toast.success("SQL formatted");
    } catch {
      toast.error("Could not format SQL");
    }
  }, [activeConnectionId, activeTab?.sql, connections, setEditorSql]);

  const handleSaveSql = useCallback(() => {
    const sql = activeTab?.sql;
    const title = activeTab?.title;
    if (!sql || !title) return;

    const blob = new Blob([sql], { type: "text/sql" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/\s+/g, "_")}.sql`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("SQL file saved");
  }, [activeTab?.sql, activeTab?.title]);

  const handleOpenFile = useCallback(async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".sql,.txt";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          if (!text) return;
          setEditorSql(text);
          toast.success(`Opened ${file.name}`);
        };
        reader.readAsText(file);
      };
      input.click();
    } catch {
      toast.error("File open failed");
    }
  }, [setEditorSql]);

  return {
    handleFormatSql,
    handleSaveSql,
    handleOpenFile,
  };
}
