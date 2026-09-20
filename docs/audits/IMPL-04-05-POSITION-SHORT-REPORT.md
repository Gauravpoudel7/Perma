# Components 04 + 05 — Position Engine + Short Mint — Implementation Report

**Date**: 2026-09-19
**Phase 0 gate**: [`IMPL-04-05-FEASIBILITY.md`](IMPL-04-05-FEASIBILITY.md) — **GO**
**Specs**: [`04-position-engine-1leg.md`](../02-mvp-components/04-position-engine-1leg.md), [`05-short-mint.md`](../02-mvp-components/05-short-mint.md)

## Status: **shipped**

PERMA has a product path. One signature opens a short that locks collateral **and** adds real Orca liquidity atomically; one closes it, runs the 3-step Orca close, and releases the collateral.

| Suite | Before | After |
|---|---|---|
| Rust unit | 29 | **38** (+9 position) |
| `tests/position-short.ts` | — | **7 / 7** |
| `tests/collateral.ts` | 11 / 11 | **11 / 11** |
| `tests/factory.ts` | 9 / 9 | **9 / 9** |
| `tests/factory-rewards.ts` | 2 / 2 | **2 / 2** *(dedicated ledger)* |
| `tests/adapter.ts` | 12 / 12 | **12 / 12** |
| `tests/adapter-liquidity.ts` | 8 / 8 | **8 / 8** |

Two full passes on a clean ledger, identical results.

---

## 1. What shipped

| Item | Detail |
|---|---|
| `mint_position(leg, ticks, liquidity, maxes, nonce)` | **One atomic tx**: validate → check free ≥ caps → CPI `open_position` → CPI `increase_liquidity_v2` → lock the observed spend → `open_positions += 1` |
| `burn_position(mins)` | `decrease_liquidity_v2` → `collect_fees_v2` → `close_position` → release lock, credit returns → `open_positions -= 1` → close the PDA |
| `position.rs` | `open_short`, `close_short`, `reduce_exposure` — pure, checked, 9 unit tests |
| `PermaPosition` | +`leg_type`, `status`, `in_orca_a/b`, `locked_a/b`; `deposited_*` removed |
| Errors | `InvalidLegType`, `PositionAlreadyClosed` |
| Events | `ShortMinted`, `ShortBurned` |

`adapter_*` stay public as documented harness instructions — they carry the `0x1775` / `0x177c` guards, which need low-level control the product path deliberately does not expose.

## 2. Measured, not estimated

| Instruction | Bytes / 1232 | Accounts | CU |
|---|---|---|---|
| `mint_position` | **1057** (headroom 175) | 25 | **126,771** |
| `burn_position` | **861** (headroom 371) | 22 | **109,225** |

Phase 0 estimated 1009 / 816 — within ~5%, so the single-transaction mint was the right call and needed no fallback. Reproduce with `scripts/measure-position.mjs`.

This matters because the estimate could have gone the other way: 01B predicted ~1152 bytes for the same bundle and the real figures came in ~350 bytes lower. Estimates here are directionally useful and not trustworthy to the byte, which is why the plan committed to measuring before believing.

## 3. Both component-03 residuals closed

**`open_positions` is now live.** `collateral.rs:124` blocked `unlock` on this counter, but nothing incremented it — the guard was inert. `mint_position` increments, `burn_position` decrements, and `position-short.ts` test 2 proves `unlock_collateral` is genuinely refused while a short is open.

**`deposited_*` → `in_orca_*`.** The old fields added on every increase and were never decremented on decrease, so they were cumulative rather than current and could not serve as `orca_exposure`. That is exactly why component 03 could only pin a conservation baseline. With `in_orca_*` maintained on both the product and harness paths, the real identity became checkable:

```
vault_s + Σ in_orca_s  ==  Σ_users (balance_s + locked_s)
```

On a clean ledger `position-short.ts` asserts it at **zero discrepancy** after every mint and burn, reconciled over RPC from outside the program.

## 4. The accounting rule

At mint the position records the observed spend `S`. At burn Orca returns `G`, which differs under impermanent loss or accrued fees. The only conservation-preserving rule is:

```
locked -= S      (what this position reserved)
free   += G      (what Orca actually returned)
```

Proven in unit tests for `G == S`, `G < S` (IL, −150), and `G > S` (fees, +120). `G − S` is realized PnL absorbed into free balance; **no PnL field was invented** — Fair MVP has no use for one until 08/09.

Per-position `locked_a/b` is what makes this work with several shorts open: burning one releases exactly its own lock, verified by test 6.

## 5. One honest limitation found during verification

`position-short.ts` pins a conservation **baseline** rather than asserting a bare zero, and the reason is a real gap worth recording.

The harness path (`adapter_*`) moves tokens with **no user attribution**, and `adapter_close_position` closes a `PermaPosition` without zeroing `in_orca_*`. So Orca's round-trip rounding dust — about 1 lamport per close — drops out of the conservation sum with nobody to charge it to. Four closes in `adapter-liquidity.ts` produced a stable 4-lamport discrepancy.

This is unattributable by construction: the harness never knew which user owned those tokens. **The product path has no such gap** — on a clean ledger the baseline is exactly zero. Pinning it asserts that every mint and burn conserves to the unit regardless of what the harness left behind, which is a stronger statement than a one-shot equality that happens to pass.

## 6. Deviations from spec

| Spec | Shipped | Why |
|---|---|---|
| `PDA(["position", market, owner, position_id])` | `["perma_position", market, owner, nonce]` | Renaming changes every derivable address in the working 01B/03 suites for zero behavioural gain, with no deployed state to migrate. Same class as 02's allowlist deviation. |
| `leg_type: Long or Short` | SHORT only; LONG → `InvalidLegType` | A long without the inventory gate would be a fake long. |
| Premium checkpoints on `Position` | **absent** | They belong to 07/08. Shipping them zeroed would make the account look wired when nothing writes it — the mistake 02 avoided with `risk_params`. |
| `PendingPremium` status | absent | Exists only to hold an unfunded premium claim; no premium can accrue yet. |
| `mint_options` / `burn_options` | `mint_position` / `burn_position` | Matches `04`'s "Public Interface". `INSTRUCTIONS.md` updated; the old names marked superseded. |

## 7. Residual risks

1. **No premium settlement at burn.** When 08 lands, `burn_position` **must** call `settle_premium` before the close sequence (`08-burn-settle.md` §E). A comment on the handler says so; nothing enforces it.
2. **No solvency beyond free balance.** Mint checks free ≥ `token_max_*` and deliberately raises `InsufficientFunds`, not `InsolventMint` — the latter implies a margin check that does not exist. Component 09.
3. **Harness dust is unreconcilable** (§5). Consider zeroing `in_orca_*` in `adapter_close_position`, or restricting the harness instructions to `#[cfg(feature = "harness")]` before any real deployment.
4. **No partial close on the product path.** `burn_position` is all-or-nothing; partial removes exist only on the harness path.
5. **Long mint absent**, so the inventory invariant `Σ long ≤ Σ short` is not yet enforceable — nothing can create a long.
6. **Test suites drain fixture ATAs** across repeated runs. All suites now top up only what they need, capped by what remains, and fail with a clear "regenerate fixtures and --reset" message rather than a cryptic SPL `0x1`.
7. **`factory-rewards.ts` needs a dedicated ledger** — it allowlists a different pool, so running it first makes every other suite fail `PoolNotAllowlisted`. Documented in the README; a CI job must keep it separate.

## 8. Scope compliance

| Boundary | Held |
|---|---|
| Long mint / inventory (06) | ✅ LONG rejected; no stub, no `RangePremiumState` |
| Premium index / settle (07/08) | ✅ none |
| Full solvency / liquidation (09/10) | ✅ none |
| UI | ✅ none |
| Adapter/factory/collateral rewritten | ✅ no — extended only |
| CPI proof deleted | ✅ no — `adapter-liquidity.ts` 8/8 intact, guards included |
| `--arch v0`, `anchor-lang 1.2.0`, no client `anchor` feature | ✅ |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
