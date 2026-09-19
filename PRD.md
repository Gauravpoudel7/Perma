# PERMA — Product Requirements Document

**Project:** PERMA  
**Tagline:** Perpetual Options Powered by Solana Liquidity  
**Version:** V1.1 (Optimized)  
**Status:** Architecture + Fair MVP Implementation Spec  
**Target Chain:** Solana  
**Primary CLMM (MVP):** Orca Whirlpool  
**Reference Protocol:** Panoptic V1 *(behavioral reference only — not a code port)*  
**Colosseum Crypto World's Fair deadline:** October 12, 2026 (PT)  
**Document split:**
- **Part A — Fair MVP Spec** (what we ship by the deadline)
- **Part B — Protocol V1 Spec** (north-star parity after Fair)

---

## 0. How to read this document

1. If you are building for the Fair: implement **Part A only**.
2. Part B is the long-term protocol bible. Do not treat Part B as Fair scope.
3. PERMA must reproduce **Panoptic V1 economic behavior**, not Panoptic's UI, and **not** copy BUSL-licensed Solidity source.

---

# Part A — Fair MVP Spec (Ship by Oct 12, 2026)

## A1. MVP one-liner

PERMA Fair MVP proves, **on-chain**, that Solana concentrated liquidity can power a perpetual option lifecycle:

> Deposit collateral → open short (add Orca liquidity) → open long (only if short liquidity exists) → streaming premium accumulates → price moves → close/settle premium + P&L.

Banner on every screen: **Prototype. Not audited. Single pool. Not production.**

## A2. Non-negotiable MVP constraints

| Constraint | Choice |
|---|---|
| Chains | Solana **devnet** primary; optional mainnet demo with tiny size |
| CLMM | **Orca Whirlpool only** |
| Market | **One allowlisted** SOL/USDC Whirlpool |
| Legs per position | **1 leg only** |
| Position types | Short + Long |
| Premium | On-chain accumulator + settle on close |
| Solvency | Required on mint and withdraw |
| Liquidation | **Optional stretch** (pick this *or* force-exercise, not both) |
| Force exercise | **Optional stretch** |
| Multi-leg (2–4) | **Out of Fair scope** |
| Permissionless factory for all pools | **Out of Fair scope** |
| Indexer sophistication | Minimal (RPC + simple cache OK) |
| Protocol token / DAO / vaults | **Out of Fair scope** |

## A3. Actors (MVP)

1. **Collateral depositor / LP capital** — deposits SOL and/or USDC.
2. **Option seller (short)** — provides range liquidity via PERMA.
3. **Option buyer (long)** — pays streaming premium; requires existing short liquidity.
4. **Demo operator** — seeds initial short liquidity so the long path is demoable.
5. *(Stretch)* **Liquidator** or **force exercisor** — one stretch role max.

## A4. MVP user journeys

### Journey 1 — Alice sells (short)
1. Connect wallet  
2. Deposit USDC (and/or SOL) collateral  
3. Choose range (e.g. SOL $180–$220) and size  
4. Open **SHORT**  
5. PERMA CPIs into Orca Whirlpool to **add liquidity**  
6. Position account created; premium state initialized  

### Journey 2 — Bob buys (long)
1. Sees available short liquidity for that range  
2. Deposits collateral  
3. Opens **LONG** against that range  
4. Protocol verifies `requested_long_liquidity <= available_short_liquidity`  
5. Position created; Bob begins accruing premium owed  

### Journey 3 — Time + price + close
1. Wait / advance clock in tests; UI shows premium rising  
2. Optionally move price in demo (or wait for market move)  
3. Close/burn position  
4. Settle premium + P&L into collateral balances  
5. Show tx signatures end-to-end  

## A5. MVP on-chain instructions (minimum)

```text
initialize_global_config()
create_market()                 # allowlisted pool only
deposit_collateral()
withdraw_collateral()           # solvency-gated
mint_options()                  # 1-leg long or short
burn_options()                  # close + settle
settle_premium()                # optional explicit settle
poke_observations()             # pool observation / TWAP helper
```

Stretch (choose at most one package):
```text
liquidate_account()
# OR
force_exercise()
```

## A6. MVP architecture (thin)

```text
Factory (allowlisted)
    → Market (1 SOL/USDC Whirlpool)
        → Position Engine (1-leg long/short + Orca CPI)
        → Collateral Manager (SOL vault + USDC vault)
        → Premium Engine (accumulator)
        → Risk (solvency on mint/withdraw)
        → CLMM Adapter (Orca Whirlpool)
```

## A7. MVP success criteria (Definition of Done)

- [ ] One allowlisted Orca SOL/USDC market exists on-chain  
- [ ] Alice can deposit collateral and open a short that **actually adds Whirlpool liquidity**  
- [ ] Bob can open a long **only when** short liquidity exists; otherwise reject  
- [ ] Premium accumulates on-chain and is visible in UI  
- [ ] Close settles premium and updates collateral correctly  
- [ ] Solvency check blocks unsafe withdraw / oversize mint  
- [ ] Demo video ≤3 min with live txs  
- [ ] GitHub + README + “not audited” disclaimer  
- [ ] Pitch clearly differentiates from a fake options calculator  

## A8. Explicit Fair non-goals

- 2–4 legs, spreads/straddles as first-class UI  
- Permissionless market creation for arbitrary pools  
- Full Panoptic V1 liquidation + force-exercise parity together  
- Production mainnet risk capital  
- Claiming “Panoptic on Solana, production-ready”  
- Copying Panoptic Solidity  

## A9. Fair demo script (recommended)

1. Seed Alice short on SOL/USDC $180–$220  
2. Bob opens long against it  
3. Show premium owed ↑ over time  
4. Show SOL price move (live or controlled demo path)  
5. Bob closes; settle premium + P&L  
6. Show explorer links  

## A10. Fair tech stack

- Rust + Anchor  
- Orca Whirlpool CPI (official CPI examples / client)  
- Next.js + React + TypeScript + Solana Wallet Adapter  
- Local validator + Anchor tests  
- Optional thin indexer later  

## A11. Fair engineering order

```text
1. Orca Whirlpool adapter (add/remove liquidity, read tick/price)
2. Market + collateral deposit/withdraw
3. Short mint (real CPI add liquidity)
4. Long mint (availability check + utilize liquidity)
5. Premium accumulator + settle on burn
6. Solvency checks
7. Minimal Trade + Portfolio UI
8. Demo video + pitch
9. (Stretch) liquidation OR force-exercise
```

**Do not start with the full UI or 4-leg encoding.**

---

# Part B — Protocol V1 Spec (Post-Fair North Star)

## B1. Executive summary

PERMA is a permissionless, non-custodial **perpetual-options protocol** for Solana.

It implements the **economic and functional model** of Panoptic V1 using Solana concentrated-liquidity AMMs (starting with Orca Whirlpool) as the option primitive:

- Short legs **create / supply** CLMM liquidity  
- Long legs **utilize / remove** corresponding liquidity and require available short inventory  
- Premium is **streaming** (no Friday expiry)  
- Accounts must remain **solvent under margin requirements**  
- Distressed accounts can be liquidated; eligible longs can be force-exercised  

```text
Solana CLMM (Orca → later Raydium/others)
            │
            ▼
     PERMA Liquidity / Position Engine
            │
            ▼
      Option Positions (≤4 legs)
            │
      ┌─────┴─────┐
      ▼           ▼
    Long         Short
            │
            ▼
     Premium Engine
            │
            ▼
   Collateral / Margin (solvent, not “100% escrow”)
            │
      ┌─────┴─────┐
      ▼           ▼
 Liquidation   Force Exercise
```

## B2. Problem

Traditional options need expiry, order books, external pricing, and specialized MMs.

Panoptic’s insight: concentrated LP ranges already create structured price exposure. Options can be built by coordinating long/short claims on that liquidity, with streaming premium and on-chain risk controls.

PERMA brings that model to Solana CLMMs.

## B3. Product vision

Long-term:

```text
Orca / Raydium / other CLMMs
            ▼
          PERMA
     Long · Short · PLPs
            ▼
   Premium + Margin + Risk
```

Near-term after Fair: harden 1-leg market → 2 legs → 4 legs → liquidation + force exercise → more pools.

## B4. Reference: Panoptic V1 (behavioral)

Panoptic V1 major pieces (conceptual mapping):

| Panoptic V1 | PERMA |
|---|---|
| SemiFungiblePositionManager | Position Engine |
| PanopticPool | Market |
| CollateralTracker | Collateral Manager |
| Factory | Factory |

**Critical warning:** Panoptic V1 experienced a critical position-list / fingerprint vulnerability class (2025), requiring emergency response and later V2 direction. PERMA must treat V1 as a **behavioral reference**, not safe code to inherit.

**License:** Panoptic V1 core is primarily **BUSL-1.1**. PERMA MUST NOT copy that source. Independent reimplementation only; legal review if unsure.

## B5. Design principles

### B5.1 Non-custodial
No centralized operator can arbitrarily withdraw user funds. Program-controlled escrow only under explicit rules.

### B5.2 Allowlisted → permissionless markets
- Fair / early V1: **allowlisted pools only**  
- Later: permissionless market creation with safety gates  

### B5.3 No traditional expiry
Open until owner close, exercise, force-exercise (if eligible), or liquidation.

### B5.4 Solvent margin system *(wording fix)*
Every account must satisfy protocol collateral requirements after risk-increasing actions.

Notional exposure **may exceed** deposited collateral within configured risk parameters.  
This is **margin solvency**, not TradFi “fully paid escrow for full notional.”

Invariant:

```text
AccountValue >= RequiredCollateral
```

### B5.5 Oracle-minimized with manipulation resistance
Prefer CLMM pool price/tick and pool observations.

For liquidation and other risk ops:

```text
Compare spot vs TWAP/observations
If deviation > threshold → use conservative price OR reject
```

Never liquidate on a single manipulable tick alone.

### B5.6 Independent implementation
Match published V1 economic behavior and frozen test vectors. Do not paste BUSL Solidity.

## B6. Actors (full V1)

1. Passive liquidity providers / collateral depositors (PLP-style commission earners)  
2. Option sellers (short)  
3. Option buyers (long)  
4. Liquidators  
5. Force exercisors  

## B7. Core modules

```text
perma/
├── factory
├── market
├── position_engine
├── collateral
├── premium
├── risk
├── liquidation
├── force_exercise
├── observations   # oracle-safety
├── math
├── adapters/clmm  # Orca first, Raydium later
└── token_position # PDA positions (not ERC-1155)
```

## B8. Factory

Creates/registers markets for supported underlying CLMM pools.

MUST:
- create market + collateral accounts  
- store config / risk params  
- prevent duplicates  
- validate pool support  
- emit `MarketCreated`  

MVP: only allowlisted pool IDs.

## B9. Market

Coordinator (PanopticPool equivalent).

Owns flows for: mint, burn, exercise, settle premium, solvency, liquidation, force exercise, adapter calls.

## B10. Position Engine

Solana equivalent of SFPM role.

MUST:
- add/remove CLMM liquidity via adapter  
- track liquidity chunks `(lower_tick, upper_tick, liquidity)`  
- support long and short legs  
- enforce ownership  
- reconcile internal liquidity accounting with CLMM state  

## B11. Liquidity chunks

```text
lower_tick
upper_tick
liquidity_amount
```

## B12. Option legs (protocol target)

Up to **4 legs** per position (V1 parity target).  
Fair MVP: **1 leg**.

Each leg:
- long/short  
- tick range  
- liquidity/size  
- leg state  

## B13. Position ID

Deterministic encoding of market + legs. Immutable after creation.

Solana representation: **Position PDA**, not ERC-1155.

```text
PDA(["position", market, owner, position_id])
```

Default MVP: **non-transferable**. Transfers only later with explicit solvency + premium settle rules.

## B14. Long vs short (core mechanism)

**Short:** PERMA adds liquidity to the CLMM for the range. Seller earns premium (+ fees/commission as designed).

**Long:** PERMA utilizes/removes corresponding short liquidity. Buyer pays streaming premium.

**Hard rule:**

```text
long_used <= available_short_liquidity
```

Reject otherwise. No synthetic free longs.

## B15. Collateral manager

Separate vaults/accounts per market token:

```text
Token A collateral
Token B collateral
```

Tracks deposits, locked amounts, premium owed/received, commissions, P&L, required vs available collateral, liquidation bonus accounting.

Withdrawals blocked if they break solvency.

## B16. Margin / buying power

Configurable risk parameters per market (not hard-coded magic leverage).

Example shape only:

```text
collateral = 1000
max_exposure_mult = configurable
required_collateral = f(positions, tick, premium, params)
```

## B17. Premium engine

Streaming premium while open; settle on close/exercise/liquidation as needed.

Use accumulator/index accounting (avoid per-second writes to every position):

```text
GlobalPremiumIndex - PositionEntryIndex → premium owed/earned
```

### Premium formula policy *(optimized)*

Implementation team MUST:
1. Freeze public V1 behavioral references + derive test vectors  
2. Independently implement premium/utilization/fee math in Rust fixed-point  
3. Prove equivalence with differential tests on vectors  
4. Never vendor BUSL Solidity into the repo  

## B18. Commission

Configurable opening commission (Panoptic V1 materials often cite ~10 bps in some configs — treat as reference, not hard requirement). Parameters on-chain.

## B19. Mint / burn / exercise

`mint_options` validates market, legs, ticks, long availability, collateral, then mutates CLMM + position + premium state atomically.

`burn_options` settles premium + P&L, restores liquidity as required, updates collateral, closes position.

Exercise settles economic outcome without a Black-Scholes engine. Payoffs come from liquidity/price/utilization mechanics.

## B20. Force exercise (post-MVP required for V1)

Eligible out-of-range longs may be force-exercised so sellers are not stuck.

MUST verify eligibility, range condition, fees, settlement, liquidity restore, both accounts updated.

## B21. Liquidation (post-MVP required for V1)

If `AccountValue < RequiredCollateral`, liquidators may close per rules and earn bonus.

MUST use observation/TWAP safety. Define pause behavior if insolvency cannot be socialized safely.

## B22. Risk engine

Pre-trade solvency simulation for every risk-increasing tx.

Portfolio awareness for multi-position users (V1 target). Fair MVP may evaluate single-position solvency first.

## B23. Critical invariants

1. **Collateral conservation** — tracked assets reconcile with vaults + CLMM-controlled funds + accounting  
2. **No free long liquidity** — `long_used <= available_short`  
3. **No under-solvent mint** — solvency after every risk-increasing success  
4. **Premium conservation** — buyer premium ↔ seller accounting under model  
5. **Position ownership** — only authorized owner/operator; **no spoofable position lists**  
6. **Liquidity accounting** — internal records match adapter/CLMM  
7. **No double settlement**  
8. **Duplicate rejection** — any position list/account set cannot use duplicates to inflate solvency  

### Mandatory anti-spoofing (from Panoptic V1 lessons)

- Never trust client-supplied fingerprints alone  
- Prove ownership of every position referenced  
- Cap positions per account  
- Reject duplicate IDs in batch validation  

## B24. CLMM adapter

```text
get_pool_state()
get_current_tick()
get_price()
add_liquidity()
remove_liquidity()
collect_fees()
swap()            # if required for ITM flows later
get_position()
get_observations()
```

**First adapter:** Orca Whirlpool.  
**Later:** Raydium CLMM, others.

## B25. Solana account model (suggested)

```text
GlobalConfig
Market
CollateralVault (per mint)
UserCollateral
Position
OracleState / ObservationState
```

Optimize after profiling. Respect CU, account, and tx size limits.

## B26. Core instructions (full V1)

```text
initialize_global_config()
create_market()
initialize_collateral()
deposit_collateral()
withdraw_collateral()
mint_options()
burn_options()
exercise_options()
settle_premium()
force_exercise()
liquidate_account()
poke_observations()
collect_fees()
update_market_parameters()
pause_market() / unpause_market()
pause_global() / unpause_global()
```

## B27. Atomicity

No half-states: liquidity added without position, or position without collateral lock. All-or-revert.

## B28. Failure conditions

Reject invalid market/pool/ticks/size, insufficient collateral or short liquidity, unauthorized access, unsafe/stale observations where required, overflow, account mismatch, reinit, duplicate markets, bad token accounts, unauthorized config changes.

## B29. Security requirements

Test accounting, position safety, economic attacks (tick manip, donation, rounding, flash-style), and Solana-specific CPI/PDA/token/account substitution bugs.

Professional audit required before production mainnet.

## B30. Pause / incident response *(added)*

- Global pause  
- Per-market pause  
- Documented incident path: pause → assess → public note → remediation  
- Early V1: if bad debt appears, **halt market** rather than silent socialization (policy can evolve later)

## B31. Bootstrap liquidity *(added)*

Longs need shorts. Every market launch plan MUST include:
- seed short liquidity, or  
- MM partner inventory, or  
- demo operator shorts for Fair  

Empty short inventory = failed demo.

## B32. Events

`MarketCreated`, `CollateralDeposited`, `CollateralWithdrawn`, `PositionMinted`, `PositionBurned`, `PositionExercised`, `PremiumSettled`, `LiquidationExecuted`, `ForceExerciseExecuted`, `FeesCollected`, `ObservationsUpdated`, `MarketPaused`

## B33. Indexer / frontend (post-MVP polish)

Indexer for markets, positions, premium, volume, liquidations.

Frontend sections: Markets, Trade, Portfolio, LP/Earn, Risk visualization (liquidation distance must be visible).

## B34. Parameters (on-chain)

```text
max_position_size
max_positions_per_user
commission_rate
premium_parameters
liquidation_threshold
liquidation_bonus
force_exercise_fee
margin_parameters
oracle_deviation_limit
observation_window
supported_fee_tiers
pause_flags
allowlisted_pool_ids (early)
```

## B35. Governance

Fair / early V1: admin config authority (preferably multisig). No DAO/token required.

## B36. V1 feature-parity matrix

| Capability | Fair MVP | Protocol V1 |
|---|---|---|
| Allowlisted market | REQUIRED | REQUIRED |
| Permissionless markets | No | Later |
| Orca Whirlpool underlying | REQUIRED | REQUIRED |
| Additional CLMMs | No | Later |
| Perpetual (no expiry) | REQUIRED | REQUIRED |
| Short | REQUIRED | REQUIRED |
| Long (inventory-capped) | REQUIRED | REQUIRED |
| 1 leg | REQUIRED | REQUIRED |
| Up to 4 legs | No | REQUIRED |
| Streaming premium | REQUIRED | REQUIRED |
| Collateral + solvency | REQUIRED | REQUIRED |
| Commission | Optional simple | REQUIRED |
| Exercise/close settle | REQUIRED | REQUIRED |
| Force exercise | Stretch / one-of | REQUIRED |
| Liquidation + TWAP safety | Stretch / one-of | REQUIRED |
| Anti-spoof ownership checks | REQUIRED | REQUIRED |
| Pause switches | Recommended | REQUIRED |
| Frontend trade+portfolio | REQUIRED | REQUIRED |
| Differential economic tests | Partial | REQUIRED |
| Production audit | No | REQUIRED before mainnet risk |

## B37. What PERMA is NOT

- Classic options CLOB  
- Black-Scholes settlement engine  
- Centralized exchange  
- Line-for-line Solidity copy of Panoptic  
- “Fake premium UI” without CLMM CPI  
- Panoptic V2 vault suite (out of initial scope)

## B38. Ethereum → Solana translation

| Panoptic / Ethereum | PERMA / Solana |
|---|---|
| Solidity contracts | Rust/Anchor programs |
| ERC-1155 positions | Position PDAs |
| ERC-4626-style trackers | Collateral vault accounts |
| Uniswap V3 | Orca Whirlpool (first) |
| SFPM | Position Engine |
| PanopticPool | Market |
| CollateralTracker | Collateral Manager |
| Factory | Factory |
| ERC-20 | SPL Token / Token-2022 (explicit support policy) |

**Token-2022 note:** define whether transfer-fee / non-transferable mints are unsupported in V1 (recommended: unsupported initially).

## B39. Development phases (protocol)

```text
0 Spec freeze + threat model + test vectors
1 Orca adapter
2 Factory + allowlisted market
3 Position engine (1-leg)
4 Collateral + solvency
5 Premium engine
6 Long/short availability rules
7 Close/exercise settle
8 Liquidation + observation safety
9 Force exercise
10 Multi-leg (2→4)
11 Indexer + full UI
12 Security / fuzz / differential / audit
```

Fair stops around phases 1–7 (+ thin UI), with optional 8 **or** 9.

## B40. Testing strategy

- Unit + Anchor integration + local validator  
- Invariant tests for §B23  
- Economic attack tests  
- Differential tests against frozen vectors  
- CU benchmarks for mint/burn with tick arrays  

Goal: same economic behavior under equivalent conditions — not merely “tx succeeded.”

## B41. Math / precision

No on-chain floats. Fixed-point/integer only. Explicit rounding directions (protocol-favorable when receiving; conservative when paying). Dedicated suites for tick↔price, liquidity↔tokens, premium, margin, liquidation bonus, force fees.

## B42. Performance

Optimize account metas, CPIs, tick array handling. Multi-leg must remain within Solana tx/CU practicality (may require multi-ix flows).

## B43. Repository structure

```text
perma/
├── programs/perma/
├── app/
├── indexer/
├── tests/
├── docs/
│   ├── PRD.md                 # this file
│   ├── fair-mvp-checklist.md
│   ├── panoptic-v1-behavior.md
│   ├── architecture.md
│   ├── threat-model.md
│   ├── economics.md
│   └── security.md
├── Anchor.toml
└── README.md
```

## B44. Licensing / reference-code policy

1. Study public Panoptic architecture/docs/audits/post-mortems  
2. Write independent Solana implementation  
3. Do not copy BUSL source  
4. Get legal advice if unsure about derivative implementation risk  
5. Document frozen commit/version used as *behavioral* reference  

## B45. Security warning (product claims)

Do **not** market Fair builds as production-ready.  
Do **not** claim safety by association with Panoptic.  
Do state: prototype, unaudited, allowlisted pool, limited surface.

## B46. Fundamental thesis

> Concentrated liquidity already creates structured exposure to price ranges. PERMA turns that into Solana-native perpetual options with streaming premium and margin solvency.

Strong description for judges:

> **PERMA is a Solana-native perpetual-options protocol that uses concentrated-liquidity positions as the option primitive, implementing Panoptic V1–equivalent economics — starting with a one-pool Orca MVP.**

## B47. Primary requirement

Reproduce **economic behavior** (liquidity legs → long/short → premium → collateral → P&L → exercise/force/liquidation), not a cosmetic options UI.

The product is the **position + premium + collateral + risk + CLMM integration** system.

---

## Appendix A — Threat model (summary)

| Threat | Mitigation |
|---|---|
| Spoofed position lists / ownership | Explicit ownership proofs; no fingerprint-only auth; duplicates rejected |
| Tick/price manipulation | Observations/TWAP gates on risk ops |
| CPI account substitution | Strict account validation, program IDs, PDA seeds |
| Rounding / donation attacks | Explicit rounding; invariant tests |
| Empty market / no shorts | Bootstrap shorts before enabling longs |
| Operator key abuse | Multisig + pause; no arbitrary user withdrawals |
| BUSL / IP mistakes | Independent implementation; legal review |

## Appendix B — Changelog from V1.0 PRD

- Renamed scope into **Fair MVP (Part A)** vs **Protocol V1 (Part B)**  
- Replaced “fully collateralized” with **solvent margin system**  
- Locked **Orca Whirlpool** as first CLMM; allowlisted single pool for Fair  
- Reduced Fair legs to **1** (4-leg remains protocol target)  
- Clarified premium math as **independent reimplementation + vectors**, not BUSL copy  
- Added anti-spoofing requirements from Panoptic V1 incident lessons  
- Added pause, bootstrap liquidity, Token-2022 policy, CU/account constraints  
- Made liquidation vs force-exercise a Fair **stretch either/or**  
- Softened early permissionless factory  

---

**End of PRD V1.1**
