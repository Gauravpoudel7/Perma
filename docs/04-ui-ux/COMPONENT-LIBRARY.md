# COMPONENT LIBRARY: PERMA UI

## Component Specifications
All components follow the **Institutional Precision** brand system: solid surfaces, thin borders, no glassmorphism.

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
- **Example**: "Current Solvency: 142%".

### 3. Range Slider (Tick Selector)
- **Track**: 4px height, `#262626`.
- **Handle**: 12px circle, White.
- **Active Range**: High-contrast white fill between handles.
- **Labels**: Tick values displayed in 12px monospace font above the handles.

### 4. Position Table
- **Header**: Muted gray, uppercase, 11px, Bold.
- **Row**: Border-bottom 1px `#262626`.
- **Typography**: Monospace for IDs and sizes; Sans for labels.
- **P&L Colors**: 
    - Positive: `#10B981`.
    - Negative: `#EF4444`.

### 5. Toast Notification
- **Position**: Bottom-right.
- **Style**: Solid black surface, 1px white left-border (for success) or red (for error).
- **Content**: Concise message + "View on Explorer" link.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
