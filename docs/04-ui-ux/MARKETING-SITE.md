# MARKETING SITE: PERMA

## Page Structure

### 1. Hero Section
- **Visual**: A muted, high-contrast autoplay video loop (background). 
    - *Spec*: 1920x1080, grayscale or deep-blue filtered, showing abstract liquidity flows or trading terminal snippets.
    - *Poster*: High-res still of the product UI.
- **Copy**:
    - **Headline (Serif)**: "The New Standard for Volatility."
    - **Subheadline (Sans)**: "Perpetual options powered by Solana's most efficient concentrated liquidity. No expiries. No synthetic vaults. Just real liquidity."
    - **CTA**: [Launch App] (High contrast white button).

### 2. The Thesis (The "Why")
- **Layout**: Split screen. Left: Large serif headline. Right: Concise bullet points.
- **Copy**: "Options shouldn't be a guessing game with a Friday cliff. PERMA turns CLMM positions into a streaming volatility instrument. You provide the range; the protocol provides the precision."

### 3. How It Works (The "Mechanism")
- **Interactive Diagram**: A simplified view of the Short $\rightarrow$ Long loop.
- **Steps**:
    1. **Provide**: Short a range $\rightarrow$ Add liquidity to Orca.
    2. **Utilize**: Long a range $\rightarrow$ Claim existing short liquidity.
    3. **Accrue**: Stream premium based on time and size.
    4. **Settle**: Close position $\rightarrow$ Settle P&L.

### 4. Architecture Snapshot
- **Visual**: A clean, technical diagram showing the connection between `PERMA` $\rightarrow$ `Orca` $\rightarrow$ `Solana`.
- **Caption**: "Native integration with Orca Whirlpools ensures every option is backed by real, tradeable assets."

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
