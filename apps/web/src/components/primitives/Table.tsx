/**
 * COMPONENT-LIBRARY.md §4 "Position Table": overline uppercase headers,
 * 1px border-bottom rows, mono for numeric/ID columns (applied by callers
 * per-cell, not globally — Side/Status stay sans).
 */
export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  );
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return <thead>{children}</thead>;
}

export function TableHeaderCell({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-overline whitespace-nowrap px-4 py-3 text-text-muted">
      {children}
    </th>
  );
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TableRow({ children }: { children: React.ReactNode }) {
  return <tr className="border-t border-border">{children}</tr>;
}

export function TableCell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-body-md ${className}`}>{children}</td>;
}
