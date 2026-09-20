# PERMA Learning Book
### Teach yourself the Fair MVP so you can answer demo-day questions

**Audience:** Founder preparing for demo day / hackathon judges  
**Language:** Simple English first, real technical words second  
**Project:** PERMA — Perpetual Options Powered by Solana Liquidity  
**Chain:** Solana (devnet primary)  
**CLMM:** Orca Whirlpool only (MVP)  
**Market:** One allowlisted SOL/USDC pool · **Legs:** 1-leg only  

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

**Repo truth (read before you pitch):** Your **local Fair MVP checkout** (`Perma/` with `programs/perma` + audit reports) has **components 01–09 on-chain shipped and tested** as of 2026-09-20: Orca adapter through premium cash settle and solvency (ADR-0002, ADR-0003, `IMPL-08`, `IMPL-09`). Components **10** (pause/admin), **11** (events), and the **thin Trade/Portfolio UI** are still open. Published GitHub `main` may lag — always prefer your local `docs/audits/IMPL-*-REPORT.md` when pitching.

---

## Table of contents

1. [Welcome & how to use this book](#1-welcome--how-to-use-this-book)
2. [What is PERMA? (one page + deeper)](#2-what-is-perma-one-page--deeper)
3. [Why PERMA is good / why it matters](#3-why-perma-is-good--why-it-matters)
4. [Options basics](#4-options-basics)
5. [Perps vs perpetual options](#5-perps-vs-perpetual-options)
6. [Orca, CLMM, ticks, ranges, liquidity](#6-orca-clmm-ticks-ranges-liquidity)
7. [How a trade works on PERMA](#7-how-a-trade-works-on-perma)
8. [Money & safety words](#8-money--safety-words)
9. [Solana program words](#9-solana-program-words)
10. [Every Fair MVP component (01–11)](#10-every-fair-mvp-component-0111)
11. [Hard problems already solved (design / ADR)](#11-hard-problems-already-solved-design--adr)
12. [Premium math simply](#12-premium-math-simply)
13. [Risk & solvency (09)](#13-risk--solvency-09)
14. [Competition cheat sheet](#14-competition-cheat-sheet)
15. [Demo day Q&A bank](#15-demo-day-qa-bank)
16. [Safety script](#16-safety-script)
17. [Glossary A–Z](#17-glossary-az)
18. [What is NOT done yet / north star](#18-what-is-not-done-yet--north-star)

---

# 1. Welcome & how to use this book

You are about to pitch a hard product with calm, clear words.

PERMA is not “another DEX UI.” It is not a spreadsheet that draws option payoffs. It is a protocol design that turns **real Orca concentrated liquidity** into **perpetual options** on Solana: streaming premium, inventory rules, and margin solvency — starting with **one** SOL/USDC pool.

### How to study

1. Read chapters **2 → 7** out loud. If you cannot teach them to a smart 11-year-old, stop and re-read.
2. Read **8 → 10** so money words and the eleven components are automatic.
3. Read **11 → 13** for engineer / judge depth (Orca close order, premium index, solvency).
4. Drill **15** (Q&A). Memorize **16** (safety script). Keep **17** open like a dictionary.

### Honesty rules

- Prefer “we prove X on-chain” over “we are the future of Y.”
- Prefer “the docs say …” over inventing features.
- Prefer local `IMPL-*-REPORT.md` over a lagging GitHub `main`. Say “shipped” only when the audit report exists on your tree.
- Repeat the banner whenever risk comes up:

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

### Where truth lives (published repo)

| Topic | Start here |
|---|---|
| Fair scope (wins conflicts) | Root `PRD.md` **Part A** |
| Product thesis | `docs/00-overview/PRODUCT.md` |
| In / out list | `docs/00-overview/MVP-SCOPE.md` |
| Word list | `docs/00-overview/GLOSSARY.md` |
| Competition notes | `docs/00-overview/COMPETITIVE-NOTES.md` |
| Components 01–11 | `docs/02-mvp-components/` + `COMPONENT-INDEX.md` |
| Orca CPI decisions | `docs/adr/ADR-0001-orca-cpi-instruction-surface.md` |
| Risk language for humans | `docs/07-ops-presentation/RISK-DISCLOSURES.md` |
| Pitch arc | `docs/07-ops-presentation/PRESENTATION-BRIEF.md` |
| Walkthrough | `docs/06-testing/E2E-DEMO-SCRIPT.md` |

This book cross-links **chapter names**, not only file paths, so you can teach from memory.

---

# 2. What is PERMA? (one page + deeper)

## One page

**PERMA** builds **perpetual options** on **Solana** by using **Orca Whirlpool concentrated liquidity** as the option building block.

- A **short** (seller) picks a price range such as SOL **$180–$220**. PERMA **really adds** that liquidity into the allowlisted Orca pool using a CPI. That creates **short inventory**.
- A **long** (buyer) may open only if that inventory exists. The long pays a **streaming premium** (no Friday expiry).
- Later someone **burns** (closes). Premium and P&L **settle** into collateral balances.
- Before risky actions (mint / withdraw), **solvency** checks try to stop bad debt.

```text
Deposit collateral
  → SHORT (add real Orca liquidity)
  → LONG (only if short inventory exists)
  → streaming premium accrues
  → burn / settle premium + P&L
  → solvency gates mint & withdraw
```

That loop **is** the Fair MVP. If you cannot show it with explorer links, you do not have the MVP yet.

## Deeper

Classic options need expiries, books, and specialized market makers. Panoptic’s insight on Ethereum was: a **Uniswap v3 LP range** already creates structured exposure. Coordinate long/short claims on that liquidity, charge streaming premium, enforce margin solvency.

PERMA brings that **economic model** to Solana CLMMs, starting with Orca Whirlpools.

Critical legal line: Panoptic is a **behavioral reference**. PERMA must **not** copy BUSL-licensed Solidity. Independent implementation only. Panoptic V1 also had a serious 2025 position-list / fingerprint incident class — another reason to treat it as economics to study, not code to inherit.

**Name note:** early notes sometimes said “RangeOpt.” The product name is **PERMA**.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 3. Why PERMA is good / why it matters

## Honest demand

Traders want options-like shapes: capped risk, range views, volatility views. Solana already has deep spot liquidity and strong perps distribution. What it still largely lacks is a **live CLMM-native perpetual options loop** that is not only “vault yield packaging” and not only “an order book that never got liquidity.”

## The gap

| World | What exists | Gap |
|---|---|---|
| Ethereum | Panoptic on Uniswap v3 | No clear Solana equivalent yet |
| Solana vaults / DOVs | Dual, PsyFi-style vault products | Often strategy vaults, not open long/short inventory on CLMM ranges |
| Solana CLOBs | Manifest + Dual options experiments | Different primitive than Orca-range inventory |
| Solana perps | Jupiter and others | Linear leverage + funding — not option shapes |

## Why it can matter

1. **Real liquidity, not fake tickets.** A Fair MVP short must CPI into Whirlpool liquidity increase. Judges can verify on an explorer.
2. **Symbiosis with the AMM.** Shorts can earn pool trading fees **and** option premium (product thesis). That can deepen the pool instead of draining attention into a dead options book.
3. **Solana fit.** Cheap, frequent updates make streaming premium and solvency checks feel responsive (thesis — not a PMF guarantee).

## Honest downsides (say them first)

- **Bootstrap:** no shorts ⇒ no longs. Empty inventory kills the demo.
- **Complexity:** ticks, CPIs, premium index — easy to confuse a room if you only speak jargon.
- **Prototype risk:** unaudited; single pool; not production capital.
- **Docs ≠ code:** until programs ship and tests/audits pass, you have a specification.
- **Open design gaps:** published premium specs still leave multiplier pinning, multi-short handoff, and poke fee underspecified.
- **Liquidation stretch:** Fair MVP requires solvency gates; full liquidation is optional stretch, not a promise.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 4. Options basics

## Call / put intuition

Imagine SOL is a bicycle worth **$200** today.

- A **call** feels like: “I may buy the bike later at a set price.” You like the bike getting expensive.
- A **put** feels like: “I may sell the bike later at a set price.” You like the bike getting cheap.

In PERMA’s Fair MVP you do not pick “call 220 Dec 2026” from a board. You pick a **CLMM price range** and a **long or short** claim on liquidity in that range. The *feel* is option-like; the *primitive* is the range.

## Long vs short

| Side | Everyday meaning | In PERMA Fair MVP |
|---|---|---|
| **Long** | Buys option-like exposure | Pays streaming premium; needs short inventory |
| **Short** | Sells / writes | Adds range liquidity to Orca; can earn premium (+ pool fees) |

Example: Maya shorts SOL **$180–$220**. Sam longs the same range. Sam pays Maya over time. If inventory is empty, Sam’s mint **rejects**.

## Premium

**Premium** is the ticket price. Classic options often charge once up front. PERMA premium **streams** while the long stays open — like a taxi meter.

## Expiry vs perpetual

- **Expiry options:** die on a date; time decay can cliff.
- **Perpetual options:** no fixed Friday death. You pay over time and close when rules allow (later: risk tools may force exits).

### Mini story

Sam thinks SOL will swing hard around $200. Maya is willing to provide $180–$220 liquidity. Sam pays Maya a streaming fee for that exposure shape. Neither needs a Friday expiry calendar.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 5. Perps vs perpetual options

Both say “perpetual.” They are different toys.

| | Perps (e.g. Jupiter-style) | Perpetual options (PERMA) |
|---|---|---|
| Core bet | Price up/down with leverage | Structured exposure tied to a **range / liquidity claim** |
| Ongoing cost | **Funding** | **Streaming premium** long → short |
| Payoff feel | Mostly **linear** with leverage | More **option / range shaped** |
| Inventory | Perp market design | **Short must create real CLMM liquidity** first |
| Expiry | None | None |
| Risk words | Liquidation, funding, leverage | Solvency, inventory, premium, CLMM path risk |

### Kid story

- **Perp:** “I borrow courage to ride the bike price. I pay funding.”
- **PERMA long:** “I rent a ticket tied to Maya’s liquidity band. I pay a streaming fee. I cannot rent a ticket Maya never printed.”

**Judge answer:** Perps are excellent for directional leverage. PERMA targets options-like range exposure backed by CLMM inventory, and can deepen spot liquidity when shorts add to Orca.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 6. Orca, CLMM, ticks, ranges, liquidity

## Liquidity pool

A shared pot of two tokens so strangers can swap. Example: **SOL + USDC**. Depositors are **LPs**. Traders **swap**. LPs earn **fees**.

## AMM

An **AMM** prices swaps with a formula and pool balances — not a human shouting bids.

## CLMM

A **CLMM** (Concentrated Liquidity Market Maker) lets an LP choose a **price band** instead of serving every price from tiny to infinite.

Orca’s CLMM family is **Whirlpools**.

## Concrete range (memorize)

SOL spot ≈ **$200**. Maya chooses:

```text
$180 ──────────────── $220
         Maya's money
```

Inside the band she is **in range** (can earn swap fees). If SOL jumps to **$250**, she is **out of range** (inactive for fees; inventory becomes one-sided). That pain relates to **impermanent loss (IL)**.

## Tick

A **tick** is a discrete price step. Ranges are `[tick_lower, tick_upper)`.

**Tick spacing** is the pool’s allowed step. Misaligned ticks ⇒ Orca rejects.

### Tiny numeric intuition

If spacing is 64, usable ticks look like … -64, 0, 64, 128 … (actual SOL/USDC ticks are often largely **negative** — that matters for TickArray math).

## TickArray

Orca stores ticks in **TickArray** accounts, not one giant blob. For negative ticks you must use **floor division** (`div_euclid`), not truncating `/`. PDA seeds use the **decimal string** of the start index. ADR-0001 calls this a top integration foot-gun.

## Liquidity (the number)

**Liquidity** here is a CLMM size unit for a position inside a tick range — not “dollars” by itself. Short mint converts collateral intent into a liquidity size and deposits it into Orca.

## Why PERMA cares

The range position is the **option primitive**. Shorts create it. Longs claim against **PERMA-tracked short inventory** for that range — never against random non-PERMA LPs in the same Whirlpool.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 7. How a trade works on PERMA

Use names. Keep the sequence sacred.

### 0) Market exists

Operator `create_market` for the **one allowlisted** SOL/USDC Whirlpool. No permissionless factory in Fair MVP.

### 1) Deposit collateral

Alice deposits USDC and/or SOL. Tokens go to protocol **vaults**. Her **UserCollateral** account tracks balances and locks.

### 2) Open SHORT (real Orca add)

Alice chooses **$180–$220** and a size. PERMA:

1. Checks pause flags + post-mint solvency.
2. Locks collateral.
3. **CLMM Adapter** CPIs Orca: open position + `increase_liquidity_v2`.
4. Increases **short inventory** for that range.
5. Stores her **Position** with an **entry premium index**.

Explorer must show a real Whirlpool liquidity increase.

### 3) Open LONG (inventory-gated)

Bob wants the same range. Rule:

```text
requested_long_liquidity <= available_short_liquidity
```

Fail ⇒ reject. Pass ⇒ create long, start premium owed, still solvency-gated.

### 4) Streaming premium

Slots pass. Global **premium index** rises. Bob’s owed premium grows with index delta × size × multiplier (chapter 12). UI should show the meter climbing.

### 5) Pending premium & poke

**Pending premium** = accrued economically, not yet moved by settle/burn.

`poke_observations` / index update helpers refresh meters. Mint and burn **must** refresh before calculating so nobody settles on a stale meter. Teach this as **poke-before-weights**: update the index **before** you use settlement weights/amounts.

### 6) Burn + settle

Bob burns long → compute premium + P&L → adjust collateral → mark closed.  
Alice burns short → run **3-step Orca close** → unlock collateral → credit premium per accounting rules → mark closed.

### 7) Withdraw

Only if still **solvent** after the withdrawal.

### Demo-shaped numbers (from E2E script spirit)

- Operator seeds short inventory on **$180–$220**.
- Alice deposits a small USDC amount and longs a slice of that inventory.
- Advance time / slots; show premium rising.
- Optionally move price toward $210 in a controlled demo path.
- Burn and show explorer links end-to-end.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 8. Money & safety words

### Collateral
Safety assets deposited to back risk. This is a **margin / solvency** system — not “escrow 100% of notional like a gift card.”

### Vault
Protocol-controlled token accounts holding deposits. User ledgers must **reconcile** with vault totals.

### Lock / locked
Collateral reserved for an open short / Orca path. Locked funds are not freely withdrawable.

### Free balance (teaching name)
Unlocked collateral you can still use or withdraw **if** solvency allows. On-chain fields may be named `balance` / `locked` on `UserCollateral` — say “free balance” in speech.

### Range inventory / “range vault” (speech)
You do not need a PDA literally named `range_vault` unless code adds one. In teaching language it means the **short liquidity bucket for a tick range** that longs consume. Tokens for shorts physically sit in the Orca position/vaults; PERMA tracks the inventory claim.

### Conservation
1. **Collateral conservation** — user balances ↔ vaults ↔ CLMM-controlled funds ↔ accounting.  
2. **Premium conservation** — what longs pay must be attributable to shorts (or an explicit bucket), not minted from air.

### Premium owed
Long’s accrued debt (settled on burn/settle).

### Receivable / premium earned
Short’s accrued credit. Multi-short split rules must be explicit before coding (still a published docs residual).

### Solvency
After careful P&L: `account_value >= required_collateral`. Mint/withdraw that would break this ⇒ error.

### P&L
Profit and loss from the option/range exposure as price moves.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 9. Solana program words

### Program
On-chain bytecode. Planned path: `programs/perma/` (Anchor). **Not present on published `main` yet.**

### Account
On-chain storage / token holdings (Market, Position, UserCollateral, vaults, …).

### PDA
Program Derived Address from seeds such as `["collateral", market, user]`. Lets the program sign for vault/market authority without a hot wallet.

### CPI
Cross-Program Invocation — PERMA calling **Orca Whirlpool** inside the same transaction. Only the **CLMM Adapter** may do this.

### Anchor
Rust framework for Solana programs (account macros, IDL, tests). Toolchain pins live in LOCAL-DEV / RELEASE-GATE docs.

### Compute units (CU)
Execution budget. Full Orca close notes often request on the order of **~600,000 CU**. Exceed it ⇒ tx fails.

### Transaction size (**1232 bytes**)
Hard Solana limit. v2 Orca accounts + `open_position` + TickArray init may not fit one tx — **split**. ADR-0001 records this.

### Instruction
Named entrypoint: `deposit_collateral`, `mint_options`, `burn_options`, `poke_observations`, …

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 10. Every Fair MVP component (01–11)

Source: `docs/02-mvp-components/COMPONENT-INDEX.md` and each numbered spec.

**Ship status (local Fair MVP, 2026-09-20):** **01–09 CODE-SHIPPED** with green suites (see `IMPL-01` … `IMPL-09` reports). **10–11 + thin UI NOT shipped.** Prefer local audits over a lagging GitHub `main`.

| # | Component | What it does | Why it exists | Status |
|---|---|---|---|---|
| **01** | CLMM Adapter (Orca) | Sole Orca CPI module; add/remove liq; TickArrays | Without CPI, shorts are fake | **Shipped** (IMPL-01/01B) |
| **02** | Factory (allowlisted market) | Create/configure the single allowlisted market | Contain Fair risk | **Shipped** (IMPL-02) |
| **03** | Collateral Manager | Deposit / withdraw / lock; vault accounting | Safety backpack + conservation | **Shipped** (IMPL-03) |
| **04** | Position Engine (1-leg) | Long/short state machine; sole adapter caller | One place for position rules | **Shipped** (IMPL-04-05) |
| **05** | Short Mint | Collateral → short → real Whirlpool liquidity | Creates inventory + AMM depth | **Shipped** (IMPL-04-05) |
| **06** | Long Mint (inventory) | Buy only if short inventory exists | Blocks unbacked longs | **Shipped** (IMPL-06; +07 scaffold) |
| **07** | Premium Engine | Index, poke, accrue, floor-with-carry | Streaming fee without per-slot writes | **Shipped** (scaffold in 06; cash in 08) |
| **08** | Burn & Settle | range_vault, settle_premium, PendingPremium | Fees become real USDC | **Shipped** (IMPL-08) |
| **09** | Risk & Solvency | Premium liability + horizon margin on mint/withdraw; no price/TWAP | Stop unpayable long premium | **Shipped** (IMPL-09, ADR-0003) |
| **10** | Pause Admin | Halt risk-increasing actions | Circuit breaker | Spec; **not shipped** |
| **11** | Events Indexing | Events + thin off-chain cache | UI needs a readable feed | Spec; **not shipped** |

### Build order (PRD §A11 — not the same as numbering)

```text
Adapter → Market + Collateral → Short mint → Long mint
→ Premium → Solvency → Thin UI → Demo
→ (stretch) liquidation XOR force-exercise
```

### Planned module map (`docs/05-engineering/REPO-STRUCTURE.md`)

```text
programs/perma/src/
  adapter.rs     # 01
  factory.rs     # 02
  collateral.rs  # 03
  position.rs    # 04–06, 08
  premium.rs     # 07
  risk.rs        # 09
  state.rs       # PDAs
```

Until that folder exists, say “planned modules,” not “in the program today.”

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 11. Hard problems already solved (design / ADR)

Knowing these makes you sound like a builder.

| Problem (one line) | Solution | Where |
|---|---|---|
| Docs invented fake Orca names (`increase_position`) | Use real Whirlpool names; keep PERMA API names distinct | ADR-0001 |
| v1 liquidity IXs hardcode legacy token program | Target **v2** liquidity + fee IXs | ADR-0001 |
| Shared Orca position needs a share ledger | Fair MVP: **1 Orca position per PERMA short**; NFT ATA owned by `market_authority` | ADR-0001 |
| Wrong close order bricks positions | Exact **3-step** close: `decrease_liquidity_v2` → `collect_fees_v2` → `close_position` | ADR-0001 |
| Insert `update_fees_and_rewards` after full decrease | Fails `LiquidityZero` (0x177c); decrease already refreshed growths | ADR-0001 |
| Skip fee collect | `close_position` fails `ClosePositionNotEmpty` (0x1775) | ADR-0001 |
| TickArray seeds / negative ticks | Decimal-string seeds; `div_euclid` floor math | ADR-0001 |
| Longs selling against random pool LPs | Inventory gate = **PERMA short aggregates**, not Whirlpool global liquidity | Adapter + 06 |
| Spot tick manipulable in one tx | Fair MVP solvency **does not use price** (ADR-0003); spot ticker is display-only | 09 |
| Updating every position every slot | **Global premium index**; positions store entry index | 07 |
| Stale index settlement | Mint/burn must update index first; optional poke | 07 / instructions |
| Tx too big with v2 + open + array init | Honor **1232-byte** limit; split TickArray init | ADR-0001 |
| False-green tests | Require explorer-visible Whirlpool effects; assert failures, not only “tx succeeded” | Release-gate spirit |
| Fee cash on close | `collect_fees_v2` moves fees, then position fee fields are clear so close can succeed (transfer into PERMA vaults / accounting) | Adapter close |
| Premium residuals | Multiplier, multi-short handoff, poke fee still need ADR-0002-quality closure | Premium gaps notes |

**Poke-before-weights:** refresh the premium index **before** computing settle amounts/weights. Otherwise someone settles against yesterday’s meter.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 12. Premium math simply

## Why an index?

You cannot rewrite thousands of positions every slot. Instead:

1. A **global index** climbs over time.
2. Each position stores **entry_index**.
3. On settle, premium depends on how far the index moved while you were open.

## Shape in component 07

```text
update:
  elapsed = now_slot - last_update_slot
  current_index += elapsed * premium_rate

settle:
  premium ≈ (current_index - entry_index) * size * MARKET_MULTIPLIER
```

### Terms

- **Index** — market-wide meter (monotonic).
- **Rate (`premium_rate`)** — climb per slot; Fair MVP keeps this **flat** (utilization-reactive premium is Part B).
- **Multiplier** — turns index delta × size into token units.

### Honest residual (say if asked)

Published docs still do **not** fully pin `MARKET_MULTIPLIER` (type, decimals, default, storage). Multi-short **handoff** and **poke fee** (paid fee vs explicit zero) remain gaps. Do not invent stage numbers.

### Floor-with-carry

Integer math leaves dust. **Floor-with-carry** means: floor each share, carry leftover dust to a defined recipient so conservation holds and nobody griefs the system with endless dust leaks. Docs already say round toward protocol/receiver — pin the exact rule before coding.

### Why settle frequency shouldn’t grief (target)

If premium is linear in slots via a monotonic index, delaying settle should not create free money; it only accrues more premium. Real grief risks are stale index, unpaid poke incentives, or handoff holes when a short exits while still owed.

### Synthetic sketch (label synthetic)

`premium_rate = 1`, `size = 100`, `MARKET_MULTIPLIER = 1` (placeholder), entry index 500, exit index 530:

```text
delta = 30
premium = 30 * 100 * 1 = 3000 base units
```

Replace the multiplier with the real fixed-point constant after ADR-0002-quality docs land.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 13. Risk & solvency (09)

## What Fair MVP actually does

Required:

- Solvency on **mint** and **withdraw**
- Conservative P&L mindset
- Prefer pool **observations / TWAP** over a lone spot tick for risk-critical paths
- Fail when spot vs TWAP deviation is too high

Not required as a pair:

- Full **liquidation** and **force-exercise** together (PRD: pick **at most one** stretch)

## No liquidation by default

UI may show teaching “distance to danger,” but **do not promise live liquidators** unless the stretch ships. Base Fair story: **gates** stop unsafe mint/withdraw.

## No fake TWAP

Do not invent an off-chain price and call it safety. Docs direction: Orca **observations**, on-protocol TWAP/deviation gates, fail closed if manipulation is suspected.

## Kid formula

```text
account_value = collateral + unrealized_pnl   (pnl valued carefully)
solvent if account_value >= required_margin
```

Margin rounds **up**.

## Ship status

Component 09 is **code-shipped** on the local Fair MVP tree (`IMPL-09-RISK-SOLVENCY-REPORT.md`, ADR-0003): free USDC must cover premium owed + projected open-long accrual + horizon margin (1,000 slots + 1 USDC buffer demo defaults). **No liquidation. No mark/TWAP price input.** An underwater long past that bound can still get stuck — known Fair MVP limit.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 14. Competition cheat sheet

| Name | One-line |
|---|---|
| **Panoptic** | Ethereum perpetual options using Uniswap v3 LP as primitive; PERMA’s behavioral reference (not a Solidity port; BUSL). |
| **Dual Finance** | Solana options / DOV / staking-options infrastructure — different shape than CLMM inventory options. |
| **Chest / DOVs** | Vault-style options yield packaging; deposit-into-strategy more than open long/short inventory on a range. |
| **Manifest** | Solana CLOB venue; options experiments with Dual — order-book path, not Orca-range inventory. |
| **PsyFi / PsyOptions lineage** | Important Solana options/vault history; not PERMA’s architecture. |
| **Zeta** | Solana derivatives venue history; CLOB/derivatives stack ≠ CLMM-short inventory. |
| **Dead / quiet venues** | Many Solana options attempts stalled on liquidity or UX — cautionary context. |
| **Jupiter perps** | Strong perp distribution; different job-to-be-done. |

**Positioning:** “We are not cloning Panoptic’s code. We are proving Panoptic-like economics on Solana with real Orca liquidity for one pool.”

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 15. Demo day Q&A bank

Practice out loud. Keep answers short.

1. **What is PERMA?** Perpetual options on Solana powered by Orca concentrated liquidity.  
2. **What do you demo?** Deposit → short adds real Orca liq → long against inventory → premium streams → burn settles.  
3. **Panoptic on Solana?** Behavioral cousin, independent implementation — no BUSL Solidity copy.  
4. **Why Solana?** Fees/throughput fit streaming premium + frequent risk checks; deep CLMMs exist.  
5. **Why Orca first?** Mature Whirlpools; CPI surface pinned in ADR-0001.  
6. **Why one pool?** Fair MVP risk control — allowlisted SOL/USDC only.  
7. **Why 1-leg?** Prove the loop before multi-leg complexity.  
8. **What is a short?** Seller who adds real range liquidity to Orca via PERMA.  
9. **What is a long?** Buyer who consumes short inventory and pays streaming premium.  
10. **If no shorts?** Longs cannot open — inventory gate.  
11. **Is liquidity fake?** No — shorts CPI `increase_liquidity_v2`.  
12. **How is premium paid?** Streaming via global index; settled on burn/settle.  
13. **Expiry?** No. That’s the perpetual part.  
14. **Why not a perp?** Option/range payoff + premium, not linear funding leverage.  
15. **Where is collateral?** Protocol vaults, tracked per user.  
16. **Withdraw anytime?** Only if still solvent afterward.  
17. **Liquidations?** Optional stretch — not promised in base Fair MVP.  
18. **Oracle games?** Orca observations/TWAP + deviation gates — not a random price API.  
19. **Tick?** Discrete CLMM price step.  
20. **Range?** Tick band where liquidity is active.  
21. **TickArray?** Orca account packing ticks; tricky PDA math on negative ticks.  
22. **Orca close bug class?** Wrong order / extra update fails; we require 3-step close.  
23. **CPI?** PERMA calling Orca in-transaction.  
24. **PDA?** Program-owned address from seeds.  
25. **Anchor?** Framework for the Solana program.  
26. **Tx size?** 1232-byte limit — may split TickArray init.  
27. **CU?** Heavy closes need large compute budget.  
28. **BUSL?** Why we reimplement economics instead of pasting Panoptic Solidity.  
29. **Audited?** No. Prototype.  
30. **Mainnet money?** Not production risk capital.  
31. **Token/DAO?** Out of Fair scope.  
32. **Multi-leg?** Part B / post-Fair.  
33. **Raydium?** Later; MVP Orca only.  
34. **Permissionless factory?** Out of Fair scope.  
35. **How shorts earn?** Premium (+ LP trading fees).  
36. **How longs earn?** If exposure pays more than premium cost.  
37. **Inventory?** Available short liquidity PERMA tracks for a range.  
38. **Tap random Orca LPs?** No — only PERMA short inventory.  
39. **Biggest tech risk?** Orca CPI correctness + conservation + premium handoff.  
40. **Biggest product risk?** Bootstrapping shorts so longs have inventory.  
41. **Show proof.** Explorer links for Orca increase/decrease + PERMA mint/burn.  
42. **Fee collect on close?** Required before `close_position` or Orca errors.  
43. **Why v2 IXs?** Token-program flexibility + modern SDK match.  
44. **One Orca position per short?** Yes in Fair MVP (ADR-0001) for auditability.  
45. **Premium multiplier?** Must be pinned before coding — known docs gap.  
46. **Poke fee?** Explicit number or explicit zero — no vague “small fee.”  
47. **Deadline context?** Fair MVP aimed around Oct 12, 2026 PT per PRD.  
48. **UI status?** Specced; thin Trade/Portfolio is the Fair bar.  
49. **Force exercise?** Stretch alternative to liquidation — at most one stretch package.  
50. **Why care?** CLMM-backed perpetual options on Solana is still an open seat — we prove it carefully on one pool.  
51. **What is pending premium?** Accrued but not yet settled into balances.  
52. **What is conservation?** Ledgers must add up with vaults and CLMM funds.  
53. **What if pause is on?** New risk stops; exits should still be possible unless full freeze.  
54. **Part A vs Part B?** Part A = Fair ship; Part B = north-star multi-leg / harder risk.  
55. **Is component 09 shipped?** Yes on the local Fair MVP tree (IMPL-09). GitHub main may lag.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---



### Model answers (30–45 seconds)

**Q: Why will anyone short?**  
A: Because a short is also an LP. In a good design they can earn pool trading fees plus option premium. That is the economic bait. We still must bootstrap the first inventory for demos — that is an honest go-to-market problem, not magic.

**Q: What happens in a crash?**  
A: Fair MVP first line of defense is solvency gates on mint and withdraw, plus pause admin if we need to stop new risk. Full liquidation is a stretch feature. We will not pretend we already have a battle-tested liquidation network.

**Q: How do you avoid becoming a fake synthetic printer?**  
A: Long mint is inventory-capped against PERMA short liquidity for that range. We do not sell claims on random unrelated Whirlpool LPs. If inventory is zero, mint fails.

**Q: What’s the scariest engineering foot-gun?**  
A: Orca close ordering and TickArray PDAs on negative ticks. ADR-0001 freezes the real instruction names, the v2 family, one-position-per-short ownership, and the exact three-step close. We treat that ADR as law.

**Q: Is component 09 shipped?**  
A: Yes on our Fair MVP checkout — IMPL-09 and ADR-0003. Margin is premium-over-horizon plus a small USDC buffer, with no fake TWAP. Pause admin (10) and UI are still next.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**


# 16. Safety script

Say at demo start and whenever risk comes up:

> “PERMA is a **prototype**. It is **not audited**. It uses a **single allowlisted pool**. Please **do not** treat this as production mainnet risk capital. Shorts add **real** Orca liquidity; longs require **inventory**; premium **streams**; solvency gates **mint and withdraw**. Panoptic is a behavioral reference only — we are **not** copying BUSL Solidity.”

Optional second breath:

> “If we enable a stretch feature like liquidation, we will say so explicitly. Today’s Fair bar is deposit → short → long → premium → settle.”

UI banner everywhere:

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 17. Glossary A–Z

**Allowlist** — Only approved Whirlpool(s) may become markets.  
**AMM** — Automated Market Maker.  
**Anchor** — Solana program framework.  
**Burn** — Close a position and settle.  
**BUSL** — Business Source License on Panoptic core — do not copy.  
**CLMM** — Concentrated Liquidity Market Maker.  
**Collateral** — Deposited safety assets.  
**Conservation** — Balances must reconcile; no magic tokens.  
**CPI** — Cross-Program Invocation.  
**CU** — Compute units (execution budget).  
**Entry index** — Premium meter at open.  
**Factory** — Creates markets (allowlisted in MVP).  
**Fair MVP** — Part A scope for the fair/hackathon deadline.  
**Fee collect** — `collect_fees_v2` before closing an Orca position.  
**Free balance** — Unlocked collateral still withdrawable if solvent.  
**Funding** — Perp payment stream (not PERMA premium).  
**IL** — Impermanent loss.  
**Index (premium)** — Global streaming-premium accumulator.  
**Inventory** — Available short liquidity for longs.  
**In / out of range** — Whether spot sits inside the LP band.  
**Instruction** — On-chain callable action.  
**Leg** — One long or short piece; MVP = 1.  
**Liquidity (CLMM)** — Size unit inside a tick range.  
**Long** — Buyer side.  
**Market** — PERMA market account for one Whirlpool.  
**Mint** — Open a position.  
**Observation** — Pool price sample for TWAP.  
**Orca / Whirlpool** — First CLMM integration.  
**Panoptic** — Ethereum behavioral reference.  
**PDA** — Program Derived Address.  
**Pending premium** — Accrued, not yet settled.  
**Perp** — Perpetual future; different product.  
**Perpetual option** — No fixed expiry; streaming premium.  
**Poke** — Permissionless refresh of index/observations.  
**Premium** — Ongoing cost paid by longs.  
**Premium owed / receivable** — Long debt / short credit.  
**Program** — On-chain code.  
**Range** — Price band `[tick_lower, tick_upper)`.  
**Receivable** — Amount a short is owed.  
**Risk engine** — Solvency and P&L guardian.  
**Settle** — Finalize premium/P&L into balances.  
**Short** — Seller; provides Orca liquidity in PERMA.  
**Solvency** — Value ≥ required margin.  
**Spot** — Instant pool price/tick (manipulable).  
**Streaming premium** — Continuous accrual.  
**Tick** — Discrete price index.  
**Tick spacing** — Allowed tick step.  
**TickArray** — Orca account storing a tick block.  
**TWAP** — Time-weighted average price from observations.  
**Vault** — Protocol token holdings.  
**Whirlpool** — Orca concentrated pool instance.  
**1232 bytes** — Solana transaction size limit.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

# 18. What is NOT done yet / north star

## Not Fair MVP

- Polished multi-page UI beyond thin Trade / Portfolio  
- Multi-leg spreads / straddles  
- Permissionless factory for arbitrary pools  
- Raydium / multi-CLMM adapters  
- Protocol token / DAO  
- Liquidation **and** force-exercise together  
- Production mainnet risk capital  
- “Audited” or “Panoptic-complete” claims  

## Residuals before code is “ready”

- Freeze allowlisted Whirlpool address  
- Pin premium multiplier + multi-short handoff + poke fee (ADR-0002-quality)  
- Add ADR-0003 if risk parameters need a decision record  
- Land IMPL-* reports as components ship  
- Scaffold `programs/perma` and pass release gate with anti-false-green tests  
- Independent math vectors; stay BUSL-clean vs Panoptic source  

## North star

```text
More pools → multi-leg → hardened risk tooling
→ frozen independent math vectors
→ serious UI + indexing
→ still honest about audits and capital
```

Vision line:

> “Concentrated liquidity already creates structured range exposure. PERMA turns that into Solana-native perpetual options with streaming premium and margin solvency — starting with one Orca SOL/USDC market.”

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---



---

# Appendix A — Worked SOL/USDC story (numbers you can say)

Use this story on stage. Numbers are **teaching numbers**, not promises of live TVL.

**Setup**

- Pool: allowlisted Orca SOL/USDC Whirlpool  
- Spot: about **$200** per SOL  
- Range: **$180–$220**  
- Alice (short): deposits **2,000 USDC** (+ some SOL if the range needs both sides)  
- Bob (long): deposits **500 USDC** margin  

**Act 1 — Alice shorts**

Alice opens a short on `$180–$220`. PERMA locks collateral and CPIs into Orca so Alice’s liquidity sits in that band. Explorer shows a Whirlpool position with liquidity > 0. Market inventory for that range becomes **> 0**.

**Act 2 — Bob longs**

Bob requests a long size that is **less than** Alice’s inventory. PERMA accepts. Bob’s position stores `entry_index`. Bob begins accruing premium owed.

If Bob asks for more than inventory, the transaction fails. That failure is a **feature**, not a bug.

**Act 3 — Time passes**

Suppose 10,000 slots pass and the premium index rises by `D`. Bob’s pending premium grows with `D * size * multiplier`. On a demo UI you can show the owed number climbing even before settle.

**Act 4 — Price drifts to $210**

Spot is still **inside** `$180–$220`. Alice’s LP is in range and can earn swap fees. Option P&L for Bob/Alice moves according to risk engine rules (careful valuation — not a single manipulated tick).

**Act 5 — Bob burns**

Index updates first (poke-before-weights). Premium settles from Bob’s collateral accounting toward short receivable accounting. Bob’s position closes.

**Act 6 — Alice burns**

PERMA runs the **three Orca steps**: decrease liquidity → collect fees → close position. Collateral unlocks. Alice receives premium credit per the handoff rules. Inventory for the range falls.

**What judges should see**

1. Banner: **Prototype. Not audited. Single pool. Not production mainnet risk capital.**  
2. Explorer: Orca liquidity increase on short mint  
3. Failed long when inventory is zero (optional but powerful)  
4. Premium number rising  
5. Explorer: Orca liquidity decrease on short burn  
6. Final collateral balances that conserve

---

# Appendix B — Component flash cards (say in 20 seconds each)

**01 Adapter** — “Only door to Orca. Real CPIs. TickArray math. Three-step close.”  
**02 Factory** — “Creates the one allowlisted market. No random pools.”  
**03 Collateral** — “Deposit, lock, withdraw. Vaults must add up.”  
**04 Position engine** — “1-leg state machine. Owns the lifecycle.”  
**05 Short mint** — “Turns collateral into real Whirlpool liquidity.”  
**06 Long mint** — “Inventory gate. No inventory, no long.”  
**07 Premium** — “Global index. Streaming carry. Update before settle.”  
**08 Burn/settle** — “Close, pay premium, apply P&L, remove Orca liq.”  
**09 Risk** — “Solvency on mint/withdraw via premium liability + horizon margin. Shipped (IMPL-09). No TWAP.”  
**10 Pause** — “Emergency brake for risk-increasing actions.”  
**11 Events** — “Emit logs so a thin indexer can feed the UI.”

---

# Appendix C — Panoptic relationship (careful language)

Allowed:

- “Behavioral reference for perpetual options on concentrated liquidity.”  
- “We independently implement economics on Solana/Orca.”  
- “We study public post-mortems so we do not inherit known failure modes.”

Not allowed:

- “We forked Panoptic.”  
- “We ported their Solidity.”  
- “We are as safe as Panoptic because they exist.”  
- Pasting BUSL source into the repo.

If a judge asks about the 2025 Panoptic incident class: “That’s exactly why we treat Panoptic as economics and lessons, not copy-paste code, and why position accounting and inventory gates are first-class in our specs.”

---

# Appendix D — What “false green” means (testing honesty)

A **false-green test** is a test that passes while proving almost nothing — for example:

- It only checks that a transaction signature exists, not that Orca liquidity changed.  
- It mocks away the CPI and still claims “short mint works.”  
- It never tries the failing path (long with zero inventory).  
- It ignores TickArray negative-tick cases.

Demo-day credibility comes from **anti-false-green** discipline: assert inventory, assert vault conservation, assert the three-step close, assert solvency rejects, assert explorer-visible Whirlpool effects when you claim them.

---

# Appendix E — Spoken glossary drills (10 rapid-fire)

1. CLMM → “AMM where LPs choose a price band.”  
2. Tick → “One step on the price ladder.”  
3. Inventory → “Short liquidity available for longs.”  
4. CPI → “Our program calling Orca inside the same transaction.”  
5. PDA → “Address our program controls from seeds.”  
6. Premium index → “Shared meter so we don’t update every position every slot.”  
7. Solvency → “Your backpack is still big enough for your risk.”  
8. TWAP → “Average price from pool observations over time.”  
9. 1232 bytes → “Max Solana transaction size.”  
10. BUSL → “Why we don’t paste Panoptic’s Solidity.”

---

# Appendix F — File map for humans (published tree)

```text
PRD.md
docs/00-overview/PRODUCT.md
docs/00-overview/MVP-SCOPE.md
docs/00-overview/GLOSSARY.md
docs/00-overview/COMPETITIVE-NOTES.md
docs/01-architecture/
docs/02-mvp-components/          # 11-events-indexing.md + 01–11 specs
docs/03-api-interfaces/
docs/04-ui-ux/
docs/05-engineering/
docs/06-testing/                 # includes E2E-DEMO-SCRIPT.md
docs/07-ops-presentation/        # includes PRESENTATION-BRIEF.md, RISK-DISCLOSURES.md
docs/adr/ADR-0001-orca-cpi-instruction-surface.md
docs/audits/                     # docs audits; IMPL-08/09 not on published main
docs/PERMA-LEARNING-BOOK.md
```

If your Mac checkout has `programs/` plus `docs/audits/IMPL-09-…`, prefer those newer artifacts and update chapter 10’s ship column.


## End card

Five things to remember:

1. Shorts add **real** Orca liquidity.  
2. Longs need **inventory**.  
3. Premium **streams** via an **index**.  
4. Solvency gates **mint/withdraw**; liquidation is stretch.  
5. Always say: **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

---

*Founder teaching book for PERMA Fair MVP. Ship column updated 2026-09-20 for local 01–09 completion (IMPL-08, IMPL-09, ADR-0003). Next: thin UI + components 10–11.*
