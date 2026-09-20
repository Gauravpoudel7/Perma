# FIXTURES AND VECTORS: Economic Baseline

The vectors are encoded as Rust unit tests in `programs/perma/src/premium.rs` (`v1_…` through `v6_…`) and run by `yarn test:unit` — gate **Q3** in [`RELEASE-GATE.md`](RELEASE-GATE.md) §7. V5 additionally runs end-to-end on chain in `tests/settle-premium.ts`, and both money identities are reconciled over RPC by `node scripts/reconcile.mjs`. *(There is no `tests/vectors/` directory and no `yarn test:math-vectors` script; earlier drafts referred to a JSON runner that was never built.)*

**All numbers below are synthetic and verified by exact integer arithmetic.** They are not market observations. Every premium figure was computed with the parameters in §0 and cross-checked against the formulas in [`07-premium-engine.md`](../02-mvp-components/07-premium-engine.md) §B.

Vectors **V1–V6 are pool-independent** — they depend only on the §0 parameters, so they run and pass before an allowlisted Whirlpool is chosen. Only §6 requires the real pool.

---

## 0. Shared parameters

| Symbol | Value | Source |
|---|---|---|
| `PREMIUM_SCALE` | `1_000_000_000_000` (1e12) | program constant |
| `premium_rate` | `1_000_000` | `Market`, admin-set default |
| `premium_multiplier` | `1_000` | `Market`, admin-set default |
| Premium asset | USDC, 6 decimals (µUSDC) | [ADR-0002](../adr/ADR-0002-premium-accounting.md) |
| Liquidity unit | Orca liquidity `L` (`u128`) | `PermaPosition.liquidity` |

Core identities under test:

```
d_index        = elapsed_slots × premium_rate
accrued_scaled = d_index × liquidity × premium_multiplier
payable        = floor(accrued_scaled / PREMIUM_SCALE)     # remainder carried
claim(short)   = floor((acc_now − entry_acc) × liquidity / 2^64)
```

---

## 1. Premium Vectors

### V1 — single long, no shorts closing

`premium.rs::v1_single_long_accrual`

| Input | Value |
|---|---|
| `liquidity` | `1_000_000` |
| `elapsed_slots` | `100` |

| Expected | Value |
|---|---|
| `d_index` | `100_000_000` |
| `accrued_scaled` | `100_000_000_000_000_000` |
| `payable` | **`100_000` µUSDC** (0.10 USDC) |
| `accrued_scaled` after settle | `0` |

### V6 — settle-frequency neutrality (anti-grief)

`premium.rs::v6_settle_frequency_neutrality` — guards the rounding policy in `07-premium-engine.md` §C. On-chain twin: `tests/settle-premium.ts` "settling twice costs the long exactly what settling once would".

| Input | Value |
|---|---|
| `liquidity` | `1_500` |
| `elapsed_slots` | `100` |
| per-slot accrual | `1_500_000_000_000` scaled = **1.5 µUSDC** |

| Policy | Total over 100 slots | Verdict |
|---|---|---|
| One 100-slot settle | **`150`** | reference |
| **floor + carry**, 100 × 1-slot settles | **`150`** — payments run `1, 2, 1, 2, …` | ✅ **must match** |
| ceil each settle | `200` (+33%) | ❌ assert the implementation does **not** do this |
| floor each, no carry | `100` (−33%) | ❌ assert the implementation does **not** do this |

Assertion: `sum(100 single-slot settles) == single 100-slot settle`, and after every settle `accrued_scaled < PREMIUM_SCALE`.

---

## 2. Premium Split Vectors (long → shorts)

`premium.rs::v2_unequal_shorts_split_pro_rata_with_dust`, `v3_equal_shorts_split_evenly_with_dust`, `v4_poking_before_the_weight_change_is_correct` (+ `v4_poking_after_the_weight_change_is_wrong`), `v5_short_exits_early_and_is_made_whole_when_cash_arrives`. All use one long with `liquidity = 1_000_000` and `elapsed_slots = 100`, so total inflow is `100_000` µUSDC per 100-slot period (V1).

For each vector assert the zero-sum identity: **`Σ short claims + dust == long payment`**.

### V2 — two unequal shorts

| Short | Liquidity | Share | Claim (µUSDC) |
|---|---|---|---|
| A | `3_000_000` | 75% | **`74_999`** |
| B | `1_000_000` | 25% | **`24_999`** |
| | | | `dust = 2` |

`74_999 + 24_999 + 2 = 100_000` ✅

Both claims sit one unit below the exact 75 000 / 25 000 split because the accumulator floors twice — once forming `acc_premium_per_short_q64`, once forming each claim. That residue is what the vectors call `dust`. **As shipped**, it remains inside `premium_pool` — indistinguishable from unclaimed entitlement — and the `dust` field is never written (08 report residual #2). The identity `Σ claims + residue == paid` holds either way.

### V3 — three equal shorts (dust case)

| Short | Liquidity | Claim (µUSDC) |
|---|---|---|
| A, B, C | `1_000_000` each | **`33_333`** each |
| | | `dust = 1` |

`33_333 × 3 + 1 = 100_000` ✅

### V4 — short joins late (ordering guard)

Two 100-slot periods; long holds `1_000_000` throughout. Short A (`3_000_000`) is present for both; short B (`1_000_000`) joins at slot 100.

| Period | `total_short_liquidity` | Inflow |
|---|---|---|
| 1 (slots 0–100) | `3_000_000` | `100_000` |
| 2 (slots 100–200) | `4_000_000` | `100_000` |

| Short | Claim (µUSDC) |
|---|---|
| A | **`174_999`** |
| B | **`24_999`** |
| | `dust = 2` |

`174_999 + 24_999 + 2 = 200_000` ✅ — and **B earns nothing for period 1**, because `entry_acc_q64` is checkpointed at mint. This vector fails if `poke_range` runs *after* the weight change instead of before (`08-burn-settle.md` invariant 5).

### V5 — short closes before any long settles (receivable)

One long (`1_000_000`), one short (`1_000_000`), 100 slots. The short burns first, with an empty pool.

| Step | State |
|---|---|
| Short burns; entitlement | `claim = 99_999`, `premium_pool = 0` |
| → | `paid_now = 0`, `premium_receivable = 99_999`, status **`PendingPremium`** |
| Long later settles | pays `100_000` → `premium_pool = 100_000` |
| Short calls `settle_premium` | receives `99_999`, `receivable = 0`, position **`Closed`**, rent refunded |
| Residual | `premium_pool = 1` (dust) |

Asserts that entitlement accrues on elapsed time rather than on received cash — the short is made whole despite exiting first.

---

## 3. P&L Vectors (Short) — **Part B, not implemented**

There is no `calculate_pnl` and no mark-to-market in Fair MVP, and Orca Whirlpool exposes no TWAP to value against ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)). What *is* live: a short's realized LP result is `returned − locked`, applied exactly once by `position::close_short` at burn and asserted on chain in `tests/position-short.ts` ("final conservation") and `tests/settle-premium.ts`. The intrinsic-value cases below are kept as the Protocol V1 target.

- **Scenario**: Short at range [18, 22] *(the allowlisted pool trades ~20 USDC/SOL)*.
- **Case A (above range)**: Price → 25 ⇒ `profit = (current − upper) × size`.
- **Case B (below range)**: Price → 15 ⇒ `loss = (lower − current) × size`.

## 4. Solvency Vectors — **component 09 (spec'd, not shipped)**

Fair MVP solvency has **no P&L term** — it is free USDC vs. premium liability plus a horizon margin ([`09-risk-solvency.md`](../02-mvp-components/09-risk-solvency.md), [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)). With the demo defaults `required_margin(L) = L µUSDC + 1 USDC`.

| Case | Free USDC | Open longs | Accrued (projected) | Required = Σ(accrued + margin) | Result |
|---|---|---|---|---|---|
| R1 | `1` µUSDC | mint L=1 | `0` | `1_000_001` | **`InsolventMint`** |
| R2 | `60_000_000` | mint L=50e6 | `0` | `51_000_000` | Solvent |
| R3 | `60_000_000` | L=50e6 open, 100 slots | `5_000_000` | `56_000_000` → withdraw `5_000_000` leaves `55_000_000` | **`InsolventWithdrawal`** |
| R4 | after `settle_premium` | L=50e6 open | `0` | `51_000_000` → withdraw `4_000_000` leaves `51_000_000` | Solvent |

R3 is the regression guard for the premium-liability rule. Without it the account would read as solvent and the long could withdraw money it already owes. **Until 09 ships, R3's withdraw succeeds on the live program** — that is the gap.

## 5. Settlement Round-Trip

End-to-end over V2's setup — `tests/settle-premium.ts` on chain, `scripts/reconcile.mjs` over RPC.

| Assertion | Expectation |
|---|---|
| Zero-sum | `Σ short claims + dust == Σ long payments` |
| Vault conservation | `range_vault.amount == premium_pool + dust` at every step (`dust` always 0) |
| Pool floor | `premium_pool >= 0` after every claim |
| Premium applied once | Long's free USDC drops by premium exactly once (`vault_b → range_vault`); long burn P&L is 0; short burn credits Orca's returns |
| Protocol skim | `0` while the range is live |
| Unwind | **Not implemented** — no instruction closes a range or sweeps residue |

## 6. Orca Liquidity Vectors

`tests/adapter-liquidity.ts` (8) and `scripts/measure.mjs`.

> **Resolved 2026-09-19.** Selected and validated in [`IMPL-01-FEASIBILITY.md`](../audits/IMPL-01-FEASIBILITY.md) §5. `PERMA_WHIRLPOOL` is no longer TODO.

| Field | Value |
|---|---|
| Whirlpool address | `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` |
| `whirlpools_config` | `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR` (devnet) |
| **`tick_spacing`** | **`8`** (`ticks_in_array = 704`) |
| `token_mint_a` | `So11111111111111111111111111111111111111112` (WSOL, 9 dp) |
| `token_mint_b` | `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k` (devUSDC, 6 dp) |
| `token_vault_a` | `3uyTv2Pi3pb6Gc2emKiYU8gW845M1HeMMyFr2MTrDGh4` |
| `token_vault_b` | `63GvSvGYTsfesX1kmesdtfxHbBQBsFpZT1wVNhNADT5C` |
| Active rewards | none |
| Live price at selection | ~19.97 USDC/SOL (`tick_current_index = -39140`) |

Real figures for the allowlisted pool (`tick_spacing = 8`). The old `$180-$220` / spacing-64 row was illustrative and did **not** apply to this pool; see `01-clmm-adapter-orca.md` §C.3a.

| Bound | Requested price | Aligned tick | Realized price | TickArray start | TickArray address |
|---|---|---|---|---|---|
| lower | 18.00 | `-40176` | `17.9997` | `-40832` | `86pYzhWoHDwaKbYMbM4gNC7EQTQgbv8WTG5rRjVNH571` |
| upper | 22.00 | `-38168` | `22.0023` | `-38720` | `49ixSQnGC2AEzgwQAeHkDnLYJYKtB2c9rSgpb7PncFPv` |

Narrow same-array case `[-39184, -39104]` -> `ACkArMv6JBtNTM64qLYnNirkMyWgYHUJ9x6CMbLPKZGy` (start `-39424`).

| Assertion | Expectation |
|---|---|
| `tick % tick_spacing == 0` | both bounds |
| `start % (88 × tick_spacing) == 0` | both arrays |
| Array derivation | `i32::div_euclid`, seeds from `start.to_string().as_bytes()` |
| Required token amounts | computed from Whirlpool liquidity math for the live pool |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
