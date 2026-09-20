# PERMA — Claude Code Prompt: Component 06 Long Mint (+ minimal premium scaffold)

**How to use:** New Claude Code chat in `Perma/` repo root. Paste `PROMPT` → `END PROMPT`, then the one-liner.

**Why this isn’t “06 alone”:**  
`06-long-mint-inventory.md` stores inventory on **`RangePremiumState`** and requires **`update_index` → `poke_range` before any liquidity-weight change** (ADR-0002 / `08-burn-settle.md` invariant 5 / vector V4). A long mint that skips that scaffolding is a fake long and will poison premium later.

So this session ships:
1. **Minimal premium scaffold** (index + range state + poke ordering) — enough for correct inventory & checkpoints  
2. **Long mint** behind the inventory gate  
3. **Retrofit short mint/burn** so they maintain `total_short_liquidity` with the same poke-before-weights rule  

**Explicitly OUT:** `settle_premium` token transfers, `range_vault` funding, `PendingPremium` cash flows, full burn premium settle (08), numeric margin solvency (09), UI.

---

````text
PROMPT
=====

# Role

You are a senior Solana / Anchor engineer implementing **PERMA Fair MVP component 06 (Long Mint)** and the **minimum of component 07** required so inventory and poke ordering are real.

Fresh chat. Extend the live program. Do not rewrite Orca adapter. Keep all prior suites green (update helpers only; never drop short CPI coverage).

# Product lock

- Fair MVP: one allowlisted WSOL/devUSDC pool, 1-leg
- Banner: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Read in this order before Phase 0:
  1. `docs/02-mvp-components/06-long-mint-inventory.md`
  2. `docs/02-mvp-components/07-premium-engine.md` (index, PREMIUM_SCALE, accrue/payable — implement index+poke; defer settle cash)
  3. `docs/02-mvp-components/08-burn-settle.md` §A–B (RangePremiumState fields, poke_range, ordering rule) — **not** §C–E cash settle
  4. `docs/adr/ADR-0002-premium-accounting.md`
  5. `docs/06-testing/FIXTURES-AND-VECTORS.md` vectors V1–V6 (use for unit tests of math)
  6. `docs/audits/IMPL-04-05-POSITION-SHORT-REPORT.md` (live short path; LONG currently rejected)
  7. Live: `programs/perma/src/{lib,position,state,collateral,risk}.rs`
- Stack: `anchor-lang` 1.2.0, `orca_whirlpools_client` 8.0.0 **without** `anchor` feature, **`anchor build --arch v0`**
- Pool: `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (tick_spacing **8**)

# Already true (do not break)

- Short `mint_position` / `burn_position` product path works (lock + Orca add; 3-step close + unlock)
- `mint_position` currently **`require!(leg == SHORT)`** — intentional; you will extend carefully
- `PermaPosition` has `leg_type` / `status` but **no premium checkpoint fields** (04/05 deliberately omitted them)
- `UserCollateral.premium_owed_usdc` enforced on withdraw; still never written (>0) until settle exists
- `debit_usdc` / `credit_usdc` are `pub(crate)` without a public admin settle backdoor — keep that property
- Conservation identity on product path: `vault + Σ in_orca == Σ (free+locked)`

---

# PHASE 0 — FEASIBILITY (mandatory)

Write `docs/audits/IMPL-06-FEASIBILITY.md` with GO / GO WITH BLOCKERS / NO-GO.

Answer with repo evidence:

## Q1 — Scope boundary (06 vs 07 vs 08)

Confirm this session’s **IN**:

| IN | OUT |
|---|---|
| `GlobalPremiumIndex` + `update_index` | `settle_premium` token movements |
| `RangePremiumState` + `poke_range` | Creating/funding `range_vault` ATA cash escrow (can add PDA fields `premium_pool/receivable/dust` as zeros) |
| Long mint inventory gate | Full burn premium settle / PendingPremium cash |
| Retrofit short mint/burn weight updates | Numeric margin `InsolventMint` formulas (09) |
| Long position checkpoints `entry_index`, `accrued_scaled` | Long burn that settles premium cash |
| Short checkpoint `entry_acc_q64` at short mint | UI |

If you believe long mint can ship **without** `GlobalPremiumIndex`, argue it — then reject that argument: 06’s own sequence step 1 requires update_index + poke_range.

## Q2 — Seeds & tick endianness

Spec: `RangePremiumState` seeds `["range", market, tick_lower_le, tick_upper_le]`.  
Confirm `to_le_bytes()` for i32 ticks. Document. Same for `["premium_index", market]`.

## Q3 — Retrofit short path (mandatory for correctness)

Today short mint never touches range state. After this session:

- Short mint: `update_index` → ensure/init range PDA → `poke_range` → **then** `total_short_liquidity += liquidity` → set short’s `entry_acc_q64 = acc_premium_per_short_q64`
- Short burn: `update_index` → `poke_range` → **then** `total_short_liquidity -= liquidity` (and refuse burn if it would make `total_short < total_long` — inventory invariant)

Prove in Phase 0 which burn order matches §E.2 without implementing cash claim yet (skip premium claim steps; still poke-before-weight).

## Q4 — Long mint solvency without 09

No margin numbers exist. Choose an honest stub:

- **Recommended:** require user has deposited some USDC free balance (`balance_b > 0` or ≥ small constant documented as demo-only), and do **not** raise `InsolventMint` unless you implement a real rule. Prefer `InsufficientFunds` for empty collateral. Document that premium liability on mint is **not** fully enforced until 07 accrue + 09.
- Reject inventing “10% margin” etc.

## Q5 — Long position account model

Longs have **no Orca position**. Options:

- Same `PermaPosition` PDA with `leg_type=LONG`, `orca_position`/`position_mint` = default Pubkey, `liquidity` = size, `in_orca_*=0`, `locked_*=0`
- Or separate seed namespace

**Recommended:** same account type + seeds `[perma_position, market, owner, nonce]` to avoid a second system; document that Orca fields are unused for LONG. Add premium fields now (they will be written).

## Q6 — Init range on first short

Who creates `RangePremiumState`? First short mint in that tick range should `init_if_needed` (with the same two-way re-init caution as collateral). Long mint must fail `NoShortInventory` if range missing or available==0.

## Q7 — Tests & harness

`adapter_*` harness may still bypass range weights — document whether harness must also update range state or remain a low-level escape hatch that **breaks inventory** if used after longs exist. Prefer: product tests use mint/burn only; harness tests stay short-only or also call a shared `range::on_short_liquidity_delta` helper.

## Q8 — Tx size

Long mint has no Orca CPI — should be small. Short mint gains accounts (`GlobalPremiumIndex`, `RangePremiumState`). **Re-measure** short mint bytes/CU after retrofit; if over 1232, split (e.g. ensure index/range init prior ix) — measure, don’t guess (lesson from 01B vs 04/05).

End Phase 0 with GO and file touch list.

---

# PHASE 1 — IMPLEMENT

## New state (`state.rs` / `premium.rs`)

### `GlobalPremiumIndex` — `["premium_index", market]`

- `current_index: u128`
- `last_update_slot: u64`
- `bump`

`update_index(clock, market.premium_rate)` per 07. Poke reward = 0. Monotonic.

### `RangePremiumState` — `["range", market, tick_lower_le, tick_upper_le]`

Fields per 08 §A. Cash fields may remain 0 until 08. Implement `poke_range` exactly per spec (Q64.64, PREMIUM_SCALE).

### Extend `PermaPosition`

Add: `entry_index`, `accrued_scaled`, `entry_acc_q64` (and `premium_receivable` only if needed — else omit until 08).

Constant `PREMIUM_SCALE = 1e12` in one module matching docs.

## Instructions

### `initialize_premium_index` or lazy-init on first mint

Admin or first touch — pick one; document. Prefer init-if-needed on first mint touching the market.

### Extend `mint_position`

- Allow `leg == LONG` or `SHORT`
- **Shared prefix:** pause check → `update_index` → load/init range → `poke_range`
- **SHORT path:** existing Orca flow, then `total_short += L`, set `entry_acc_q64`
- **LONG path:**  
  - `available = total_short - total_long`  
  - `require!(available >= size, NoShortInventory)`  
  - solvency stub (Q4)  
  - init long `PermaPosition` (no Orca CPI)  
  - `total_long += size`  
  - `entry_index = current_index`, `accrued_scaled = 0`  
  - emit `LongMinted`  
  - Decide `open_positions`: longs don’t lock vault collateral the same way — **do not** increment `open_positions` for longs unless you also change unlock semantics; document (recommended: open_positions counts **shorts only**)

### Extend `burn_position`

- Branch on `leg_type`
- **SHORT:** poke-before-weights → `total_short -= L` with invariant `total_short >= total_long` after decrease → existing Orca close + unlock  
- **LONG:** poke-before-weights → `total_long -= L` → close long PDA **without** cash premium settle (accrued may be nonzero — either require `accrued_scaled` payable floor == 0, or force a dry `accrue_long` and store owed into `premium_owed_usdc` without transferring).  

  **Recommended honest approach for long burn without 08:**  
  - `update_index` + `poke_range` + `accrue_long`  
  - add `payable_from` into `user.premium_owed_usdc` (liability tracking) **without** token move  
  - then decrease `total_long` and close position  
  - Document that 08 will replace this with real `settle_premium` + range_vault transfers  

  Refuse long burn that would leave bookkeeping inconsistent.

### Optional public `poke_premium_index`

No reward; for UI freshness only.

## Unit tests (math)

Port / assert fixtures V1–V6 style cases for: update_index, poke_range ordering (V4), floor-with-carry (V6), available vs total_short denominator distinction.

## Integration tests (`tests/position-long.ts`)

1. Short then long same range → success; `total_short` unchanged by long; `total_long` increases; available decreases  
2. Long with no short → `NoShortInventory`  
3. Long size > available → `NoShortInventory`  
4. Two shorts unequal liquidity, one long — inventory math only (no cash)  
5. After time passes, mint second long → prove poke-before-weights (new long’s `entry_index` is current; no free entitlement for past — unit or integration)  
6. Short burn blocked while `total_long` would exceed remaining short inventory  
7. Long burn updates `total_long` and closes PDA  
8. Regression: all prior suites green; **re-measure** short mint tx size

## Docs

- `IMPL-06-FEASIBILITY.md`, `IMPL-06-LONG-MINT-REPORT.md` (name may include “premium-scaffold”)
- Update 06/07 done boxes only for what shipped; clearly list OUT items for 08
- README test commands
- ADR addendum if seeds or long-burn liability-without-cash decision needs permanence

## Out of scope (hard)

- `settle_premium` instruction moving USDC into `range_vault`
- Admin pathways that move user funds
- Full 09 margin engine / liquidation
- Multi-leg, Raydium, UI
- Enabling client `anchor` feature / dropping `--arch v0`
- Fake longs that skip inventory or poke ordering

# Process

1. Phase 0 doc with Q1–Q8  
2. Implement premium scaffold + retrofit shorts  
3. Implement long mint/burn (liability-only long burn if chosen)  
4. Tests + measure short mint  
5. Report → **STOP** (do not start 08 settle cash)

# Done when

- [ ] Long mint succeeds only when available short inventory exists  
- [ ] `total_short` vs `total_long` never conflated  
- [ ] Every weight change is preceded by `update_index` + `poke_range`  
- [ ] Short path still opens real Orca liquidity and keeps prior tests green  
- [ ] Short mint tx still fits (or documented split)  
- [ ] Reports written; 08 cash settle explicitly not claimed done  

# Start now

Phase 0 first. Do not accept LONG in `mint_position` until RangePremiumState + poke ordering exist.

END PROMPT
````

## One-liner

```text
Repo is PERMA. 01–05 done (short product path green). Implement component 06 Long Mint PLUS the minimal 07 scaffold it requires (GlobalPremiumIndex, RangePremiumState, update_index, poke_range-before-weights). Retrofit short mint/burn to maintain total_short_liquidity. Do NOT implement settle_premium cash/range_vault funding (08). Phase 0 → IMPL-06-FEASIBILITY.md → code → IMPL-06-LONG-MINT-REPORT.md. Keep --arch v0 and all prior suites green. Re-measure short mint tx size after retrofit.
```

## Design note for the human (why this prompt is careful)

A “06-only” prompt that ignores premium state would ship a long that cannot obey ADR-0002 later. This prompt forces the shared range ledger and poke ordering now, while forbidding the cash settle surface that 03 correctly refused to leave as an admin backdoor.
