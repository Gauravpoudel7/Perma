# MOTION VIDEO SPEC: PERMA

## Cinematic Direction
The motion design should feel **calm, precise, and high-end**. Avoid "hyper-active" trading animations. Focus on smooth transitions and mathematical elegance.

## Hero Loop (Marketing Site)
- **Dimensions**: 1920x1080 (Main) + 1080x1080 (Social).
- **Visuals**: 
    - A dark, monochromatic environment.
    - Abstract representation of "Liquidity Ranges" as clean, horizontal white lines.
    - As price moves (a vertical line), the ranges "light up" or "dim" based on the la/short logic.
    - Occasional, sharp typography overlays: "PRECISION", "PERPETUAL", "SOLANA".
- **Style**: 24fps, slight motion blur, deep blacks, high contrast.
- **Loop**: Seamless 15-second loop.

## Micro-interactions (App)
- **Position Open**: The "Trade" button transforms into a loading spinner $\rightarrow$ transitions into a "Success" checkmark $\rightarrow$ the position slides into the portfolio table.
- **Premium Accrual**: Numbers in the "Premium Earned" column increment smoothly (counter animation) every few seconds.
- **Range Adjustment**: As the user drags the tick sliders, the "Collateral Required" number updates in real-time with a subtle fade effect.
- **Error State**: A subtle, red shake animation on the action button if solvency is breached.

## Technical Requirements
- **Format**: MP4 (H.264) + WebM for browser compatibility.
- **Fallback**: Static high-res PNG poster image for slow connections.
- **Performance**: Hardware-accelerated CSS transforms; no heavy JS-based particle libraries.
- **a11y**: Respect `prefers-reduced-motion` by disabling all non-essential animations.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
