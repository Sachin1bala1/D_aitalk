/**
 * TableContextMenu — right-click menu for sidebar table rows.
 *
 * Renders as a fixed-position overlay at the cursor coordinates so it
 * escapes any overflow:hidden containers. Closes on click-outside or Escape.
 */
import React, { useEffect, useRef } from "react";
import {
  Play,
  Clipboard,
  RefreshCw,
  Trash2,
  PlusSquare,
  FileText,
  Hash,
  Code2,
  Zap,
  Archive,
  RotateCcw,
  Wrench,
} from "lucide-react";

export interface TableContextMenuProps {
  x: number;
  y: number;
  tableName: string;
  schemaName: string;
  driver?: string;
  onClose: () => void;
  onSelectAll: () => void;
  onInsertTemplate: () => void;
  onCopyTableName: () => void;
  onCopySchema: () => void;
  onExplain: () => void;
  onCountRows: () => void;
  onRefreshSchema: () => void;
  onDropTable: () => void;
  onViewDdl?: () => void;
  onRunSql?: (sql: string, description: string) => void;
}

export function TableContextMenu({
  x,
  y,
  tableName,
  schemaName,
  driver,
  onClose,
  onSelectAll,
  onInsertTemplate,
  onCopyTableName,
  onCopySchema,
  onExplain,
  onCountRows,
  onRefreshSchema,
  onDropTable,
  onViewDdl,
  onRunSql,
}: TableContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const isPostgres = driver === "postgres" || driver === "timescaledb";

  // Close on click-outside or Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  const menuWidth = 240;
  const menuHeight = isPostgres ? 360 : 260;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  const Item = ({
    icon: Icon,
    label,
    onClick,
    variant = "default",
    shortcut,
    sublabel,
  }: {
    icon: React.FC<{ className?: string }>;
    label: string;
    onClick: () => void;
    variant?: "default" | "destructive" | "warning";
    shortcut?: string;
    sublabel?: string;
  }) => (
    <button
      onClick={() => { onClick(); onClose(); }}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors rounded ${
        variant === "destructive"
          ? "text-red-400/70 hover:bg-red-500/10 hover:text-red-400"
          : variant === "warning"
          ? "text-amber-400/70 hover:bg-amber-500/10 hover:text-amber-400"
          : "text-white/60 hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <span>{label}</span>
        {sublabel && <p className="text-[9px] text-white/25 font-mono mt-0.5">{sublabel}</p>}
      </div>
      {shortcut && <span className="text-[10px] text-white/20 font-mono shrink-0">{shortcut}</span>}
    </button>
  );

  const Divider = () => <div className="my-1 border-t border-[#262626]" />;
  const Section = ({ label }: { label: string }) => (
    <p className="px-3 pt-1.5 pb-0.5 text-[8px] uppercase tracking-widest text-white/20 font-bold">{label}</p>
  );

  const qual = `"${schemaName}"."${tableName}"`;

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-[#141414] border border-[#2a2a2a] rounded-lg shadow-2xl py-1.5 select-none"
      style={{ left: clampedX, top: clampedY, width: menuWidth }}
    >
      {/* Header */}
      <div className="px-3 py-1.5 mb-1 border-b border-[#262626]">
        <p className="text-[10px] text-white/30 uppercase tracking-widest">Table</p>
        <p className="text-xs text-[#00d2ff] font-mono font-semibold truncate">{schemaName}.{tableName}</p>
        {driver && <p className="text-[9px] text-white/20 font-mono mt-0.5">{driver}</p>}
      </div>

      <Section label="Query" />
      <Item icon={Play} label="SELECT * (LIMIT 100)" onClick={onSelectAll} shortcut="dbl-click" />
      <Item icon={Hash} label="COUNT(*) rows" onClick={onCountRows} />
      <Item icon={PlusSquare} label="INSERT template" onClick={onInsertTemplate} />
      <Item icon={FileText} label="EXPLAIN last query" onClick={onExplain} />
      {onViewDdl && <Item icon={Code2} label="View DDL" onClick={onViewDdl} />}

      <Divider />
      <Section label="Copy" />
      <Item icon={Clipboard} label="Copy table name" onClick={onCopyTableName} />
      <Item icon={Clipboard} label="Copy qualified name" onClick={onCopySchema} />
      <Item icon={RefreshCw} label="Refresh schema" onClick={onRefreshSchema} />

      {isPostgres && onRunSql && (
        <>
          <Divider />
          <Section label="Maintenance (PostgreSQL)" />
          <Item
            icon={Zap}
            label="VACUUM ANALYZE"
            sublabel="Reclaim storage + update stats"
            onClick={() => onRunSql(`VACUUM ANALYZE ${qual}`, `VACUUM ANALYZE ${tableName}`)}
          />
          <Item
            icon={Archive}
            label="VACUUM FULL"
            sublabel="Full rewrite (locks table)"
            variant="warning"
            onClick={() => onRunSql(`VACUUM FULL ${qual}`, `VACUUM FULL ${tableName}`)}
          />
          <Item
            icon={RotateCcw}
            label="REINDEX TABLE"
            sublabel="Rebuild all indexes"
            onClick={() => onRunSql(`REINDEX TABLE ${qual}`, `REINDEX ${tableName}`)}
          />
          <Item
            icon={Wrench}
            label="CLUSTER"
            sublabel="Reorder rows by index"
            onClick={() => onRunSql(`CLUSTER ${qual}`, `CLUSTER ${tableName}`)}
          />
        </>
      )}

      <Divider />
      <Item
        icon={Trash2}
        label={`TRUNCATE ${tableName}`}
        onClick={() => onRunSql ? onRunSql(`TRUNCATE ${qual}`, `TRUNCATE ${tableName}`) : undefined}
        variant="destructive"
      />
      <Item
        icon={Trash2}
        label={`DROP TABLE ${tableName}`}
        onClick={onDropTable}
        variant="destructive"
      />
    </div>
  );
}
