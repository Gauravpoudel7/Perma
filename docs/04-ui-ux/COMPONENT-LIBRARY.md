# COMPONENT LIBRARY: PERMA UI

## Component Specifications
All components follow the **Institutional Precision** brand system: solid surfaces, thin borders, no glassmorphism.

Pixel values below are the resolved sizes of [`BRAND-SYSTEM.md`](BRAND-SYSTEM.md) tokens — implement with the token, not the literal. Mapping: 11px = `overline`, 12px = `caption` / `mono-sm`, 14px = `body-md` / `button` / `mono-md`, 24px = `metric-lg`, 4px radius = `radius-md`.

### 1. The "PERMA Button"
- **Primary**: White BG, Black Text, Bold Sans. 
    - *Hover*: Light gray BG.
- **Secondary**: Transparent BG, White Border, White Text.
    - *Hover*: White BG, Black Text.
- **Danger**: Red BG, White Text.
    - *Usage*: "Close Position", "Withdraw".
- **Radius**: 4px (Sharp, not rounded).

### 2. Data Tile (Metric Card)
- **Surface**: `#141414`.
- **Border**: 1px `#262626`.
- **Layout**:
    - Label: 12px, Muted Gray, Sans.
    - Value: 24px, White, Sans (or Serif for key metrics).
- **Example**: "Required free USDC: 51.00 USDC" — a real computed amount, never a percentage (Fair MVP solvency reads no price, so a ratio would have to be invented; see [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)).

### 3. Range Slider (Tick Selector)
- **Track**: 4px height, `#262626`.
- **Handle**: 12px circle, White.
- **Active Range**: High-contrast white fill between handles.
- **Labels**: Tick values displayed in 12px monospace font above the handles.

### 4. Position Table
- **Header**: Muted gray, uppercase, 11px, Bold.
- **Row**: Border-bottom 1px `#262626`.
- **Typography**: Monospace for IDs and sizes; Sans for labels.
- **Status Colors** (Badge, not a P&L figure — no P&L instruction exists on-chain):
    - Open: neutral/muted.
    - Pending Premium: `#EF4444` — a short whose claim outran the range's escrow, carried
      until a long settles (see `08-burn-settle.md` §E).

### 5. Toast Notification
- **Position**: Bottom-right.
- **Style**: Solid black surface, 1px white left-border (for success) or red (for error).
- **Content**: Concise message + "View on Explorer" link.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
