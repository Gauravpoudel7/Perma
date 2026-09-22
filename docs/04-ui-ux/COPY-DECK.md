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
| **Fully collateralized shorts** | A short's collateral is locked for exactly what Orca took, and stays locked until the position closes. | Enforced on-chain; `unlock` refused while a short is open (`PositionsOutstanding`). *(A "solvency-gated" pillar is reserved for when [component 09](../02-mvp-components/09-risk-solvency.md) ships — do not use it before then.)* |

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

> A short seller picks a price range and a size. PERMA deposits the matching SOL and USDC into the allowlisted Whirlpool as concentrated liquidity and records the position. A buyer can open a long only against short liquidity that already exists in that range, and pays premium continuously while the position is open. Closing settles accrued premium back into collateral; a short also gets back whatever Orca returns for its liquidity.

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
| Range presets | "Around spot" · chips "±8" / "±32" / "±128" (tick spacings — never "ATM"/"ITM"; a range has no strike) |
| Disabled reason (visible above the CTA) | "Enter a position size." · "No inventory in this range." · "Exceeds available inventory." · "You've reached the maximum of 8 open longs." · "Your free USDC can't cover this long's required margin." · or the §4.4 global-state string |
| Review sheet title | "Review position" · sub-line "Check every value. Confirming opens your wallet to sign." |
| Review rows | "Market" · "Side" · "Realized range" · "Position size" ("{n} liquidity units") · long: "Est. premium per hour, at the current rate", "Required margin" (hint "Free USDC now: {n}") · short: "Max collateral locked (slippage cap)" (hint "Orca locks what the range needs at execution, up to these caps.") |
| Review rent line | "This range needs a new tick array. The one-time rent shown on the ticket is paid by you and not refundable while the range is in use." |
| Review actions | "Cancel" · "Confirm Open Short" / "Confirm Open Long" |
| Submitting | "Confirm in your wallet" |
| Success | "Position opened. View transaction" |
| Range picker (short side) | Collapsed by default behind "Ranges with short liquidity ({K})" · "Show" / "Hide"; "Use available short" stays visible either way |
| Range picker, long list | "Show all ({K})" / "Show fewer" — the list is capped and scrolls; rows are never merged, summarised or hidden from the total |
| Range picker | Heading "Open against existing shorts ({K})" · CTA "Use available short" (disabled title "No range has short liquidity left to open against.") · row "{low}–{high} USDC/SOL · ticks {l} to {u} · {n} available" · note "Short and long liquidity minted in each tick range, read from the chain. Picking a row sets the ticket to exactly those ticks." · empty = the §4.1 empty-inventory sentence |
| Range provenance | "Selected range from inventory." — shown under the realized range only when the ticks came from the picker or a chart bar, never after a preset or slider move |
| Toast dismiss | Button labelled "Dismiss" (`aria-label` "Dismiss notification") on every toast. Successes clear themselves after 6s, errors after 12s, a pending toast never clears on its own |
| Inventory strip | "Inventory · selected range" · "Short liquidity" · "Long liquidity" · "Available" · zero-short note = the empty-inventory string above. Never "order book", never "depth" |
| Premium index chart | Figure title "Premium index" · x-axis labels "slot {n}" (slots, never wall-clock dates) · dashed reference line "Live index (RPC)" · caption ends "The dashed line is the index read over RPC right now." |
| Inventory chart | Figure title "Inventory by range" · x-axis labels "[{lower}, {upper}]" · marker "Selected range" · caption "PERMA short (muted) and long (white) liquidity minted in each tick range. The arrow marks the range selected on the ticket. This is inventory, not order book depth — PERMA has no order book." |
| Chart pane, no indexer | "Charts need the indexer. Set NEXT_PUBLIC_INDEXER_URL to enable them." |
| Chart pane, indexer down | "The indexer is not responding. No chart is shown." |
| Chart pane, nothing indexed | "No indexed data for this market yet." |
| Open positions strip | "Open positions ({n})" · "View in Portfolio" · "Showing 5 of {n}." — Side, range, size, status only; no premium, no P&L |

**Banner:** required, persistent.

### 4.2 Portfolio

| Element | Copy |
|---|---|
| Header | "Your Positions" |
| Columns | "Side" · "Range" · "Size" · "Accrued Premium" · "Status" — **no "P&L" column**: no P&L instruction exists on-chain; a short's realized LP result is applied once, at close, and a long always closes at P&L = 0 ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)) |
| Premium column note | "Premium accrues continuously and settles when you close." Values shown are labeled "Est." |
| Status values | "Open" · "Pending Premium" (a short's claim outran the escrow, carried until a long settles) |
| Row action | "Close" (short, or a long with nothing owed) · "Settle" (a long with a positive accrued amount — routes to `settle_premium`, not burn) |
| Empty state | "No open positions. Open a short to provide liquidity, or a long to buy against existing short inventory." |
| Closing | "Settling premium…" |
| Closed | "Position closed. Premium settled to collateral. View transaction" |
| Heading count | "Your Positions ({n})" — live positions only |
| Row action | "Details" opens the position sheet; the whole row is also clickable |
| Position sheet | Title "Position" · sub-line = the premium column note above · rows "Side" · "Realized range" (hint "ticks {l} to {u}") · "Position size" ("{n} liquidity units") · "Status" · "Accrued premium" ("Est. {n} USDC") · "Position account" (truncated address, "Copy" → "Copied", "View account") · link "Open a similar position on Trade" (prefills side + range on the ticket) · footer = Close / Settle |
| History columns | "Event" · "Detail" · "When" (indexer block time as UTC, "—" when the indexer has none; never estimated from the slot) · "Slot" · "Transaction" |

Collateral summary — "Deposited" · "Locked" · "Available" · **"Required free USDC"** — lives on
the **Vault** screen (§4.3), not Portfolio. It is a real µUSDC amount
(`premium_owed_usdc + Σ(accrued + margin)` over open longs), never a "Solvency Ratio" — Fair
MVP reads no price, so a ratio would have to be invented (ADR-0003).

**Banner:** required, persistent.

### 4.3 Collateral / Vault

| Element | Copy |
|---|---|
| Header | "Collateral" |
| Balance label | "Deposited" / "Locked by open positions" / "Available to withdraw" |
| Deposit CTA | "Deposit" |
| Withdraw CTA | "Withdraw" |
| Insufficient block | "You can only withdraw free collateral. Close a position to release locked funds." *(`InsufficientFunds`)* |
| Solvency block *(component 09)* | "This withdrawal would leave less than your open longs owe in premium. Settle or close a long first." *(`InsolventWithdrawal`)* |
| Asset note | "SOL and USDC only. This market accepts no other collateral. Shorts need both in the vault; leave a little SOL in your wallet for fees." |
| Success | "Deposit confirmed. View transaction" |
| Tile order | "Available to withdraw" · "Required free USDC" (hint "{n} open longs" / "No open longs") · "Locked by open positions" (link "View positions" when > 0) · "Deposited" |
| Disabled reason (visible above either CTA) | "Enter an amount." or the §4.4 global-state string |
| Withdraw helper | "Max" chip · "Withdrawable while your longs stay covered: {n} USDC" (= free USDC − required free USDC, floored at 0; never a ratio) |
| Review deposit | Title "Review deposit" · rows "SOL (wrapped on deposit)" · "USDC" · "Cancel" / "Confirm deposit" |
| Review withdrawal | Title "Review withdrawal" · rows "Amount" · "Free USDC after" · "Required free USDC" · "Cancel" / "Confirm withdrawal" |
| Review sub-line | "Check every value. Confirming opens your wallet to sign." (shared with Trade) |

**Banner:** required, persistent.

### 4.4 Global states

| State | Copy |
|---|---|
| Wallet disconnected | "Connect a wallet to continue." |
| Wrong cluster | "PERMA runs on devnet. Switch your wallet's network to continue." |
| Market paused | "Trading is paused. Open positions can still be closed." |
| Transaction failed | "Transaction failed: {program error}. Nothing was changed. View transaction" |
| RPC unavailable | "Can't reach the network. Displayed values may be stale." |
| Loading (any skeleton) | `aria-label` "Loading" — a static placeholder block, never a shimmer, never a fake value |
| Indexer unavailable (Portfolio history) | "The indexer is not responding, so past activity cannot be shown. Your open positions above still come straight from the chain." |
| Indexer unavailable (Markets) | "The indexer is not responding. This page is showing live RPC reads instead." |
| Indexer not configured | "History needs the indexer. Set NEXT_PUBLIC_INDEXER_URL to enable it." |
| No indexed history | "No past activity indexed for this wallet." |
| No market data | "No market data available. Check the RPC connection." |
| Zero collateral after connect (Trade, inline, non-blocking) | "No collateral deposited. Deposit SOL or USDC in Vault to open a position." · CTA "Go to Vault" |
| Localnet wallet not fixture-funded (Vault alert) | "This address isn't the wallet the localnet fixtures funded ({address}). Orca devUSDC can't be minted on a local validator, so a USDC deposit from here will fail. Connect with the Localnet CLI keypair, or re-run make-fixtures for this address and restart the validator." |
| Localnet funded wallet unknown (Vault) | "Run yarn sync-fixture-wallet to check this wallet against the one the localnet fixtures funded." |
| Localnet mismatch (Trade nudge, extra line) | "On localnet, only the fixture-funded wallet holds USDC. Vault explains how to connect it." |
| Deposit disabled, localnet mismatch with a USDC amount | "This wallet holds no localnet USDC. Deposit SOL only, or connect the fixture-funded wallet." |
| Localnet wallet entry (connect dialog) | "Localnet CLI keypair (fixtures)" · "Signs with a Solana CLI keypair you load below. The file is read in this browser and kept in memory only. Local testing only. Never use a mainnet key here." · field "Load CLI keypair JSON" |
| Keypair file rejected | "That file isn't a Solana CLI keypair. Pick the id.json written by solana-keygen." |
| Keypair is the wrong wallet | "This keypair is {address}, not the fixture-funded wallet {address}. Use that key, or re-run make-fixtures with this one and restart the validator." |
| Transaction failed, no localnet funds | "Not enough SOL or USDC in this wallet on localnet. Fixtures fund the CLI wallet only — import that key or regenerate fixtures for this address." |

### 4.5 Navigation

| Element | Copy |
|---|---|
| Primary nav labels (sidenav `md+`, tab bar `<md`) | "Trade" · "Portfolio" · "Vault" · "Markets" — identical strings on both; the sidenav also carries "Docs" (external) |
| Trade phone disclosure | "Market data" · trailing "Show" / "Hide" |

### 4.6 Top bar

| Element | Copy |
|---|---|
| Wordmark | "PERMA" |
| Market label | "SOL/USDC · Orca Whirlpool" |
| Spot readout | "Spot {price} USDC" — always "Spot", never "Price", "Mark" or "TWAP"; "—" while unread |
| Status badge | "Active" / "Paused" (Paused carries the §4.4 paused copy as its `title`) |
| Free collateral | "Free {sol} SOL · {usdc} USDC" — unlocked balances only, never a P&L |

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
