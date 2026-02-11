import { useState } from "react";

interface CanvasProps {
  type: "table" | "chart" | "json";
  data: unknown;
  title?: string;
}

export default function Canvas({ type, data, title }: CanvasProps) {
  const [expanded, setExpanded] = useState(false);

  const renderTable = () => {
    if (!Array.isArray(data) || data.length === 0) {
      return (
        <div className="text-sm text-batcave-text-muted p-4">No data</div>
      );
    }

    const headers = Object.keys(data[0] as Record<string, unknown>);

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-batcave-border">
              {headers.map((h) => (
                <th
                  key={h}
                  className="text-left px-3 py-2 text-xs font-medium text-batcave-text-muted uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data as Record<string, unknown>[]).map((row, i) => (
              <tr
                key={i}
                className="border-b border-batcave-border/50 hover:bg-batcave-hover"
              >
                {headers.map((h) => (
                  <td key={h} className="px-3 py-2 text-batcave-text">
                    {String(row[h] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderChart = () => {
    // Simple bar chart visualization
    if (!Array.isArray(data)) return null;

    const maxVal = Math.max(
      ...(data as Array<{ value: number }>).map((d) => d.value || 0)
    );

    return (
      <div className="flex items-end gap-2 h-40 px-4 py-2">
        {(data as Array<{ label: string; value: number }>).map((d, i) => (
          <div key={i} className="flex flex-col items-center gap-1 flex-1">
            <div
              className="w-full bg-batcave-accent/60 rounded-t transition-all hover:bg-batcave-accent"
              style={{
                height: `${maxVal > 0 ? (d.value / maxVal) * 100 : 0}%`,
                minHeight: "4px",
              }}
            />
            <span className="text-xs text-batcave-text-muted truncate max-w-full">
              {d.label}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const renderJson = () => (
    <pre className="text-xs text-batcave-text font-mono p-4 overflow-auto max-h-96">
      {JSON.stringify(data, null, 2)}
    </pre>
  );

  return (
    <div className="card overflow-hidden">
      {title && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-batcave-border">
          <h4 className="text-sm font-medium text-batcave-text">{title}</h4>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-batcave-text-muted hover:text-batcave-text transition-colors"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      )}

      <div className={expanded ? "" : "max-h-64 overflow-hidden"}>
        {type === "table" && renderTable()}
        {type === "chart" && renderChart()}
        {type === "json" && renderJson()}
      </div>
    </div>
  );
}
