/** COMPONENT-LIBRARY.md §2 "Data Tile (Metric Card)". */
export function DataTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-caption text-text-muted">{label}</p>
      <p className="text-metric-lg mt-1 text-text-primary">{value}</p>
      {hint && <p className="text-body-sm mt-1 text-text-muted">{hint}</p>}
    </div>
  );
}
