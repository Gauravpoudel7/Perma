# Component 09 — Risk & Solvency — Implementation Report

**Date**: 2026-09-20
**Phase 0 gate**: [`IMPL-09-FEASIBILITY.md`](IMPL-09-FEASIBILITY.md) — **GO**, preceded by [`DOCS-SYNC-AUDIT-09.md`](DOCS-SYNC-AUDIT-09.md) (88 files; 11 P0 / 124 P1 / 82 P2; every P0 fixed)
**Specs**: [`09-risk-solvency.md`](../02-mvp-components/09-risk-solvency.md) (rewritten this pass), [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)

## Status: **shipped — premium liability + horizon margin, no price input; P&L not implemented, by decision**

Component 08 left one hole open and said so: a long could withdraw the USDC it would owe, because the withdraw gate counted only the legacy `premium_owed_usdc` — which 08 itself made permanently zero-or-decreasing — and not the accrual sitting on the open position. Long mint admitted anyone with `balance_b > 0`. Both are closed.

| Suite | Before | After |
|---|---|---|
| Rust unit | 54 | **60** (10 `risk.rs`, replacing 5 stub tests; +1 `open_longs` counter) |
| `tests/risk-solvency.ts` | — | **10 / 10** *(new)* |
| `tests/settle-premium.ts` | 10 / 10 | **10 / 10** |
| `tests/position-long.ts` | 9 / 9 | **9 / 9** |
| `tests/position-short.ts` | 7 / 7 | **7 / 7** |
| `tests/collateral.ts` | 11 / 11 | **11 / 11** |
| `tests/factory.ts` | 9 / 9 | **9 / 9** |
| `tests/adapter.ts` | 12 / 12 | **12 / 12** |
| `tests/adapter-liquidity.ts` | 8 / 8 | **8 / 8** |
| `tests/factory-rewards.ts` | 2 / 2 | **2 / 2** *(own ledger)* |

**76 integration tests, three full passes on one ledger** — forward, forward, reverse — all identical. That is precisely the case the harness leak in 08's residuals would have broken, so it is the proof, not a formality.

---

## 1. What shipped

| Item | Detail |
|---|---|
| `Market.long_margin_horizon_slots` / `long_margin_buffer_usdc` | `1_000` slots / `1_000_000` µUSDC from `risk_defaults` at `create_market`; no setter (component 10) |
| `UserCollateral.open_longs` | maintained inside `position::open_long` / `close_long`, `checked_sub` so drift fails loudly |
| `risk.rs` | rewritten: `required_margin`, `required_free_usdc`, `check_withdraw_allowed`, `check_long_mint_allowed`, `collect_open_longs`, `MAX_OPEN_LONGS = 8` — all pure over owned copies |
| `premium::projected_index`, `payable_if_settled_now` | read-only projection of the index and of a long's would-be charge; rounds **up**; never writes |
| `withdraw_collateral` | takes `premium_index` (unchecked; deserialized only when `open_longs > 0`) and the open-long set as remaining accounts |
| `mint_position(LONG)` | inventory → `TooManyOpenLongs` → `InsolventMint` → `open_long`; the `balance_b > 0` stub is **deleted** |
| `MintPosition` | Orca-side accounts are `Option`; `MintShortAccounts::resolve` re-asserts them on the short path |
| Errors | `InsolventMint`, `MissingOpenLong`, `TooManyOpenLongs` — **appended**, on-chain codes 6031–6033 |
| `scripts/reconcile.mjs` | now also checks `open_longs == count(open LONG)` per user |

**Not shipped, on purpose**: any P&L instruction, any oracle or TWAP, liquidation, an admin setter for the risk params.

## 2. The rule, and how it is held

> **Free USDC can never drop below what the user's open longs already owe plus a margin for what they will owe next.**

```
required = premium_owed_usdc + Σ_i ( payable_if_settled_now_i + required_margin(L_i) )
withdraw : free_b − amount_b ≥ required                          else InsolventWithdrawal
long mint: free_b             ≥ required + required_margin(L_new) else InsolventMint
```

Four properties make the check trustworthy rather than merely present:

1. **It reads the positions, not a stored total.** Accrual advances every slot, so any aggregate is stale a slot later. The caller passes every open long; `collect_open_longs` deserializes each with `Account::try_from` (program owner + discriminator), re-derives its PDA from `(market, owner, nonce, bump)`, checks market / owner / leg / status, deduplicates, and requires **`count == open_longs` in both directions**. N distinct valid open longs out of exactly N existing is the whole set (R5, R9).
2. **It projects the index.** `withdraw_collateral` does not run the poke prefix, so the stored `GlobalPremiumIndex` can lag. `projected_index` adds `(now − last_update_slot) × rate` on the stack — the exact value `update_index` would write — so "open, wait, withdraw before anyone cranks" is refused (R7). Nothing is written.
3. **It rounds up, and that does not disturb 08.** `payable_if_settled_now` ceils where `payable_from` floors-with-carry; since nothing is settled, crank frequency stays neutral, and `ceil ≥ floor` guarantees a passing withdraw leaves enough for the next real settle.
4. **Short users see nothing.** `open_longs == 0` → empty set, index not read, sum empty, gate reduces to the component-03 check. `tests/collateral.ts` passes unchanged.

Audited by grep after the fact: `open_longs` is written in exactly two places (`position.rs` open/close); no `balance_b > 0` remains; no `calculate_pnl` or intrinsic-value code exists anywhere; every solvency helper takes shared references only.

## 3. Three findings worth recording

### 3.1 A long mint could not carry its own longs — measured, not guessed

The plan set `MAX_OPEN_LONGS = 8` "pending measurement". The first run of `tests/risk-solvency.ts` failed R8 and R9 with `Transaction too large: 1255 > 1232` — and R1 with **1252 B at zero longs**, because a mint paid for by a different fee payer carries a third signature. `MintPosition` was shared between legs, so a LONG mint hauled all 28 short-mint accounts (~1188 B) and had room for one remaining account.

Two honest options: drop the bound to 1, or take the Orca-side accounts off the long path. The second is the pattern `BurnPosition` already uses: fifteen accounts became `Option`, a long passes `null` and signs with no position mint, and `MintShortAccounts::resolve` re-asserts every constraint (including `is_signer` on the position mint, which `Option<Signer>` only checks when present) before any CPI.

| Instruction | Before 09 | After 09 |
|---|---|---|
| `mint_position` SHORT | 1156 B / 28 accts | **1156 B / 28 accts** — byte-identical, as the plan required |
| `mint_position` LONG, 0 existing | ~1188 B (shared struct) | **612 B / 13 accts / 31.6k CU** |
| `mint_position` LONG, 7 existing | *1255 B — over* | **843 B / 20 accts / 56.6k CU** |
| `withdraw_collateral`, 1 long | — | **524 B / 12 accts** |
| `withdraw_collateral`, 8 longs | — | **755 B / 19 accts / 49.8k CU** |
| `burn_position` SHORT | 960 B | 960 B |
| `settle_premium` | 476 B | 476 B |

`MAX_OPEN_LONGS = 8` holds with ~390 B to spare on the worst case. Recorded in ADR-0003.

### 3.2 The demo margin is `L µUSDC + 1 USDC`, and the harness had to learn that

At the shipped defaults `horizon × rate × mult / SCALE == 1` exactly, so `required_margin(50e6) = 51 USDC`. That is a coincidence of the demo numbers and is called out in `state.rs`, `tests/factory.ts` and the spec so nobody reads it as a law. Its practical consequence: `position-long.ts`'s "hog" test mints *all* availability, and `settle-premium.ts` had been leaking a 100e6 seed short per run — so on the second pass the hog would have needed >200 USDC of margin. The user chose to keep the 1,000-slot horizon and fix the harness: seed shorts are now burned in `after()`, helpers read `Market.long_margin_*` and top up to what the margin requires, and every withdraw helper passes the open-long set unconditionally so one failing test cannot cascade into `MissingOpenLong`.

### 3.3 The docs promised the gate before it existed

Nine living-spec sites asserted a solvency check that protected users *today* (`08:113,263`, `ADR-0002:87`, `03:7,93-94`, `COMPONENT-INDEX:29`, `INSTRUCTIONS:35`, `MVP-SCOPE:26`, `06:47-48,64`). `08 §E` went further: its long-burn pseudocode credited intrinsic value with no counterparty, and its short-burn pseudocode applied P&L on top of `close_short`'s already-realized `returned − locked`. Every one was corrected in Phase 0, before any Rust, and R6 now asserts the short-burn rule as a regression test: free balances move by exactly `returned − locked` (plus any premium claimed from the escrow) and nothing else.

## 4. Test coverage

`tests/risk-solvency.ts` (10): the market carries the demo params and the `L + 1 USDC` identity; **R1** a second user withdrawn to exactly 1 µUSDC cannot open a 1-unit long (`InsolventMint`; passed under the stub); **R2** with margin the long opens and `open_longs` moves inside `open_long` / `close_long`; **R3** an open long's accrued premium blocks a withdrawal while `premium_owed_usdc == 0` and the position is untouched; **R4** after `settle_premium` the remainder is withdrawable; **R7** with the stored index provably untouched since mint, the withdrawal is still refused; **R5** omitting a long from the set fails withdraw *and* a second mint; **R9** padding the set with a duplicate, another user's long, or a burned long's key fails; **R8** the ninth long is refused and a withdraw carrying all eight fits; **R6** short burn moves exactly `returned − locked`.

Unit (`risk.rs`, 10): margin at defaults, round-up, overflow → `MathOverflow` not wrap; no-longs reduces to legacy; locked funds unreachable; open-long accrual blocks; projection counts uncranked slots; long mint needs both margins; `payable_if_settled_now` does not mutate; ceil vs floor. Plus `position.rs`: the counter tracks status and fails closed.

`scripts/reconcile.mjs` on a product-path-only ledger:

```
open_longs counters: 2 users checked, 0 mismatched
conservation A: 0
conservation B: 0
ESCROW IDENTITY HOLDS FOR EVERY RANGE
```

After three full passes including the adapter harness: −12 on both sides (three runs × the documented −4), identities and counters still holding.

## 5. Residual risks

1. **An underwater long is still stuck.** Margin covers `horizon` slots (~6.7 min at the demo rate). Past that, with no settle and no deposit, the position cannot close (08 §G) and there is no liquidation. That is the Fair MVP boundary, unchanged and recorded.
2. **The margin is demo-tuned.** `L µUSDC + 1 USDC` is not fair value and would not survive a mainnet parameterisation; a real one is a different ADR.
3. **Short mint and `lock_collateral` are not long-aware.** Both move free → locked without consulting the gate. Not an extraction vector (tokens exit only via the gated withdraw; unlock / short burn return funds to free first), but a short's impermanent loss can shrink the pot below a long's margin. Documented in ADR-0003; not coded.
4. **A future `set_market_risk_params` (component 10) must re-validate `horizon × rate × mult` against a max-L bound**, or a large parameter makes `required_margin` overflow for existing longs and bricks their owners' withdraws. Overflow at mint is harmless; overflow at withdraw locks funds.
5. **`MAX_OPEN_LONGS = 8`** per user per market. Room remains to raise it.
6. **`premium_index` is unchecked on withdraw.** Derived and compared to the PDA in the handler; deserialized only when `open_longs > 0`. A user with no longs on a ledger where the index does not exist yet is the normal fresh-ledger case, and correct — no long can predate the first mint.
7. **The two `after()` hooks are now load-bearing for order-independence** (drain longs, burn seed shorts). A suite added later that leaves inventory behind will surface as a margin failure in `position-long.ts`, not in itself — the same shape as 08's residual #3.3.
8. **Still red before this component**: `cargo fmt --check` (files 09 never touched). Own commit.

## 6. Scope compliance

| Boundary | Held |
|---|---|
| No price / TWAP / oracle | ✅ nothing reads a price; `OracleDeviationTooHigh` not added |
| No P&L instruction; no second short PnL; no long intrinsic credit | ✅ grep-clean; R6 regression test |
| No liquidation / force-exercise | ✅ |
| No admin setter for risk params | ✅ deferred to 10 with the overflow requirement stated |
| Historical `IMPL-*` reports untouched beyond one-line notes | ✅ |
| Short mint byte-identical | ✅ 1156 B |
| poke-before-weights, `PREMIUM_SCALE`, floor-with-carry unchanged | ✅ |
| `--arch v0`, `anchor-lang 1.2.0`, no client `anchor` feature | ✅ `e_flags == 0` |
| No `cargo fmt` drive-by | ✅ |
| Component 10 not started | ✅ |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
