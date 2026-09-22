---
name: perma-brand-lock
description: Use this when editing PERMA apps/web UI. Enforces Institutional Precision brand tokens and anti-slop rules from docs/04-ui-ux/BRAND-SYSTEM.md.
---

# PERMA Brand Lock

Read and obey `docs/04-ui-ux/BRAND-SYSTEM.md` and `apps/web/src/styles/tokens.css`.

## Required

- Background `#0A0A0A`, surface `#141414`, border `#262626`, text white / muted `#A1A1AA`.
- Radius ≤ 8px (`radius-md` 4px default). Borders define surfaces — no soft shadows.
- Product UI = sans + mono for numbers. Serif only if explicitly marketing (out of apps/web scope).
- Live numbers: `font-variant-numeric: tabular-nums` via mono/metric tokens.
- Motion: ≤100ms linear; respect `prefers-reduced-motion`.
- Solana mint `#14F195` only for chain markers — never primary chrome.

## Forbidden (reject / rewrite)

- Glassmorphism, backdrop-blur, purple/blue AI gradients, fuzzy shadows.
- Default shadcn “card grid” look, Inter-as-personality, Space Grotesk, generic SaaS kits.
- Radius > 8px, bounce animations, particle effects.
- Changing token values without updating BRAND-SYSTEM.md in the same PR.

