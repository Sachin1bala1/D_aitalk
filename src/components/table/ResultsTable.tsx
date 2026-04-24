import React from "react";

interface ResultsTableProps {
  results: {
    rows: any[];
    fields: any[];
  } | null;
}

export function ResultsTable({ results }: ResultsTableProps) {
  if (!results) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/10 gap-4 technical-grid">
        <div className="text-4xl font-serif italic">No Data</div>
        <p className="text-xs uppercase tracking-widest">Execute a query to see results</p>
      </div>
    );
  }

  if (results.rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/30 text-sm font-mono">
        Query returned 0 rows.
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto">
      <table className="data-table">
        <thead>
          <tr>
            {results.fields.map((field) => (
              <th key={field.name}>{field.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.rows.map((row, i) => (
            <tr key={i} className="data-row">
              {results.fields.map((field) => (
                <td key={field.name}>
                  {row[field.name] === null ? (
                    <span className="text-white/20 italic">null</span>
                  ) : typeof row[field.name] === "object" ? (
                    JSON.stringify(row[field.name])
                  ) : (
                    row[field.name].toString()
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
