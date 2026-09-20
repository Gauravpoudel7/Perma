# Component 03 (Collateral Manager) — Phase 0 Feasibility

**Date**: 2026-09-19 · **Spec**: [`03-collateral-manager.md`](../02-mvp-components/03-collateral-manager.md)
**Stack**: anchor-cli `1.2.0`, solana `3.0.0`, `--arch v0` — unchanged.

## Verdict: **GO**

Every Q1–Q7 question below is answered from the repo, with file paths. Two spec-vs-reality conflicts resolved (Q1, Q3); one invariant scoped honestly (Q2).

---

## Q1 — SOL vs WSOL

**Evidence.** `03-collateral-manager.md:19-22` specifies `sol_balance`, `sol_locked`, `usdc_balance`, `usdc_locked`. But the live system is SPL-only:

- `state.rs:59-65` — `Market.token_mint_a/token_mint_b`, `vault_a/vault_b` are SPL token accounts; `create_market` validates their mints against the Whirlpool (component 02).
- The allowlisted pool's `token_mint_a` is **WSOL** `So111…1112`, and `make-fixtures.mjs:102` creates `vault_a` with the `is_native` flag set.
- The adapter moves tokens with SPL transfers (`lib.rs:490,513,535`) — it never touches lamports.

**Decision: WSOL only.** "SOL collateral" means **wrapped SOL held as SPL**. `UserCollateral` uses side-neutral names — `balance_a`/`locked_a` (WSOL, 9 dp) and `balance_b`/`locked_b` (devUSDC, 6 dp) — matching `Market.vault_a/vault_b` so there is no mapping to get wrong.

**Rejected:** dual native-lamport + WSOL bookkeeping. Two representations of one asset cannot be conserved without a wrap/unwrap ledger that nothing in Fair MVP needs. Native-SOL wrapping at deposit time is a UX nicety for a later component, not a collateral model.

Spec rename recorded as an ADR-0002 addendum.

## Q2 — Shared-vault conservation

**Evidence.** The adapter spends **directly** from the PERMA vaults — `lib.rs:741,807` constrain `address = market.vault_a` / `market.vault_b`, and those accounts are passed to Orca as `token_owner_account_a/b`. The adapter does **not** read or write `UserCollateral`; wiring user accounting into mint/burn is component 05.

**General invariant**, per side `s ∈ {a, b}`:

```
vault_s.amount + orca_exposure_s  ==  Σ_users (balance_s + locked_s)
```

**`orca_exposure_s` is not trackable in 03.** `PermaPosition.deposited_a/deposited_b` looks like the right field but is **cumulative, not current**: 01B adds on every increase (`pos.deposited_a.saturating_add(spent_a)`) and never subtracts on decrease. It would over-count after any partial remove.

**The 03 invariant is therefore the zero-exposure case:**

```
orca_exposure_s == 0   ⟹   vault_s.amount == Σ_users (balance_s + locked_s)
```

Asserted exhaustively in `tests/collateral.ts`, which never calls the adapter. The liquidity suite deposits for real but **does not** assert conservation after an adapter CPI — stated openly rather than weakening the check to something that always passes. Component 05 owns `orca_exposure`.

**Model chosen for `locked`:** accounting-only (free → locked), reserved **pre-CPI**. Tokens stay in the vault until the adapter moves them. This is the prompt's option 1 and the only one consistent with the adapter as built.

## Q3 — Solvency before component 09

**Evidence.** `09-risk-solvency.md` defines **no numeric margin parameters** — grepping for `%`, `margin_ratio`, `maintenance`, `initial_margin` returns nothing. Component 02 deliberately shipped no `risk_params` for the same reason ([`IMPL-02-FACTORY-REPORT.md`](IMPL-02-FACTORY-REPORT.md) §2).

**Decision: Option S1 stub**, in a new `risk.rs`, used only by withdraw:

1. `amount > balance_s` → `InsufficientFunds` (`0x01`)
2. free USDC remaining after withdraw `< premium_owed_usdc` → `InsolventWithdrawal` (`0x02`)

`locked_*` is structurally unreachable by withdraw: the instruction debits `balance_*` only, so locked funds cannot be withdrawn by construction rather than by a check that could be forgotten.

`premium_owed_usdc` exists now, defaults to `0`, and is **enforced now / written later** by 07/08. This implements ADR-0002's premium-seniority rule at the withdraw boundary without inventing the premium engine.

**Not done:** `AccountValue >= RequiredCollateral` with PnL and TWAP. `check_withdraw_allowed` is the single seam 09 replaces. This is **not** "solvency complete" and the doc comment says so.

## Q4 — Premium hooks without building 07/08

**Evidence.** `08-burn-settle.md:40` fixes the escrow: `["range_vault", market, tick_lower_le, tick_upper_le]`, authority `market_authority`, USDC only. `:241` requires `range_vault.balance == premium_pool + dust`. ADR-0002 mandates USDC-only premium and vault separation.

**Decision: `pub(crate)` functions + Rust unit tests. No instruction ships.**

`debit_usdc` / `credit_usdc` are pure accounting over `&mut UserCollateral`, unit-tested for seniority (free-only), underflow, and round-trip exactness. The `RANGE_VAULT` seed constant is added so the PDA derivation is fixed now.

**Deliberately not done:** the token transfer between `Market.vault_b` and `range_vault`, and any `premium_pool`/`dust` state. Those need a real caller. An admin-gated settlement instruction was considered and **rejected** — it would ship a deployed path where the admin can move user funds, which 08 would then have to remove. The report states plainly that the transfer half is unexercised.

## Q5 — CEI / re-entrancy

Solana's account locks prevent classic re-entrancy, but ordering still matters for failure atomicity. Every instruction follows the existing house pattern:

**validate → mutate `UserCollateral` → transfer (signed by `market_authority`) → `emit!`**

If a transfer fails the whole transaction reverts, so accounting can never lead the tokens. All balance math uses `checked_*` — **no `saturating_*` on balances**, since a silent clamp is how a ledger quietly loses money. (`saturating_sub` remains correct for *observed vault deltas* in the adapter, which is a different thing.)

## Q6 — Compatibility with the 01B fixtures

**Evidence.** `make-fixtures.mjs:37-38,102` injects 10 WSOL / 1000 devUSDC straight into the **vault** ATAs owned by `market_authority`. Nothing owns those balances, so the Q2 invariant would fail the moment it is asserted.

**Decision: migrate to the real deposit path.** Fixtures now fund the **test wallet's** ATAs; the vaults start empty. Both suites call `deposit_collateral`, so tokens enter the vault through the actual instruction.

Verified derivable per machine — the script reads `ANCHOR_WALLET`, and for the local wallet `7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY` the ATAs are:

| Mint | User ATA |
|---|---|
| WSOL | `J93MdzNbVkKHBh3KwWwS7Y7CjqtqfFHwd1zHgFgw3UZQ` |
| devUSDC | `A728HNbbk6AjiqTsqNt5FbD7cz7xNpeXrx35qetgLcmX` |

The script already handles the `is_native` COption for WSOL. Funding stays ~10 WSOL / 1000 devUSDC — the liquidity suite needs ≈0.034 WSOL + 0.71 devUSDC per position across 8 positions.

**`tests/adapter-liquidity.ts` keeps every existing assertion**; only its `before` hook changes. Real CPI coverage is not reduced.

## Q7 — Layout / validator reset

`UserCollateral` is new and `Market` already grew in component 02. A ledger predating either holds accounts that fail to deserialize.

**`--reset` is required**, documented in `README.md` and `RELEASE-GATE.md` §3 exactly as component 02 did. `tests/factory-rewards.ts` still must run **first** on a virgin ledger, since `GlobalConfig` is a singleton.

---

## Files to touch

| Path | Action |
|---|---|
| `programs/perma/src/state.rs` | `UserCollateral`; `COLLATERAL` + `RANGE_VAULT` seeds |
| `programs/perma/src/collateral.rs` | **new** — accounting + unit tests |
| `programs/perma/src/risk.rs` | **new** — `check_withdraw_allowed` stub |
| `programs/perma/src/errors.rs` | `InsufficientFunds`, `InsolventWithdrawal`, `InsufficientCollateralForLoss`, `PositionsOutstanding` |
| `programs/perma/src/lib.rs` | 4 instructions + contexts + events |
| `scripts/make-fixtures.mjs` | fund user ATAs instead of vaults |
| `tests/collateral.ts` | **new** |
| `tests/adapter-liquidity.ts` | deposit-first setup |
| `Anchor.toml`, `docs/06-testing/RELEASE-GATE.md` | fixture addresses |
| `docs/02-mvp-components/03-collateral-manager.md` | WSOL rename, Done Definition |
| `docs/adr/ADR-0002-premium-accounting.md` | addendum: SOL → WSOL naming |
| `docs/audits/IMPL-03-COLLATERAL-REPORT.md` | **new** |

Out of scope: components 04–11, margin formulas, liquidation, UI, a second vault system.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
