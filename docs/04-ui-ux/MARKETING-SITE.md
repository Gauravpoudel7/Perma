# MARKETING SITE: PERMA

## Page Structure

### 1. Hero Section
- **Visual**: A muted, high-contrast autoplay video loop (background). 
    - *Spec*: 1920x1080, grayscale or deep-blue filtered, showing abstract liquidity flows or trading terminal snippets.
    - *Poster*: High-res still of the product UI.
- **Copy** — strings are owned by [`COPY-DECK.md`](COPY-DECK.md) §3; do not author new ones here:
    - **Headline (Serif `Display`)**: "Perpetual options backed by Orca Whirlpool liquidity."
    - **Subheadline (Sans `Body LG`)**: "Open a short and PERMA adds concentrated liquidity to a SOL/USDC Whirlpool on your behalf. Longs pay a streaming premium against that liquidity. No expiry date, no settlement window."
    - **Banner**: the mandatory Prototype banner renders in the hero, not only the footer (`COPY-DECK.md` §1).
    - **CTA**: [Launch App] (High contrast white button).

### 2. The Thesis (The "Why")
- **Layout**: Split screen. Left: Large serif headline. Right: Concise bullet points.
- **Copy** (`COPY-DECK.md` §3 "Mechanism section"): "A short seller picks a price range and a size. PERMA deposits the matching SOL and USDC into the allowlisted Whirlpool as concentrated liquidity and records the position. A buyer can open a long only against short liquidity that already exists in that range, and pays premium continuously while the position is open. Closing settles accrued premium back into collateral; a short also gets back whatever Orca returns for its liquidity."

### 3. How It Works (The "Mechanism")
- **Interactive Diagram**: A simplified view of the Short $\rightarrow$ Long loop.
- **Steps**:
    1. **Provide**: Short a range $\rightarrow$ Add liquidity to Orca.
    2. **Utilize**: Long a range $\rightarrow$ Claim existing short liquidity.
    3. **Accrue**: Stream premium based on time and size.
    4. **Settle**: Close position $\rightarrow$ premium settled in cash.

### 4. Architecture Snapshot
- **Visual**: A clean, technical diagram showing the connection between `PERMA` $\rightarrow$ `Orca` $\rightarrow$ `Solana`.
- **Caption**: "Every short is a real Orca Whirlpool position. The `increaseLiquidityV2` CPI is visible on any Solana explorer."

### 5. FAQ & Legal
- **FAQ**: Focused on "What is a perpetual option?" and "How is solvency managed?".
- **Legal Footer**: 
    - "Prototype. Not audited. Single pool. Not production mainnet risk capital." (Bold, prominent).
    - Standard risk disclosures.

## UI/UX Requirements
- **Desktop**: Max-width 1440px, centered layout, generous white space.
- **Mobile**: Stacked sections, simplified "Trade" CTA, responsive navigation.
- **a11y**: Contrast ratio 4.5:1 minimum, full keyboard nav, ARIA labels on all interactive elements.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
