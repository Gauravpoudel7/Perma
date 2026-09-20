type BadgeTone = "neutral" | "warning" | "danger";

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: BadgeTone }) {
  const tones: Record<BadgeTone, string> = {
    neutral: "border-border text-text-muted",
    warning: "border-[#EF4444] text-danger",
    danger: "border-danger text-danger",
  };
  return (
    <span
      className={`text-overline inline-flex items-center rounded-sm border px-2 py-1 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
