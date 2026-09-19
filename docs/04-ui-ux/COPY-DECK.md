# COPY DECK: PERMA

Canonical source for every user-visible string. If copy appears in the app or on the marketing site and is not in this file, it is not approved. [`MARKETING-SITE.md`](MARKETING-SITE.md) and [`APP-SHELL.md`](APP-SHELL.md) render these strings; they do not define new ones.

**Product name:** PERMA · **Tagline:** Perpetual Options Powered by Solana Liquidity

---

## 1. The Prototype Banner — mandatory

```text
Prototype. Not audited. Single pool. Not production mainnet risk capital.
```

**This exact string, verbatim, is required on every screen and every marketing page.** No abbreviation, no paraphrase, no truncation on mobile, never behind a dismiss button, never collapsed into a tooltip.

| Property | Rule |
|---|---|
| Placement (app) | Persistent bar in the app shell, visible without scrolling on every route |
| Placement (marketing) | Hero section **and** footer of every page |
| Dismissible | No |
| Truncation | No — wrap to two lines on narrow viewports |
| Styling | `Caption` token, `Text Muted`, 1px top border. Never styled as decoration |

Enforced by [`RELEASE-GATE.md`](../06-testing/RELEASE-GATE.md) §Quality & Compliance and [`UI-QA-CHECKLIST.md`](UI-QA-CHECKLIST.md). Every screen block in §4 restates this requirement — it is not inherited by assumption.

---

## 2. Messaging Pillars

| Pillar | Claim | What backs it |
|---|---|---|
| **Real liquidity** | A PERMA short is an Orca Whirlpool position, not a synthetic exposure. | Every short CPIs `increase_liquidity_v2`; the position is verifiable on an explorer. |
| **No expiry** | Positions carry a streaming premium instead of an expiry date. | Premium accumulator in [`07-premium-engine.md`](../02-mvp-components/07-premium-engine.md). |
| **Inventory-capped** | A long can only be opened against short liquidity that already exists. | Enforced on-chain; rejects with `NoShortInventory`. |
| **Solvency-gated** | Mints and withdrawals are blocked when they would leave a position under-collateralized. | Checked on both paths per [`09-risk-solvency.md`](../02-mvp-components/09-risk-solvency.md). |

Every pillar states a mechanism that exists in the MVP. Do not add a pillar that the program does not enforce.

---

## 3. Marketing Copy

### Hero (Serif `Display`)

- **Primary:** "Perpetual options backed by Orca Whirlpool liquidity."
- **Alternate:** "Sell a price range. Collect premium for as long as you hold it."

### Sub-headlines (Sans `Body LG`)

- "Open a short and PERMA adds concentrated liquidity to a SOL/USDC Whirlpool on your behalf. Longs pay a streaming premium against that liquidity. No expiry date, no settlement window."
- "Every position is an on-chain Orca position. Check the transaction, not the marketing."
- "Devnet prototype. One allowlisted SOL/USDC pool. One leg per position."

### Mechanism section

> A short seller picks a price range and a size. PERMA deposits the matching SOL and USDC into the allowlisted Whirlpool as concentrated liquidity and records the position. A buyer can open a long only against short liquidity that already exists in that range, and pays premium continuously while the position is open. Closing settles accrued premium and P&L back into collateral.

### Honesty constraints

- **No TVL, APY, volume, or user-count figures.** Not projected, not illustrative, not greyed-out placeholders. The MVP has no history to quote.
- **No comparisons to named competitors.** Panoptic is a behavioral reference internally and is not named in user-facing copy.
- **Never** describe PERMA as audited, production-ready, or mainnet-ready.
- Premium figures shown in the UI are **estimates from current on-chain state** and must be labeled "Est." with the accrual basis stated.

---

## 4. Product UI Copy

Screens follow [`WIREFRAMES.md`](WIREFRAMES.md).

### 4.1 Trade

| Element | Copy |
|---|---|
| Header | "Open Position" |
| Market label | "SOL/USDC · Orca Whirlpool" |
| Range label | "Price Range" |
| Range helper | "Snapped to the pool's tick spacing. Your realized range may be slightly wider than requested." |
| Size label | "Position Size" |
| Side toggle | "Short (provide liquidity)" / "Long (buy against inventory)" |
| Premium preview | "Est. premium per hour, at the current rate" |
| Realized range readout | "Realized range: {low}–{high} USDC/SOL (ticks {lower} to {upper})" |
| Rent notice | "This range needs a new tick array. One-time cost: {amount} SOL, paid by you and not refundable while the range is in use." |
| CTA (short) | "Open Short" |
| CTA (long) | "Open Long" |
| Empty inventory | "No short liquidity in this range. A long needs existing short liquidity to open against." |
| Submitting | "Confirm in your wallet" |
| Success | "Position opened. View transaction" |

**Banner:** required, persistent.

### 4.2 Portfolio

| Element | Copy |
|---|---|
| Header | "Your Positions" |
| Columns | "Position" · "Side" · "Range" · "Size" · "P&L" · "Accrued Premium" |
| Premium column note | "Premium accrues continuously and settles when you close." |
| Row action | "Close" |
| Empty state | "No open positions. Open a short to provide liquidity, or a long to buy against existing short inventory." |
| Summary row | "Collateral" · "Locked" · "Available" · "Solvency Ratio" |
| Closing | "Settling premium and P&L…" |
| Closed | "Position closed. Premium and P&L settled to collateral. View transaction" |

**Banner:** required, persistent.

### 4.3 Collateral / Vault

| Element | Copy |
|---|---|
| Header | "Collateral" |
| Balance label | "Deposited" / "Locked by open positions" / "Available to withdraw" |
| Deposit CTA | "Deposit" |
| Withdraw CTA | "Withdraw" |
| Solvency block | "This withdrawal would leave an open position under-collateralized. Reduce the amount or close a position first." |
| Asset note | "SOL and USDC only. This market accepts no other collateral." |
| Success | "Deposit confirmed. View transaction" |

**Banner:** required, persistent.

### 4.4 Global states

| State | Copy |
|---|---|
| Wallet disconnected | "Connect a wallet to continue." |
| Wrong cluster | "PERMA runs on devnet. Switch your wallet's network to continue." |
| Market paused | "Trading is paused. Open positions can still be closed." |
| Transaction failed | "Transaction failed: {program error}. Nothing was changed. View transaction" |
| RPC unavailable | "Can't reach the network. Displayed values may be stale." |

Error toasts surface the **mapped PERMA error name** from [`ERROR-CATALOG.md`](../03-api-interfaces/ERROR-CATALOG.md), never a raw Anchor discriminant and never a generic "Something went wrong."

---

## 5. Banned Phrases

Grep-testable. A build failing this list fails the anti-slop gate in [`UI-QA-CHECKLIST.md`](UI-QA-CHECKLIST.md).

| Banned | Why |
|---|---|
| "The New Standard for …" | Claims category leadership a devnet prototype has not earned. |
| "Liquidity, Perpetualized" / any coined "-ized" abstraction | Describes nothing a user can act on. |
| "revolutionize", "unleash", "supercharge", "transform" | Hype verbs with no mechanism behind them. |
| "next-generation", "cutting-edge", "game-changing", "paradigm shift" | Filler. |
| "seamless", "effortless", "frictionless" | Signing a Solana transaction is none of these. |
| "institutional-grade", "professional-grade" | An unaudited single-pool prototype is neither. |
| "No Friday stress" / expiry jokes | Trading-desk in-joke; says nothing about the product. |
| "trustless", "fully decentralized" | Overclaims for a system with an admin pause and an allowlist. |
| "battle-tested", "secure by design", "bank-grade" | Directly contradicts "Not audited." |
| "simply", "just", "easy" (as difficulty claims) | Minimizes real financial risk. |
| Em-dash-heavy triads ("fast — safe — simple") | Recognizable generated-copy cadence. |

**Rule of replacement:** state what the software does and what it costs. "Perpetual options backed by Orca Whirlpool liquidity" survives because each noun is checkable on-chain.

---

## 6. Terminology

| Use | Not |
|---|---|
| Whirlpool, Orca Whirlpool | "the pool", "the AMM", "Uniswap-style pool" |
| tick, tick range, tick spacing | "price bucket", "band" |
| concentrated liquidity | "deep liquidity", "liquidity layer" |
| streaming premium | "yield", "APY", "rewards" |
| collateral | "margin" (until a true margin system exists), "stake" |
| short / long | "sell side" / "buy side" |
| devnet | "testnet", "beta" |

"Yield" and "rewards" are specifically banned: premium is a payment from a long to a short, not a protocol emission.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
