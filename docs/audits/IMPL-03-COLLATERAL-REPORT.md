# Component 03 — Collateral Manager — Implementation Report

**Date**: 2026-09-19
**Phase 0 gate**: [`IMPL-03-FEASIBILITY.md`](IMPL-03-FEASIBILITY.md) — **GO**
**Spec**: [`03-collateral-manager.md`](../02-mvp-components/03-collateral-manager.md)

## Status: **shipped**

Users can deposit, withdraw, lock, and unlock real SPL collateral, and the vault balances are now answerable to a per-user ledger. Every prior suite stayed green **and the liquidity suite now funds its vaults through the real deposit path** instead of injected balances.

| Suite | Before | After |
|---|---|---|
| Rust unit | 11 | **29** (+18 collateral/risk) |
| `tests/collateral.ts` | — | **11 / 11** |
| `tests/factory.ts` | 9 / 9 | **9 / 9** |
| `tests/factory-rewards.ts` | 2 / 2 | **2 / 2** |
| `tests/adapter.ts` | 12 / 12 | **12 / 12** |
| `tests/adapter-liquidity.ts` | 8 / 8 | **8 / 8** *(now deposit-funded)* |

Two full ordered passes, identical results.

---

## 1. What shipped

| Item | Detail |
|---|---|
| `UserCollateral` | `["collateral", market, owner]` — `balance_a/locked_a` (WSOL), `balance_b/locked_b` (devUSDC), `premium_owed_usdc`, `open_positions`, `bump` |
| `collateral.rs` | `deposit`, `withdraw_free`, `lock`, `unlock`, `debit_usdc`, `credit_usdc` — pure, checked, 13 unit tests |
| `risk.rs` | `check_withdraw_allowed` — the single seam component 09 replaces; 5 unit tests |
| Instructions | `deposit_collateral`, `withdraw_collateral`, `lock_collateral`, `unlock_collateral` |
| Errors | `InsufficientFunds` `0x01`, `InsolventWithdrawal` `0x02`, `InsufficientCollateralForLoss` `0x53`, `PositionsOutstanding`, `ZeroAmount`, `MarketPaused` |
| Events | `CollateralDeposited/Withdrawn/Locked/Unlocked` |

All four instructions reject when `market.is_paused`. No second vault system: the collateral vaults **are** `Market.vault_a/vault_b`.

## 2. Phase 0 answers, as built

**Q1 — WSOL, not native SOL.** `Market.vault_a` is a WSOL SPL account and the adapter is SPL end-to-end; tracking lamports alongside WSOL would give one asset two representations with no reconciliation. Fields are side-neutral (`balance_a`/`balance_b`) and mirror `Market.vault_a/vault_b`. Recorded as an ADR-0002 addendum.

**Q2 — conservation, scoped honestly.** The general invariant is

```
vault_s.amount + orca_exposure_s == Σ_users (balance_s + locked_s)
```

`orca_exposure_s` is **not tracked in 03**. `PermaPosition.deposited_*` looks like the right field but is cumulative, not current — 01B adds on every increase and never subtracts on decrease, so it over-counts after any partial remove. Component 05 owns it.

The suite therefore **pins a baseline** rather than asserting a bare equality: it measures `vault − Σ(free+locked)` in `before`, then requires that figure to be unchanged after every operation. That is strictly stronger than a one-shot equality — it proves each deposit/withdraw/lock/unlock conserves to the unit — and it stays valid when the liquidity suite has already parked tokens in Orca. On a pristine ledger the baseline is `0`, which is the literal invariant.

**Q3 — solvency stub, labelled as one.** `09-risk-solvency.md` defines no numeric margin parameters, so none were invented. `check_withdraw_allowed` enforces free-balance sufficiency and premium seniority, and its doc comment states in the first line that this **is not solvency**. Locked funds need no explicit guard: withdraw debits `balance_*` only, so they are unreachable by construction.

**Q4 — premium hooks, no backdoor.** `debit_usdc`/`credit_usdc` are `pub(crate)` with unit tests covering seniority, underflow, and round-trip exactness. The `RANGE_VAULT` seed constant is fixed. **No instruction ships** — an admin-gated settlement instruction was rejected because it would deploy a path where the admin can move user funds, which 08 would then have to remove. The matching token transfer is unexercised and §5 says so.

**Q5 — CEI.** Every handler is validate → mutate ledger → transfer → emit. A failed transfer reverts the whole transaction, so accounting can never lead the vault.

**Q6 — fixtures migrated.** See §3.

**Q7 — `--reset` required.** `UserCollateral` is new; `Market` grew in 02. Documented in `README.md`.

## 3. The fixture migration

Previously `make-fixtures.mjs` injected 10 WSOL / 1000 devUSDC directly into `Market.vault_a/b`, owned by nobody. Any conservation check would have failed immediately.

Now:

| Account | State |
|---|---|
| user WSOL ATA `J93Mdz…3UZQ` | funded 10 WSOL |
| user devUSDC ATA `A728HN…Lcmx` | funded 1000 devUSDC |
| `vault_a` / `vault_b` | emitted at **amount 0** |

The vaults still have to *exist* — `create_market` validates their mint and owner — but they are filled only by `deposit_collateral`. The script reads `ANCHOR_WALLET`, so fixtures are per-machine; regenerate after switching wallets.

`tests/adapter-liquidity.ts` keeps **every** assertion; its `before` hook now deposits 2 WSOL / 200 devUSDC through the real instruction before any adapter CPI. The demo path is genuine end-to-end: user ATA → `deposit_collateral` → vault → Orca.

## 4. Test table

### Rust unit — 18 new

`collateral.rs` (13): round-trip exactness; over-withdraw rejected **and state unchanged**; lock/unlock conserve the per-user total; locked unreachable by withdraw; `debit_usdc` refuses to touch `locked_b` even when the user's *total* would cover it; credit overflow rejected; sides independent; and a mixed sequence of internal moves that must not change either total.

`risk.rs` (5): free-balance limits per side; locked excluded; `premium_owed_usdc` blocking a USDC withdrawal below the liability; zero liability inert.

### `tests/collateral.ts` — 11

Deposit credits free and moves tokens; withdraw debits and returns; over-withdraw → `InsufficientFunds`; lock moves free→locked **without moving tokens**; locked cannot be withdrawn; unlock restores; wrong-mint ATA → `InvalidAsset`; zero-amount → `ZeroAmount`; non-owner withdrawal rejected by seeds/`has_one`; a second signer cannot deposit from an ATA they do not own; plus conservation asserted after **every** mutating step.

## 5. One bug worth recording

The first run failed every vault→user transfer with `MissingRequiredSignature`. Cause: in the hand-built SPL transfer I set the authority's `is_signer` to `signer_seeds.is_none()` — reasoning that a PDA "isn't really signing". That is backwards. The authority is **always** `is_signer = true`; `invoke` vs `invoke_signed` only changes *who supplies* the signature — the user's key, or the runtime deriving it from the seeds. Fixed, with the explanation kept in a comment at the site.

## 6. Residual risks

1. **`orca_exposure` untracked**, so the full conservation invariant is not machine-checked while a short is open. Component 05 must add it; until then the baseline-pinning approach is the strongest available check.
2. **Solvency is a stub.** No PnL, no TWAP, no margin requirement. A user with a losing position can still withdraw free collateral. Component 09.
3. **`debit_usdc`/`credit_usdc` token transfers are unexercised** — only the arithmetic is proven. The `range_vault` ATA is never created in 03; `premium_pool`/`dust` state does not exist yet. Component 08.
4. **`lock`/`unlock` are user-signed.** Harmless today (a user can only shuffle their own free↔locked), and `open_positions` already blocks unlocking behind a live position — but component 05 must be the one to increment that counter, or the guard stays inert.
5. **`init_if_needed` is enabled.** Re-init is blocked two ways — PDA seeds bind the account to the signer, and identity fields are written only when `owner == default` — but the feature carries a standing warning and deserves a second look in any audit.
6. **Fixtures are wallet-keyed**, so CI must regenerate them rather than committing a machine's copy.
7. **Pause is enforced but never set.** `market.is_paused` is honoured by all four instructions; nothing can flip it until component 10.

## 7. Scope compliance

| Boundary | Held |
|---|---|
| Components 04–11 | ✅ no mint/burn, premium index, full solvency, or pause admin |
| Second vault system | ✅ none — collateral lives in `Market.vault_a/b` |
| Invented margin formulas | ✅ none |
| `anchor-spl` added | ✅ no — hand-built SPL transfer, dependency graph unchanged |
| `--arch v0`, `anchor-lang 1.2.0`, no client `anchor` feature | ✅ |
| Mock Whirlpool / forged mint | ✅ none |
| Liquidity CPI coverage reduced | ✅ no — 8/8, now deposit-funded |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
