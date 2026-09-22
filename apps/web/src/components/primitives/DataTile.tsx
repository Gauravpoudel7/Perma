import type { ReactNode } from "react";

/**
 * COMPONENT-LIBRARY.md §2 "Data Tile (Metric Card)". `tone` sets the value's
 * weight in a group of tiles: the figures a trader acts on are primary
 * (white), the rest muted. `action` is a quiet link under the hint.
 */
export function DataTile({
  label,
  value,
  hint,
  hintClassName = "",
  tone = "primary",
  action,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  hintClassName?: string;
  tone?: "primary" | "muted";
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-caption text-text-muted">{label}</p>
      <p className={`text-metric-lg mt-1 ${tone === "primary" ? "text-text-primary" : "text-text-muted"}`}>{value}</p>
      {hint && <p className={`text-body-sm mt-1 text-text-muted ${hintClassName}`}>{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
