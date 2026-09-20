"use client";

import type { InputHTMLAttributes } from "react";

/** Mono numeric input — BRAND-SYSTEM.md: "Precision: monospace for all numeric values." */
export function NumberInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="text"
      inputMode="decimal"
      className={`transition-brand focus-ring text-mono-md tabular-nums w-full rounded-md border border-border bg-bg px-3 py-3 text-text-primary placeholder:text-text-muted ${className}`}
      {...props}
    />
  );
}
