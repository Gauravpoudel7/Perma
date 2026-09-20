# Component 06 — Long Mint + minimal premium scaffold — Implementation Report

**Date**: 2026-09-19
**Phase 0 gate**: [`IMPL-06-FEASIBILITY.md`](IMPL-06-FEASIBILITY.md) — **GO**
**Specs**: [`06-long-mint-inventory.md`](../02-mvp-components/06-long-mint-inventory.md), [`07-premium-engine.md`](../02-mvp-components/07-premium-engine.md) (partial), [`08-burn-settle.md`](../02-mvp-components/08-burn-settle.md) §A–B, [ADR-0002 + addendum](../adr/ADR-0002-premium-accounting.md)

## Status: **shipped — component 08 cash settle explicitly NOT done**

Longs mint behind a real inventory gate, on top of a real premium ledger, with poke-before-weights enforced on every path that changes a weight.

| Suite | Before | After |
|---|---|---|
| Rust unit | 38 | **48** (+10 premium) |
| `tests/position-long.ts` | — | **9 / 9** |
| `tests/position-short.ts` | 7 / 7 | **7 / 7** |
| `tests/collateral.ts` | 11 / 11 | **11 / 11** |
| `tests/factory.ts` | 9 / 9 | **9 / 9** |
| `tests/factory-rewards.ts` | 2 / 2 | **2 / 2** *(own ledger)* |
| `tests/adapter.ts` | 12 / 12 | **12 / 12** |
| `tests/adapter-liquidity.ts` | 8 / 8 | **8 / 8** |

Two full ordered passes, identical. Suites are order-independent.

---

## 1. What shipped

| Item | Detail |
|---|---|
| `GlobalPremiumIndex` | `["premium_index", market]`; `update_index` advances by elapsed slots, monotonic, poke reward **0** |
| `RangePremiumState` | `["range", market, tick_lower_le, tick_upper_le]`; inventory + Q64.64 entitlement accumulator |
| `premium.rs` | `update_index`, `poke_range`, `accrue_long`, `payable_from`, `claimable_for` — pure, 10 unit tests |
| `mint_position` LONG | inventory-gated; no Orca CPI, no vault touch, no collateral lock |
| `burn_position` LONG | accrues, records liability on `premium_owed_usdc`, **moves no cash** |
| Short retrofit | mint bumps `total_short` + checkpoints `entry_acc_q64`; burn decrements with the inventory invariant |
| Harness guard | `adapter_add/remove_liquidity` refuse a range with open longs |
| `PermaPosition` | +`entry_index`, `accrued_scaled`, `entry_acc_q64` |

**Explicitly not shipped:** `settle_premium`, `range_vault` creation or funding, `PendingPremium`, any USDC movement for premium, component 09 margin. `premium_pool` / `receivable` / `dust` are declared **and always zero** — so 08 needs no migration, and nobody can mistake zero for "settled".

## 2. The ordering rule, proven both ways

`poke_range` must run **before** any weight change. The unit tests assert both the correct behaviour and the specific failure:

| V4, two 100-slot periods | Short A (3e6, both) | Short B (1e6, joins at slot 100) |
|---|---|---|
| **poke before weights** (shipped) | **174 999** | **24 999** + dust 2 |
| poke after weights (the bug) | 149 999 | **49 999** — earns for a period it did not exist in |

Asserting the wrong ordering's exact output is what makes the guard a regression test rather than a comment. V1 (single-long accrual → 100 000) and V6 (100 single-slot settles == one 100-slot settle == 150) are likewise ported from the fixtures.

## 3. Two real defects found during verification

### 3.1 The harness guard could be bypassed by passing `null`

First draft declared the range account as `Option<Account<RangePremiumState>>` and skipped the check when absent. `tests/adapter-liquidity.ts` passed `null` — and sailed straight through. **A guard you can opt out of is not a guard.**

Fixed: the account is **mandatory and PDA-verified**. The handler derives `["range", market, lower_le, upper_le]` and compares; an uninitialized account is accepted only because it *proves* no short ever traded the range, so no long can exist there.

### 3.2 A test passed for the wrong reason and hid state corruption

`position-short.ts` had `"rejects a LONG leg"`:

```ts
try { await mint(p, LEG_LONG); assert.fail("expected InvalidLegType"); }
catch (e) { assert.include(e.toString(), "InvalidLegType"); }
```

Once component 06 made LONG valid, the mint **succeeded**, `assert.fail` threw — and its own message contains `"InvalidLegType"`, so the catch matched and the test reported green while silently leaving a long open. That long then (correctly) blocked the harness suite, which is how it surfaced.

Fixed two ways: the test now targets a genuinely invalid leg, and it rethrows `chai.AssertionError` instead of string-matching it. **This pattern exists elsewhere in the suites and is listed as residual #6.**

## 4. Measured transaction cost

| Instruction | Before 06 | After 06 |
|---|---|---|
| `mint_position` SHORT | 1057 B / 25 accts / 126,771 CU | **1123 B / 27 accts / 185,070 CU** |
| `burn_position` SHORT | 861 B / 22 accts / 109,225 CU | **927 B / 24 accts / 132,639 CU** |
| `mint_position` LONG | — | small: no Orca CPI, no vaults |

Phase 0 estimated **1121 B** for short mint; the measured figure is **1123 B** — within two bytes. Both fit the 1232-byte limit.

**Headroom on short mint is now 109 bytes.** That is roughly three more accounts before it breaks. Recorded as residual #1: the next component that needs an account on this path must measure first, and address lookup tables are the escalation.

## 5. Test coverage

`tests/position-long.ts` (9): short creates the range ledger and checkpoints `entry_acc_q64`; long consumes availability **without reducing `total_short_liquidity`**; long on a never-traded range → `NoShortInventory`; long exceeding availability → `NoShortInventory`; a second short raises availability and it is usable; **short burn blocked while longs depend on it** (`InventoryInvariantViolated`), then succeeds once the long is released; long burn decrements `total_long`, closes the PDA, records the liability and leaves vault and free USDC untouched; the harness is refused on a range with longs; final invariant check.

Conservation is asserted around every long operation and must be **unchanged** — longs move no tokens, so any drift would be a bug.

## 6. Residual risks

1. **Short mint has 109 bytes of headroom.** Next account addition on that path must be measured, not assumed.
2. **`settle_premium` does not exist.** Shorts accrue entitlement (`claimable_for` computes it) but cannot be paid. Longs accumulate `premium_owed_usdc` with no way to discharge it — that much USDC stays frozen by the withdraw gate until 08. **08 must both transfer and clear it**; clearing without transferring would forgive real debt.
3. **Long solvency is a stub** — `balance_b > 0`. A long with 1 µUSDC can accrue unbounded premium. Component 09. *(2026-09-20: closed by component 09 per ADR-0003 — `InsolventMint` on a premium-horizon margin.)*
4. **`update_index` uses `Clock::slot`.** Correct on-chain, but a validator restart with a reset slot clock would make elapsed time appear to jump; monotonicity protects the index, not the economics.
5. **Longs never lock collateral**, so `open_positions` counts shorts only. Correct today; if longs ever lock, the field's meaning must be revisited rather than quietly reused.
6. **`try { … assert.fail() } catch { assert.include(…) }` appears in several suites.** §3.2 shows it can report green when the call unexpectedly succeeds. Only `position-short.ts` was fixed; the pattern should be swept across all suites.
7. **`position-long.ts` must leave no open longs** or it blocks the harness suite — enforced by an `after()` hook with an assertion, but it is a coupling worth remembering.

## 7. Scope compliance

| Boundary | Held |
|---|---|
| `settle_premium` / `range_vault` cash (08) | ✅ none — liability only, documented in ADR-0002 addendum |
| `PendingPremium` | ✅ not implemented |
| Component 09 margin / `InsolventMint` | ✅ none invented; `InsufficientFunds` used instead |
| Fake long that skips inventory or poke ordering | ✅ neither is possible |
| Admin path that moves user funds | ✅ none |
| Orca adapter rewritten | ✅ extended only; 8/8 CPI coverage intact |
| `--arch v0`, `anchor-lang 1.2.0`, no client `anchor` feature | ✅ |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
