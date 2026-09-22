import type { Config } from "tailwindcss";

// Every value here is a direct read of a CSS custom property defined in
// src/styles/tokens.css, which is itself a 1:1 transcription of
// docs/04-ui-ux/BRAND-SYSTEM.md. Do not add a color, radius, or shadow here
// that isn't in that file — that file is the source of truth, not this one.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        border: "var(--color-border)",
        "text-primary": "var(--color-text-primary)",
        "text-muted": "var(--color-text-muted)",
        accent: "var(--color-accent)",
        "accent-hover": "var(--color-accent-hover)",
        success: "var(--color-success)",
        danger: "var(--color-danger)",
        "danger-hover": "var(--color-danger-hover)",
        "solana-accent": "var(--color-solana-accent)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
        serif: ["var(--font-serif)"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        full: "var(--radius-full)",
      },
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        6: "var(--space-6)",
        8: "var(--space-8)",
        12: "var(--space-12)",
        16: "var(--space-16)",
      },
      transitionDuration: { DEFAULT: "100ms" },
      transitionTimingFunction: { DEFAULT: "linear" },
      // No boxShadow extension: BRAND-SYSTEM.md forbids soft/fuzzy shadows.
      // Surface definition is always a 1px border, never a shadow.
      boxShadow: {},
    },
  },
  plugins: [],
};

export default config;
