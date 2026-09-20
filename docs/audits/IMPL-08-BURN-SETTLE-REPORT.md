# Component 08 — Burn & Settle (premium cash) — Implementation Report

**Date**: 2026-09-20
**Phase 0 gate**: [`IMPL-08-FEASIBILITY.md`](IMPL-08-FEASIBILITY.md) — **GO**
**Specs**: [`08-burn-settle.md`](../02-mvp-components/08-burn-settle.md) §A–G, [`07-premium-engine.md`](../02-mvp-components/07-premium-engine.md), [ADR-0002 + addenda](../adr/ADR-0002-premium-accounting.md)

## Status: **shipped — premium cash only; P&L deferred to 09**

Component 06 closed with an honest gap, recorded in its own report as residual #2: longs
accumulated `premium_owed_usdc` with no way to discharge it, and shorts accrued entitlement
they could not claim. That gap is now closed in tokens, not in bookkeeping.

| Suite | Before | After |
|---|---|---|
| Rust unit | 48 | **54** (+5 premium cash, +1 `PendingPremium`) |
| `tests/settle-premium.ts` | — | **10 / 10** *(new)* |
| `tests/position-long.ts` | 9 / 9 | **9 / 9** |
| `tests/position-short.ts` | 7 / 7 | **7 / 7** |
| `tests/collateral.ts` | 11 / 11 | **11 / 11** |
| `tests/factory.ts` | 9 / 9 | **9 / 9** |
| `tests/adapter.ts` | 12 / 12 | **12 / 12** |
| `tests/adapter-liquidity.ts` | 8 / 8 | **8 / 8** |
| `tests/factory-rewards.ts` | 2 / 2 | **2 / 2** *(own ledger)* |

**66 integration tests, four full passes of the final build** across two fresh ledgers —
forward twice on one, reverse-then-forward on the other — all identical. Plus three
consecutive `settle-premium.ts` runs against a single ledger, to prove the suite is
re-runnable and not quietly depending on virgin state. Suites are order-independent.

---

## 1. What shipped

| Item | Detail |
|---|---|
| `range_vault` | PDA `["range_vault", market, lower_le, upper_le]`, mint `token_mint_b`, owner `market_authority`. Created **with the range, by the first short**, via hand-built `create_account` + `InitializeAccount3` (no `anchor-spl`, ADR-0001) |
| `settle_premium` | One instruction, two legs. LONG: permissionless crank. SHORT: owner only |
| Long burn | Settles in cash **before** closing; cannot close if free USDC will not cover it |
| Short burn | Claims **while still inside `total_short_liquidity`**, then the weight decrement, then the Orca 3-step close |
| `position_status::PENDING_PREMIUM` | A short with an unfunded claim keeps its account — and its rent — until settled |
| `PermaPosition.premium_receivable` | The carried, unfunded part of a short's claim |
| `premium.rs` | `claim_short_amount`, `apply_short_claim`, `apply_long_payment` — pure, 5 new unit tests |
| `position::close_long` | **Stops writing `premium_owed_usdc` entirely** |
| `scripts/reconcile.mjs` | Reconciles both identities over RPC, from outside the program |

**Explicitly not shipped:** P&L (§E steps 3–4), oracle, TWAP, liquidation, range unwind,
dust sweep, any admin path that moves user funds, any instruction that forgives a debt.

## 2. The one rule this component exists to enforce

> **Never clear without transferring.**

It is held structurally, not by convention: **every decrement of a liability sits in the
same function body as the transfer that funds it.** There is no settle instruction that
only touches the ledger, and no ledger helper that can be called without one.

Verified by auditing every mutation site in the diff:

| Site | Function | Transfer |
|---|---|---|
| `lib.rs:1195` `premium_owed_usdc -=` | `settle_long_cash` (opens 1153) | `spl_transfer` at **1177** |
| `lib.rs:1556` `premium_owed_usdc -=` | `pay_long_premium_cash` (opens 1527) | `spl_transfer` at **1543** |
| `premium.rs:173` `premium_pool -=` | `apply_short_claim` | called only from `settle_short_cash` and `claim_short_premium_cash`, both after their transfer |

The clear is also never *larger* than the transfer — `min(premium_owed_usdc, payable)` —
so every unit forgiven is a unit that moved.

## 3. Three findings worth recording

### 3.1 The escrow was nearly the collateral vault

Caught in Phase 0 and written up there, repeated here because it is the load-bearing
design decision: the first prototype derived `range_vault` as
`ATA(market_authority, devUSDC)` — which **is `Market.vault_b`**, byte for byte. The
measurement gave it away by growing the transaction **1 byte instead of 32**.

Had it shipped, premium escrow and collateral would have shared one account, and neither
`range_vault.amount == premium_pool + dust` nor `vault + Σ in_orca == Σ(free + locked)`
could have been checked at all. The correct address is a PERMA PDA, not the canonical ATA.

### 3.2 The V5 range picker collided by birthday

V5 needs a range whose premium pool provably starts at zero, so it cannot use the demo
range. The first version picked a second range pseudo-randomly — but there are only **79**
candidate ranges inside the two TickArrays the validator clones, so repeated runs against
one ledger collide surprisingly soon. It survived three passes and failed on the fourth.

It now *searches* for a range no run has touched. Deterministic, cannot collide until all
79 are consumed, and it fails with a message that says so rather than with
`expected { …(6) } to equal null`.

### 3.3 Suite nonce bases overlapped, and only a 7th suite exposed it

Four suites derived their position nonces from `Date.now() % 1e9`, all evaluated at module
load — within a few milliseconds of one another. With six suites the blocks never quite
collided. Adding `settle-premium.ts` pushed them into each other, and the symptom appeared
in **an unrelated test in a different file** (`position-short.ts`, "rejects an unknown leg
type") as `Allocate: account already in use` — a failure whose message says nothing about
nonces. Each suite now owns a disjoint 1e9 block.

3.2 and 3.3 are the same shape: **a test that passes because the ledger happened to be
clean**. Neither was a program bug, and both would have resurfaced on whoever ran the
suites next.

## 4. Measured transaction cost

| Instruction | Before 08 | After 08 | Headroom |
|---|---|---|---|
| `mint_position` SHORT | 1123 B / 27 accts | **1156 B / 28 accts / 146,307 CU** | **76 B** |
| `burn_position` SHORT | 927 B / 24 accts | **960 B / 25 accts / 119,315 CU** | 272 B |
| `settle_premium` | — | **476 B / 11 accts / 29,764 CU** | 756 B |

Phase 0 predicted ~1155 B for short mint; measured 1156. Settle is small because it touches
no Orca account at all.

## 5. Test coverage

`tests/settle-premium.ts` (10): the escrow is a distinct, correctly-owned devUSDC account;
a long settle moves USDC out of `vault_b` and into the escrow with `premium_pool` matching
the tokens; **two settles cost exactly what one would**, to the µUSDC; a sub-µUSDC long is
refused with `NothingToSettle`; **a stranger may crank a long** and earns nothing for it; a
stranger may **not** claim a short (`Unauthorized`); a short claim moves cash the other way;
**V5 end-to-end** — short burns into an empty pool, ends `PendingPremium` carrying its
claim, a long funds the range, the short claims exactly what it carried and the account
closes with its rent returned; the V5 range's escrow identity; and withdraw is unobstructed
because nothing was left owed.

`range_vault.amount == premium_pool + dust` is asserted after **every** settle path.
`vault_b + Σ in_orca_b == Σ(free_b + locked_b)` is asserted around both premium directions —
it survives them because each transfer is paired with an equal ledger move.

Independently reconciled over RPC by `scripts/reconcile.mjs` after a full run of the
**product path** (`collateral` → `position-short` → `position-long` → `settle-premium`):

```
ranges: 2
  [-40272,-38152] vault=2 pool+dust=2 receivable=0 OK
  [-40176,-38168] vault=3645045 pool+dust=3645045 receivable=0 OK
conservation A: 0
conservation B: 0
Σ premium_owed_usdc across all users: 0
Σ premium_receivable across positions: 0
ESCROW IDENTITY HOLDS FOR EVERY RANGE
```

**Exactly zero**, both sides. Adding `tests/adapter-liquidity.ts` to the same ledger moves
it to **−4 per run** — isolated and confirmed by reconciling before and after that one
suite. That is the low-level harness behaving as designed: `adapter_add_liquidity` /
`adapter_remove_liquidity` move vault tokens directly without touching any
`UserCollateral`, which is precisely why they are guarded against ranges with open longs.
It is not an 08 regression, and `reconcile.mjs` now says so rather than leaving the next
reader to re-derive it.

A later run left a `PendingPremium` short alive on a shared ledger, and the reconciliation
caught the mirror invariant live: `receivable=49999` on the range, `Σ premium_receivable
across positions: 49999`. The range-level total and the sum of the individual carries agree
exactly — which is what stops a short from being paid twice, or from being quietly dropped.

New tests rethrow `chai.AssertionError` rather than string-matching `assert.fail` messages
(06 residual #6). The same fix was applied to `tests/adapter.ts` — see residual 4 below.

## 6. Residual risks

1. **Short mint has 76 bytes of headroom** — roughly two more accounts. Component 09 will
   want price accounts. Measure before adding; the escalation is a dedicated
   `initialize_range` instruction (same "vault exists from t=0" guarantee, zero growth on
   mint) or address lookup tables.
2. **`dust` is declared but never written.** The rounding residue is real, but it stays
   inside `premium_pool` where it is indistinguishable from entitlement nobody has claimed
   yet. Separating them would mean recomputing every open short's claim on every poke —
   the O(n) work the accumulator exists to avoid. The identity is still exactly checkable;
   what is *not* available is a number meaning "residue so far".
3. **No range unwind and no dust sweep.** Nothing closes a range or moves the residue.
   Both would move funds with no user to attribute them to, which is a governance question
   this MVP does not answer. Left unimplemented rather than guessed at.
4. **`tests/adapter.ts`'s allowlist test never tested the allowlist.** The pool it passes
   was not in the validator's clone set, so the call failed at Whirlpool deserialization
   (`InvalidWhirlpoolAccount`) and the assertion's `AccountNotInitialized` alternative
   matched. The pool is now cloned and the assertion narrowed to `WhirlpoolNotAllowlisted`.
   Same family as 06 residual #6: an assertion loose enough to pass for the wrong reason.
5. *(2026-09-20: unchanged by component 09 — margin covers the horizon, not eternity; still no liquidation.)* **An underwater long cannot close.** By design (§G), and there is no liquidation in the
   Fair MVP (`PRD.md` §A2), so such a position is stuck until its owner deposits more USDC.
   Component 09 owns the real answer.
6. *(2026-09-20: closed by component 09 per ADR-0003.)* **Long solvency is still a stub** (`balance_b > 0`). A long with 1 µUSDC can accrue
   premium it cannot pay; it simply cannot close. Component 09.
7. **`premium_owed_usdc` can only ever decrease now.** Nothing in 08 increases it, so the
   component-03 withdraw gate protects debts recorded by component 06 and nothing else.
   Settle pays those down — `min(owed, payable)` — meaning a legacy debt is discharged by
   cash that also covers fresh accrual. Acceptable because such debts exist only on
   pre-08 demo ledgers and no new ones can be created; recorded rather than hidden.
8. **`update_index` uses `Clock::slot`.** Correct on-chain; a validator restart with a reset
   slot clock makes elapsed time appear to jump. Monotonicity protects the index, not the
   economics.
9. **`cargo fmt --check` is red, and was before this component.** Diffs span
   `adapter.rs` and `collateral.rs`, neither touched here. `yarn lint` therefore fails on
   formatting alone. Left alone deliberately: running `cargo fmt` would reformat files
   unrelated to 08 and bury the component's diff. Worth its own commit.
10. **The build prints seven `Error: Function … overflows the maximum allowed frame space`
   lines.** All seven name `orca_whirlpools_client` TickArray deserializers, not PERMA
   code, and the build succeeds. PERMA derives TickArray PDAs and forwards them to Orca
   without ever deserializing one, so the offending functions are never reached — but the
   lines say `Error:`, which is exactly the sort of thing a reader learns to scroll past.
   Now documented in `RELEASE-GATE.md` §4.1 so a *new* name in that list stands out.
11. **The local validator degrades after repeated full runs.** Seen twice: a pass takes ~6
   minutes instead of ~45 s and transactions start failing `TransactionExpiredTimeoutError`
   at the 30 s confirmation limit. The signature is unmistakable and rules out a program
   fault — the *first* suites in the run pass and everything after a certain point times
   out, regardless of which suites those are; the same set passes immediately on a restarted
   validator. `waitSlots` now polls gently rather than competing for the slots it waits on,
   which helps but does not remove it. **Restart the validator between long sessions**; if a
   run reports timeouts, re-run on a fresh ledger before believing the failure.

## 7. Scope compliance

| Boundary | Held |
|---|---|
| Clearing `premium_owed_usdc` without a transfer | ✅ impossible — audited site by site, §2 |
| Silent-forgive instruction | ✅ none added |
| Admin path moving user funds | ✅ none; `debit_usdc`/`credit_usdc` stay `pub(crate)` |
| Real P&L / oracle / TWAP (09) | ✅ none invented; P&L is 0 and the spec says so |
| Liquidation | ✅ none |
| `range_vault` ≠ `Market.vault_b` | ✅ distinct PDA, asserted in tests |
| poke-before-weights, `PREMIUM_SCALE`, rounding | ✅ unchanged |
| Multi-leg, Raydium, UI | ✅ untouched |
| `--arch v0`, `anchor-lang 1.2.0`, no client `anchor` feature | ✅ `e_flags == 0` verified |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
