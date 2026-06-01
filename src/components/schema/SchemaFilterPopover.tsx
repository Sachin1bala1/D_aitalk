import React, { useRef, useEffect } from "react";

interface Props {
  open: boolean;
  allSchemas: string[];        // all schemas discovered in last introspect
  visibleSchemas: string[];    // currently visible schemas
  onChange: (schemas: string[]) => void;
  onClose: () => void;
}

export function SchemaFilterPopover({
  open,
  allSchemas,
  visibleSchemas,
  onChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (schema: string) => {
    const next = visibleSchemas.includes(schema)
      ? visibleSchemas.filter((s) => s !== schema)
      : [...visibleSchemas, schema];
    onChange(next);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Filter visible schemas"
      className="absolute top-8 right-2 z-50 w-52 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-xl py-2"
    >
      <p className="text-[10px] text-white/30 uppercase tracking-wider px-3 pb-1.5 border-b border-[#2a2a2a] mb-1">
        Schemas
      </p>

      <div className="max-h-48 overflow-y-auto">
        {allSchemas.map((schema) => {
          const checked = visibleSchemas.includes(schema);
          return (
            <label
              key={schema}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/5 transition-colors"
            >
              <input
                type="checkbox"
                data-schema={schema}
                checked={checked}
                onChange={() => toggle(schema)}
                className="w-3 h-3 accent-[#00d2ff]"
              />
              <span className="text-xs text-white/70 flex-1 truncate font-mono">{schema}</span>
            </label>
          );
        })}
      </div>

      {allSchemas.length === 0 && (
        <p className="text-[10px] text-white/30 px-3 py-2 text-center">No schemas found</p>
      )}

      <div className="flex gap-2 px-3 pt-2 mt-1 border-t border-[#2a2a2a]">
        <button
          onClick={() => onChange(["public"])}
          className="flex-1 text-[10px] text-white/40 hover:text-white py-1 hover:bg-white/5 rounded transition-colors"
        >
          Public only
        </button>
        <button
          onClick={() => onChange(allSchemas)}
          className="flex-1 text-[10px] text-white/40 hover:text-white py-1 hover:bg-white/5 rounded transition-colors"
        >
          Show all
        </button>
      </div>
    </div>
  );
}
