# Components 04 + 05 (Position Engine + Short Mint) — Phase 0 Feasibility

**Date**: 2026-09-19 · **Specs**: [`04-position-engine-1leg.md`](../02-mvp-components/04-position-engine-1leg.md), [`05-short-mint.md`](../02-mvp-components/05-short-mint.md)
**Stack**: anchor-cli `1.2.0`, solana `3.0.0`, `--arch v0` — unchanged.

## Verdict: **GO**

---

## Q1 — One product instruction vs the adapter harness

**Evidence.** `lib.rs` exposes 11 instructions. Four are adapter-level: `adapter_open_position`, `adapter_add_liquidity`, `adapter_remove_liquidity`, `adapter_close_position`. They work (01B: 8/8 with real CPI) but **nothing connects them to collateral** — opening a short today means four hand-assembled calls and no `UserCollateral` involvement at all.

**Decision.** Add `mint_position` / `burn_position` as the product path. Keep the `adapter_*` instructions **public and unchanged**, documented as harness-only: they carry the `0x1775` / `0x177c` regression guards, which need low-level control the product path deliberately does not expose. Deleting them to "clean up the surface" would delete the proof that the Orca sequence is correct.

## Q2 — PDA and account model

**Evidence.** Live `PermaPosition` (`state.rs`) holds `market`, `owner`, `orca_position`, `position_mint`, ticks, `liquidity`, `deposited_a/b`, `nonce`, `bump`, with seeds `["perma_position", market, owner, nonce]`. Spec `04` asks for `["position", market, owner, position_id]` plus `leg_type`, `status`, and premium checkpoints.

**Decision: evolve in place.** Add `leg_type`, `status`, `in_orca_a/b`, `locked_a/b`. **No second Position account** — a parallel struct for shorts would duplicate the Orca 1:1 mapping ADR-0001 fixed.

**Deviation recorded:** seeds stay `["perma_position", …, nonce]`. Renaming to `["position", …]` would change every derivable address in the working 01B and 03 suites for zero behavioural gain, and there is no deployed state worth migrating. Same class of documented deviation as 02's single-pubkey allowlist.

**Premium checkpoints (`entry_index`, `accrued_scaled`, `entry_acc_q64`, `premium_receivable`) are deliberately NOT added.** They belong to 07/08. Shipping them zeroed would make the account look wired when nothing writes it — the same mistake 02 avoided by refusing a placeholder `risk_params`.

## Q3 — Locking before the CPI

**Evidence.** Nothing on-chain quotes required token amounts; Whirlpool liquidity math is not implemented in PERMA, and doing it on-chain would be heavy and duplicative.

**Decision.** Client supplies `liquidity` + `token_max_a/b`. The program:

1. verifies free balance ≥ `token_max_*` (→ `InsufficientFunds`),
2. CPIs `increase_liquidity_v2` with those maxes,
3. locks the **observed** vault delta — not the max.

No lock-then-refund dance. Because everything happens inside one instruction, no observer sees an intermediate state, so verifying-then-locking-actuals is equivalent to locking maxes and refunding, with one less state transition to get wrong. Observed deltas are already the house pattern (01B).

## Q4 — Long mint

**Out of scope**, as the prompt defaults. A real long needs `RangePremiumState`, the index poke ordering from ADR-0002, and premium checkpoints — components 06/07/08. Shipping a long that skips the inventory gate would be a fake long. **Nothing long-related is added, not even a stub.**

## Q5 — Burn without the premium engine

Short burn = `decrease_liquidity_v2(all)` → `collect_fees_v2` → `close_position`, then unlock. No `PendingPremium` path (that state exists only to hold an unfunded premium claim, and no premium can accrue yet).

**Documented forward dependency:** when 08 lands, `burn_position` must call `settle_premium` **before** the close sequence, per `08-burn-settle.md` §E.

### The accounting rule

At mint the position records the observed spend `S`. At burn Orca returns `G`, which differs from `S` under impermanent loss or accrued fees. The only rule that preserves `vault + orca == Σ(free + locked)` is:

```
locked -= S      (recorded on the position)
free   += G      (actually returned)
```

Verified numerically for `G == S`, `G < S` (IL, −150), and `G > S` (fees, +120) — conservation holds in all three. `G − S` is realized PnL, absorbed into free balance; **no PnL field is invented**, since Fair MVP has no use for one until 08/09.

## Q6 — Transaction size and CU

01B measured the pieces separately: `open_position` 654 B / 14 accts / 81,964 CU; `increase_liquidity_v2` 820 B / 20 accts / 54,957 CU; `decrease+collect` 821 B / 86,500 CU; `close_position` 442 B / 29,562 CU.

Deduplicating the account union for a combined instruction:

| Instruction | Accounts | Est. bytes / 1232 | Est. CU |
|---|---|---|---|
| `mint_position` (open + increase) | 24 | **~1009** (headroom ~223) | ~137k |
| `burn_position` (decrease + collect + close) | 21 | **~816** (headroom ~416) | ~116k |

Both fit. **These are estimates and this project's estimates have been wrong in both directions** — 01B predicted ~1152 B for open+increase and the real separate transactions were 654 and 820. The real serialized size is therefore measured immediately in Phase 1 via `scripts/measure.mjs`; if `mint_position` overflows, it splits into the documented two-transaction pattern rather than being forced.

## Q7 — Risk on mint

**Evidence.** `09-risk-solvency.md` still defines no numeric margin parameters (02 and 03 both declined to invent them).

**Decision.** Mint solvency = free balance ≥ `token_max_*` → `InsufficientFunds`. **`InsolventMint` is deliberately not used** — that code implies a margin check that does not exist, and raising it would misrepresent the guarantee. Real margin arrives with 09.

---

## Residuals from component 03 this session closes

1. **`open_positions` is read but never written.** `collateral.rs:124` blocks `unlock` on it, but nothing increments it — the guard is currently inert. `mint_position` will `+= 1`, `burn_position` `-= 1`, and a test asserts unlock is genuinely blocked while a short is open.
2. **`deposited_a/b` over-counts.** `adapter_add_liquidity` adds on every increase; `adapter_remove_liquidity` decrements only `liquidity`, never the deposits — so it is cumulative, not current, and cannot serve as `orca_exposure` (exactly why 03 had to pin a conservation baseline instead of asserting the real invariant). Replaced by `in_orca_a/b`, decremented on remove and zeroed at close. **Conservation becomes fully machine-checkable**: `vault + Σ in_orca == Σ(free + locked)`.

## In / out

**In:** `mint_position` (SHORT), `burn_position` (SHORT), `PermaPosition` evolution, `position.rs` orchestration, `open_positions` wiring, `in_orca_*` exposure tracking, product-path test suite, real tx/CU measurement.

**Out:** long mint and inventory (06), premium index and `settle_premium` (07), burn premium settlement and `PendingPremium` (08), full solvency and margin (09), pause admin (10), UI. No `anchor-spl`. No client `anchor` feature. No mock Whirlpool. No second Position account.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
