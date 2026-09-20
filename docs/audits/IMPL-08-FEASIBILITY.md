# Component 08 (Burn & Settle — premium cash) — Phase 0 Feasibility

**Date**: 2026-09-19 · **Specs**: [`08-burn-settle.md`](../02-mvp-components/08-burn-settle.md) §A–F, [`07-premium-engine.md`](../02-mvp-components/07-premium-engine.md), [ADR-0002 + addenda](../adr/ADR-0002-premium-accounting.md)
**Stack**: anchor-cli `1.2.0`, solana `3.0.0`, `--arch v0` — unchanged.

## Verdict: **GO**

---

## Q1 — Scope boundary (08 vs 09)

`08-burn-settle.md` §E applies P&L via `risk::calculate_pnl`. **That function does not exist** — grep across `programs/perma/src/` returns zero hits, and 09 still defines no numeric margin or valuation.

**Decision: premium cash only. P&L = 0 stub.** §E steps 3–4 are deferred to 09 and the Done Definition says so. No mark price, no TWAP, nothing invented. Premium settle, `PendingPremium`, and `range_vault` are in; fake P&L is out.

## Q2 — `range_vault` lifecycle

`seeds::RANGE_VAULT` is already declared (`state.rs:29`); the account itself is never created.

**Decision: created with the range, on the first short mint in that tick range**, rent paid by that minter. Every settle path can then assume it exists, and `range_vault.amount == premium_pool + dust` holds from the range's first moment.

### ⚠️ A conflation caught during measurement

The first prototype derived the vault as `ATA(market_authority, devUSDC)` — which **is `Market.vault_b`**, byte for byte. The measurement gave it away: adding the account grew the transaction by **1 byte instead of 32**, because it was already in the account list.

Had that shipped, premium escrow and collateral would have shared one account and the conservation identity `vault + Σ in_orca == Σ(free + locked)` would have become permanently uncheckable — the exact failure `08-burn-settle.md` §A warns about ("It is **not** a bookkeeping number against the shared collateral vault").

The correct address is a **PERMA PDA**: `["range_vault", market, tick_lower_le, tick_upper_le]` — a token account with mint = `token_mint_b` and owner = `market_authority`, at a program-derived address, **not** the canonical ATA. Because `anchor-spl` is deliberately absent (ADR-0001), it is created by hand: `system_program::create_account` + SPL `InitializeAccount3`, the same hand-built style as the existing `spl_transfer` (`lib.rs:1014`).

## Q3 — Clearing `premium_owed_usdc`

Today `burn_long_inner` → `position::close_long` does `premium_owed_usdc += payable` with **no transfer** — the state this component exists to remove.

**Decision: the field is a live liability, and settle both transfers and decrements it — inside one function**, so the two can never drift apart:

```rust
debit_usdc(owner, payable);                               // ledger
spl_transfer(vault_b -> range_vault, payable, seeds);     // tokens
premium_pool += payable;
premium_owed_usdc -= min(premium_owed_usdc, payable);     // clear, paired above
```

**Forbidden, and checked in verification:** any path that decrements `premium_owed_usdc` or `receivable` without an adjacent transfer. The 03 withdraw gate keeps protecting real debt, and pre-08 demo debts become payable rather than stranded. **No silent-forgive instruction is added.**

## Q4 — Long `settle_premium` (permissionless)

Per §C and `INSTRUCTIONS.md`: any signer may crank any **Open** long. Order is
`update_index` → `poke_range` → `accrue_long` → `payable_from` → `require payable > 0 else NothingToSettle` → debit + transfer → `premium_pool +=` → pay down `receivable`.

Rounding is **not touched**: `payable_from`'s floor-with-carry is what makes the permissionless crank safe (ADR-0002 — ceil-per-settle would let an attacker inflate a long's cost by cranking often). Bookkeeping is written before the transfer; a failed transfer reverts the whole instruction, so the ledger can never lead the cash.

## Q5 — Short claim and `PendingPremium`

`position_status` currently has only `OPEN`/`CLOSED`, and `PermaPosition` has **no `premium_receivable`**. Both are added.

Short burn ordering from §E.2 is a **security property**, not style: claim **while the position is still in `total_short_liquidity`** → then poke-before-weights `total_short -=` → then the Orca 3-step close + unlock. Claiming after the decrement would compute the share against a denominator the position is no longer part of.

Status ends `Closed`, or **`PendingPremium`** when `premium_receivable > 0`. A later `settle_premium(short)` that clears the balance closes the account and refunds rent. **V5 ships as an integration test, not a comment.**

## Q6 — Long burn rewrite

Settle cash first (real transfer). If free USDC cannot cover the payable → `InsufficientCollateralForLoss`, **position stays `Open`** (§G). Then poke → `total_long -=` → close. `close_long` stops writing the liability entirely.

**Consequence, recorded rather than hidden:** Fair MVP has no liquidation (`PRD.md` §A2), so an underwater long is stuck until its owner deposits more USDC. That is §G's specified behaviour — the alternative (close anyway, park a shortfall) would reintroduce exactly the liability-without-cash state 08 removes.

## Q7 — Transaction size (06 residual #1)

Measured on a live validator, not estimated:

| Instruction | Before 08 | After `range_vault` |
|---|---|---|
| `mint_position` SHORT | 1123 B / 27 accts / 126,771 CU | **1156 B / 28 accts / 156,263 CU** |
| `burn_position` SHORT | 927 B / 24 accts | **927 B / 24 accts** *(vault added in a later step)* |

**It fits — with 76 bytes of headroom.** Phase 0 predicted ~1155; the measurement is 1156. That is roughly **two more accounts** before short mint breaks the 1232-byte limit, and component 09 will want price accounts. Recorded as the top residual; the escalation is a dedicated `initialize_range` instruction (same "vault exists from t=0" guarantee, zero growth on mint) or address lookup tables.

## Q8 — Conservation identities

Both asserted in integration tests, reconciled over RPC from outside the program:

1. `vault_s + Σ in_orca_s == Σ_users (balance_s + locked_s)` — unchanged from 06
2. **`range_vault.amount == premium_pool + dust`** — new, after every settle path
3. Per-range zero-sum: **`Σ long payments == Σ short claims + dust`** (V2/V3)

Keeping the escrow separate from `Market.vault_b` (Q2) is precisely what makes (1) and (2) independently checkable.

## Q9 — Test harness

`position-long.ts` keeps its `after()` hook draining open longs. New tests **rethrow `chai.AssertionError`** instead of string-matching `assert.fail` messages — 06 residual #6, where a test reported green because chai's own error message contained the substring the `catch` was looking for.

## Verified vectors

| Vector | Setup | Expected |
|---|---|---|
| **V2** | long 1e6 · 100 slots; shorts 3e6 + 1e6 | paid 100 000 → **74 999 / 24 999**, dust **2** |
| **V3** | 3 × 1e6 shorts | **33 333** each, dust **1** |
| **V5** | short burns with empty pool | earned **99 999** → paid 0, receivable **99 999**; long pays 100 000 → short claims **99 999**, pool left **1** |

All satisfy `Σ claims + dust == Σ paid`.

---

## Files to touch

`state.rs` (PENDING_PREMIUM, `premium_receivable`), `errors.rs` (3 settle errors), `premium.rs` (cash helpers + tests), `position.rs` (`close_long` stops writing the liability), `lib.rs` (`settle_premium`, burn rewrites, range-vault creation), `tests/settle-premium.ts` (new), `scripts/measure-position.mjs`, plus `IMPL-08-BURN-SETTLE-REPORT.md`, ADR-0002 addendum, `08-burn-settle.md` checkboxes, README.

**Out:** real P&L / oracle / TWAP (09), liquidation, any admin path moving user funds, forgiving `premium_owed` without transfer, changes to poke-before-weights or `PREMIUM_SCALE`, multi-leg, Raydium, UI.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
