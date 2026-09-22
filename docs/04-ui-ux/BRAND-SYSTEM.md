# BRAND SYSTEM: PERMA

## Visual Thesis
PERMA's design language is **"Institutional Precision"**. It avoids the generic "Web3" aesthetic (neon gradients, floating glass cards, purple la theme) in favor of a high-contrast, editorial look inspired by Coinbase Institutional, Linear, and Vercel.

The goal is to communicate **trust, stability, and mathematical accuracy**.

## Typography

Root font size is **16px**; `1rem = 16px`. Every role below is a token with a fixed size — there is no "small/regular/large" sizing. Use the token name in code, never a raw pixel value.

### Font stacks

| Stack | Token | Family + fallbacks |
|---|---|---|
| Editorial Serif | `--font-serif` | `"Fraunces", "Playfair Display", ui-serif, Georgia, "Times New Roman", serif` |
| Product Sans | `--font-sans` | `"Inter", "Geist Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif` |
| Numeric Mono | `--font-mono` | `"Geist Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace` |

**Serif is for marketing surfaces and hero metrics only.** Product UI is sans; data is mono. Never set a data table, form label, or button in serif.

### Type scale

| Token | Family | Weight | Size (rem / px) | Line-height | Letter-spacing | Usage |
|---|---|---|---|---|---|---|
| `display` | Serif | 700 | `3.5rem` / 56px | 1.05 | `-0.02em` | Marketing hero headline only |
| `h1` | Serif | 700 | `2.5rem` / 40px | 1.15 | `-0.02em` | Marketing section headers |
| `h2` | Sans | 600 | `2rem` / 32px | 1.2 | `-0.015em` | App page titles |
| `h3` | Sans | 600 | `1.5rem` / 24px | 1.3 | `-0.01em` | Card and panel headers |
| `h4` | Sans | 600 | `1.125rem` / 18px | 1.4 | `-0.005em` | Sub-sections, modal titles |
| `body-lg` | Sans | 400 | `1rem` / 16px | 1.6 | `0` | Marketing body, sub-headlines |
| `body-md` | Sans | 400 | `0.875rem` / 14px | 1.5 | `0` | **Default product UI text**, form labels |
| `body-sm` | Sans | 400 | `0.8125rem` / 13px | 1.5 | `0` | Secondary/helper text |
| `caption` | Sans | 400 | `0.75rem` / 12px | 1.4 | `0.01em` | Muted labels, the Prototype banner |
| `overline` | Sans | 700 | `0.6875rem` / 11px | 1.3 | `0.08em` | Table headers, uppercase eyebrows |
| `button` | Sans | 600 | `0.875rem` / 14px | 1 | `0.005em` | All button labels |
| `metric-lg` | Sans | 600 | `1.5rem` / 24px | 1.2 | `-0.01em` | Data-tile primary values |
| `metric-hero` | Serif | 700 | `2.5rem` / 40px | 1.1 | `-0.02em` | Marketing key metrics only |
| `mono-md` | Mono | 400 | `0.875rem` / 14px | 1.5 | `0` | Position IDs, sizes, amounts |
| `mono-sm` | Mono | 400 | `0.75rem` / 12px | 1.4 | `0` | Tick values, addresses, tx signatures |

**Numeric rule:** every token rendering a number that shares a column or updates live — `metric-lg`, `metric-hero`, `mono-md`, `mono-sm`, and any P&L or premium value — sets `font-variant-numeric: tabular-nums`. Without it, digits change width and live values jitter.

`overline` is always `text-transform: uppercase`. No other token is.

### Responsive

Only `display` and `h1` scale down; everything else holds its size, because product UI is dense by design.

| Token | ≥1024px | <1024px | <640px |
|---|---|---|---|
| `display` | 56px | 40px | 32px |
| `h1` | 40px | 32px | 28px |

## Spacing & Radius

### Spacing scale (4px base)

| Token | Value | Usage |
|---|---|---|
| `space-1` | `0.25rem` / 4px | Icon-to-label gap |
| `space-2` | `0.5rem` / 8px | Tight internal padding |
| `space-3` | `0.75rem` / 12px | Button padding (vertical), table cell padding |
| `space-4` | `1rem` / 16px | Default element gap, card padding |
| `space-6` | `1.5rem` / 24px | Card padding (comfortable), gap between panels |
| `space-8` | `2rem` / 32px | Section gap within a page |
| `space-12` | `3rem` / 48px | Major section separation |
| `space-16` | `4rem` / 64px | Marketing section padding (desktop) |

All values are multiples of 4px; 8px increments above `space-4`. Never use an off-scale value.

### Radius tokens

| Token | Value | Usage |
|---|---|---|
| `radius-sm` | `2px` | Badges, inline tags |
| `radius-md` | `4px` | **Default** — buttons, inputs, cards |
| `radius-lg` | `8px` | Modals, toasts |
| `radius-full` | `9999px` | Range-slider handles only |

`radius-md` at 4px matches the button spec in [`COMPONENT-LIBRARY.md`](COMPONENT-LIBRARY.md). Nothing in PERMA uses a radius above 8px — rounded pill cards read as consumer-app, against the visual thesis.

### Border & focus

| Token | Value |
|---|---|
| `border-width` | `1px` (the only width used) |
| `focus-ring` | `2px` solid `#FFFFFF`, `2px` offset |

## Color Palette (Tokenized)

### Core Neutrals
- **Background**: `#0A0A0A` (Pure deep black, not charcoal).
- **Surface**: `#141414` (Slightly lifted surface for cards).
- **Border**: `#262626` (Subtle division).
- **Text Primary**: `#FFFFFF` (Pure white).
- **Text Muted**: `#A1A1AA` (Cool gray).

### Semantic Accents
- **Accent**: `#FFFFFF` (White on black high-contrast).
- **Accent Hover**: `#E5E5E5` (Primary button hover only).
- **Success**: `#10B981` (Emerald - used sparingly for P&L positive).
- **Danger**: `#EF4444` (Red - used for P&L negative and solvency warnings).
- **Danger Hover**: `#DC2626` (Danger button hover only).
- **Solana Accent**: `#14F195` (Mint - used ONLY for blockchain-specific markers, not as a primary brand color).

## UI Principles

### 1. Anti-Slop Guidelines
- **No Glassmorphism**: No semi-transparent blurred backgrounds. Use solid surfaces with thin borders.
- **No Generic Gradients**: No purple-to-blue "AI" gradients. Use monochromatic scales or stark contrast.
- **No Soft Shadows**: Use a 1px border instead of a fuzzy drop shadow.
- **No Midjourney Hero Mush**: No abstract 3D shapes. Use clean typography and high-quality cinematic video/code snippets.

### 2. Interaction Model
- **Micro-interactions**: Subtle 100ms transitions on hover.
- **Focus**: High contrast focus rings for a11y.
- **Motion**: Calm, linear translations. No "bounce" or "particle spam".

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
