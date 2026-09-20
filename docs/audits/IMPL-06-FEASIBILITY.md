# Component 06 (Long Mint) + minimal 07 scaffold — Phase 0 Feasibility

**Date**: 2026-09-19 · **Specs**: [`06-long-mint-inventory.md`](../02-mvp-components/06-long-mint-inventory.md), [`07-premium-engine.md`](../02-mvp-components/07-premium-engine.md), [`08-burn-settle.md`](../02-mvp-components/08-burn-settle.md) §A–B, [ADR-0002](../adr/ADR-0002-premium-accounting.md)
**Stack**: anchor-cli `1.2.0`, solana `3.0.0`, `--arch v0` — unchanged.

## Verdict: **GO**

---

## Q1 — Can long mint ship without the premium scaffold?

**No.** The argument that 06 is self-contained fails on 06's own text. Its `execute_long_mint` sequence opens:

```rust
// 1. Refresh the index, then poke the range BEFORE any weight change.
//    Ordering is mandatory — see 08-burn-settle.md invariant 5.
//    - premium_engine.update_index();
//    - premium_engine.poke_range(r);
```

And the inventory figures it gates on — `total_short_liquidity`, `total_long_liquidity` — are fields of `RangePremiumState`, defined in `08-burn-settle.md` §A. There is no inventory ledger anywhere else.

A long that skipped this would either invent a parallel inventory store (a second system, which 03 and 04/05 both refused) or gate on nothing. Either way 07/08 would inherit corrupted weights, because the entitlement accumulator can only be correct if every weight change was preceded by a poke.

### Scope boundary

| **IN this session** | **OUT — component 08** |
|---|---|
| `GlobalPremiumIndex` + `update_index` | `settle_premium` moving any USDC |
| `RangePremiumState` + `poke_range` | `range_vault` ATA creation or funding |
| Long mint behind the inventory gate | `PendingPremium` cash flows |
| Retrofit short mint/burn weight maintenance | Long burn that pays premium in cash |
| Long checkpoints `entry_index`, `accrued_scaled` | Numeric margin `InsolventMint` (09) |
| Short checkpoint `entry_acc_q64` | UI |

`premium_pool` / `receivable` / `dust` are **declared and left at zero**, so 08 needs no account migration. They are documented as unwired rather than silently present.

## Q2 — Seeds and tick endianness

- `GlobalPremiumIndex` → `["premium_index", market]`
- `RangePremiumState` → `["range", market, tick_lower.to_le_bytes(), tick_upper.to_le_bytes()]`

**`to_le_bytes()` — 4 bytes each.** This is deliberately *not* the adapter's TickArray convention, which uses `start_tick_index.to_string()` decimal ASCII (`01-clmm-adapter-orca.md` §C.4). Two tick-keyed PDAs in one program with opposite encodings is a live footgun; both call sites carry a comment saying which is which and why.

## Q3 — Retrofitting the short path

Grep confirms **zero** occurrences of `RangePremiumState` or `total_short_liquidity` in `programs/perma/src/` — the short path maintains no weights today, because nothing existed to maintain.

Post-retrofit ordering, matching `08-burn-settle.md` invariant 5:

- **Short mint**: `update_index` → init/load range → `poke_range` → **then** `total_short += liquidity`, and checkpoint `entry_acc_q64 = acc_premium_per_short_q64`.
- **Short burn**: `update_index` → `poke_range` → **then** `total_short -= liquidity`, requiring `total_short >= total_long` afterwards.

§E.2 of 08 orders the *cash claim* before the weight decrement precisely so a short's share is computed while it is still in the denominator. Component 06 implements no cash claim, so the observable requirement reduces to poke-before-weights — which is what ships. The claim-before-decrement ordering becomes load-bearing in 08 and is noted in the report as a forward dependency.

## Q4 — Long solvency without component 09

09 still defines no numeric margin parameters; 02, 03 and 04/05 each declined to invent them.

**Gate: `balance_b > 0` → `InsufficientFunds`.** A long with no USDC at all can only ever be bad debt. Deliberately **not** `InsolventMint` — that code implies a margin computation that does not exist, and raising it would misrepresent the guarantee.

This is thin and labelled as such: premium liability is **not** fully enforced at mint until 07's accrual and 09's margin engine exist. No percentage is invented.

## Q5 — Long position account model

Reuse `PermaPosition` with the existing seeds `["perma_position", market, owner, nonce]`:

| Field | LONG value |
|---|---|
| `leg_type` | `LONG` |
| `orca_position`, `position_mint` | `Pubkey::default()` — a long has no Orca position |
| `in_orca_a/b`, `locked_a/b` | `0` — a long moves no tokens |
| `liquidity` | the long's size |
| `entry_index`, `accrued_scaled` | checkpointed at mint |

No second account type and no second seed namespace. The premium checkpoint fields deliberately omitted in 04/05 are added **now**, because this session actually writes them.

## Q6 — Who creates the range?

The **first short mint** in a tick range `init_if_needed`s `RangePremiumState`, with the same two-way re-init discipline as `UserCollateral` (PDA seeds bind it; identity fields written only when unset).

Long mint never creates it: a missing range means no short has ever provided liquidity there, which is exactly `NoShortInventory`. Same error when the range exists but `available == 0`.

## Q7 — The `adapter_*` harness

The harness adds and removes Orca liquidity without touching range state. Once longs exist, that silently desyncs `total_short_liquidity` from reality and corrupts the inventory gate.

**Decision: block it.** `adapter_add_liquidity` and `adapter_remove_liquidity` reject with `HarnessPathUnavailable` when the range's `RangePremiumState` exists and `total_long_liquidity > 0`.

This keeps the 01B regression guards working — `0x1775` and `0x177c` run on ranges that never have longs — while removing the footgun. Documenting "don't use this" would have left a trap for a future session; the program now enforces it.

## Q8 — Transaction size

| Instruction | Today | After retrofit |
|---|---|---|
| `mint_position` SHORT | **1057 B / 25 accts / 126,771 CU** (measured, 04/05) | +2 accounts ⇒ **~1121 B, headroom ~111** |
| `mint_position` LONG | — | **~401 B / 8 accts**, no Orca CPI |

**~111 bytes is tight and this project's estimates have been wrong in both directions** — 01B predicted ~1152 for a bundle that measured 654/820; 04/05 predicted 1009 and measured 1057. So short mint is re-measured immediately after the retrofit. If it exceeds 1232, range init splits into a prior instruction and that is documented, not forced.

---

## Files to touch

`programs/perma/src/premium.rs` (new), `state.rs`, `lib.rs`, `position.rs`, `errors.rs`; `tests/position-long.ts` (new); `scripts/measure-position.mjs`; `docs/audits/IMPL-06-LONG-MINT-REPORT.md`, ADR-0002 addendum, `06`/`07` Done Definitions, `README.md`.

**Out:** `settle_premium`, `range_vault` funding, `PendingPremium` cash, component 09 margin, UI, multi-leg, any admin path that moves user funds.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
