"use client";

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";

/**
 * COMPONENT-LIBRARY.md §1 "PERMA Button": Primary = white bg/black text,
 * hover light gray. Secondary = transparent/white border/white text, hover
 * inverts. Danger = red bg/white text (Close/Withdraw-style destructive
 * actions). Radius 4px — "sharp, not rounded." 100ms linear transitions only.
 */
export function Button({
  variant = "primary",
  className = "",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    "transition-brand focus-ring inline-flex items-center justify-center rounded-md px-4 py-3 text-button disabled:cursor-not-allowed disabled:opacity-40";
  const variants: Record<Variant, string> = {
    primary: "bg-text-primary text-bg hover:bg-[#e5e5e5]",
    secondary:
      "border border-text-primary bg-transparent text-text-primary hover:bg-text-primary hover:text-bg",
    danger: "bg-danger text-text-primary hover:bg-[#dc2626]",
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      disabled={disabled}
      {...props}
    />
  );
}
