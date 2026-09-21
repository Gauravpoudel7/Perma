# P1 (Production Hardening) — Phase 0 Feasibility

**Date**: 2026-09-21 · **Scope authority**: [`ROADMAP.md` §P1](../09-post-mvp/ROADMAP.md) · **Supporting**: [`COMPLETE-PRODUCT-DEFINITION.md` §Ops](../09-post-mvp/COMPLETE-PRODUCT-DEFINITION.md), [`GAP-ANALYSIS-FAIR-TO-COMPLETE.md`](../09-post-mvp/GAP-ANALYSIS-FAIR-TO-COMPLETE.md), [`ADR-0002`](../adr/ADR-0002-premium-accounting.md) · **Prompt**: [`CLAUDE-IMPLEMENT-P1-PRODUCTION-HARDENING.md`](../prompts/CLAUDE-IMPLEMENT-P1-PRODUCTION-HARDENING.md)

**Stack**: anchor-lang `1.2.0`, `orca_whirlpools_client` 8.0.0 (no `anchor` feature), `--arch v0` — unchanged.
**Baseline**: Fair MVP 01–11 closed at `f6a6a22`; release gate GREEN 2026-09-21 (102 integration, 66 unit).

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

## Verdict: **GO WITH BLOCKERS**

Every in-repo item ships this phase. Two ROADMAP P1 exit clauses cannot be closed from a checkout and are named as blockers rather than quietly claimed.

| Gate condition | State |
|---|---|
| Q0 live inventory cited `file:line` | ✅ below |
| Q1 in-scope / OUT matrix written before code | ✅ below |
| Q2 `transfer_admin` designed with zero layout change | ✅ writes the existing `GlobalConfig.admin` bytes in place |
| Q3 empty-range unwind preconditions provable without inventing policy | ✅ `08-burn-settle.md:232` + `ADR-0002:86` already fix the rule; preconditions are readable from `RangePremiumState` alone |
| Q3a destination pinned | ✅ **Option A** — admin-owned USDC token account; no new PDA |
| Q4 monitoring is scripts + checklist, not an indexer | ✅ `--monitor` mode on the existing `scripts/reconcile.mjs` |
| Q5 commission decided | ✅ **DEFER** with ticket |
| Q6 no realloc, no localnet brick | ✅ no account grows; unwind only closes |
| No premium math / Orca metas / ADR-0003 / Exit Guaranteed change | ✅ by construction |
| **Blocker 1** — ROADMAP exit "Admin authority **is** multisig" | ⚠️ the repo ships the handoff mechanism, the script and the runbook; a Squads vault actually holding `GlobalConfig.admin` is an ops action on a live cluster |
| **Blocker 2** — ROADMAP exit "monitoring checklist live **on devnet**" | ⚠️ `RUNBOOK-DEVNET.md:3` records that no devnet deployment has ever been performed; the checklist ships and is exercised on localnet |

---

## Q0 — Live inventory

### Q0.1 Admin-gated instructions and `require_admin` call sites

`factory::require_admin` is defined at `factory.rs:32` and has exactly four call sites:

| Call site | Instruction |
|---|---|
| `factory.rs:57` (inside `authorize_create_market`, called from `lib.rs:69`) | `create_market` |
| `lib.rs:152` | `pause_market` |
| `lib.rs:168` | `unpause_market` |
| `lib.rs:195` | `set_market_risk_params` |

Admin identity is always checked **in the handler**, never by an Anchor `has_one` or `address` constraint — the `admin: Signer` field carries only a doc comment (`lib.rs:2488`, `lib.rs:2528`, `lib.rs:2542`). The program exposes 17 instructions total; the other 13 are user or harness paths.

### Q0.2 Account layouts (no realloc planned)

| Account | Fields | INIT_SPACE | Seeds |
|---|---|---|---|
| `GlobalConfig` (`state.rs:70-76`) | `admin: Pubkey`, `allowlisted_whirlpool: Pubkey`, `bump: u8` | 65 | `["global_config"]` |
| `Market` (`state.rs:85-123`) | 8 pubkeys, `tick_spacing: u16`, `has_active_rewards: bool`, `is_paused: bool`, `authority_bump: u8`, `bump: u8`, `premium_rate: u64`, `premium_multiplier: u64`, `long_margin_horizon_slots: u64`, `long_margin_buffer_usdc: u64` | 294 | `["market", whirlpool]` |
| `RangePremiumState` (`state.rs:220-261`) | `market`, `tick_lower: i32`, `tick_upper: i32`, `total_short_liquidity: u128`, `total_long_liquidity: u128`, `acc_premium_per_short_q64: u128`, `last_index: u128`, `premium_pool: u64`, `receivable: u64`, `dust: u64`, `bump: u8` | 129 | `["range", market, lower_le, upper_le]` |
| `range_vault` | raw 165-byte SPL token account, mint `token_mint_b`, owner `market_authority` | — | `["range_vault", market, lower_le, upper_le]` |

No manual `LEN` consts exist; every context allocates `8 + T::INIT_SPACE`. **P1 changes no layout.** `transfer_admin` overwrites the existing 32 `admin` bytes; `unwind_empty_range` only closes accounts.

### Q0.3 Every `dust` / `premium_pool` / `receivable` access

| Field | Reads | Writes |
|---|---|---|
| `dust` | none in non-test code | **none** — declared at `state.rs:258`, written only by the `premium.rs:307` test fixture |
| `premium_pool` | `premium.rs:213` (claim cap), `lib.rs:1308` / `lib.rs:1359` (event fields) | `premium.rs:227-230` (decrement, `apply_short_claim`), `premium.rs:255-258` (increment, `apply_long_payment`) |
| `receivable` | never read outside its own writes | `premium.rs:237-240` (decrement), `premium.rs:242-245` (increment) — both inside `apply_short_claim` |

Reached from instructions via `settle_premium` (`lib.rs:1290`, `lib.rs:1345`) and `burn_position` (`lib.rs:1749`, `lib.rs:1791`). The identity `range_vault.amount == premium_pool + dust` is asserted off-chain only (`scripts/reconcile.mjs:28-29`, `tests/settle-premium.ts`).

### Q0.4 Events and consumers

19 `#[event]` structs declared `lib.rs:2805`–`lib.rs:3006` in the order catalogued by `EVENT-CATALOG.md`; 20 `emit!` sites (`PremiumSettled` fires from both `lib.rs:1301` and `lib.rs:1352`). Admin-relevant emits: `MarketPauseSet` (`lib.rs:158`), `MarketPauseCleared` (`lib.rs:174`), `MarketRiskParamsSet` (`lib.rs:205`) — each only on a real transition. Consumers: `apps/web/src/lib/events.ts` (Anchor `EventParser`, best-effort), `apps/web/src/hooks/useSendPermaTx.ts`, `tests/events.ts` (9 tests, one of which asserts the IDL event count).

### Q0.5 Existing scripts and the monitoring gap

| Script | Does |
|---|---|
| `scripts/reconcile.mjs` | escrow identity per range, `open_longs` counter, per-side conservation; exit 0/1. No CLI args, no admin/pause output |
| `apps/web/scripts/pause-market.ts` | `pause` / `unpause` / `set-risk-params`, positional dispatch, signs with `~/.config/solana/id.json` |
| `scripts/measure*.mjs`, `apps/web/scripts/verify-*.ts` | measurement and demo verification |

No health or monitoring script exists anywhere in the repo. `RUNBOOK-DEVNET.md:25` is an explicit TODO.

### Q0.6 Confirmed absences

- **`transfer_admin` / `set_admin` / `AdminTransferred` / `pending_admin`** — zero matches in `programs/`. `GlobalConfig.admin` is written exactly once, at `lib.rs:47`.
- **Commission / fee-rate / protocol-fee vault / PLP share** — zero matches for `commission`, `fee_rate`, `protocol_fee`, `fee_vault`, `treasury`, `fee_bps`. The only fee concept is Orca's own LP fee, collected into `Market.vault_a/b` and absorbed as short PnL.
- **Range unwind / close / dust sweep** — zero matches for `unwind`, `sweep`, `close_range`, `drain`. `RangePremiumState` and `range_vault`, once created by the first short, are permanent today.

---

## Q1 — In-scope vs OUT matrix

| Work item | P1 decision |
|---|---|
| `transfer_admin(new_admin)` writing `GlobalConfig.admin` in place | **IN** |
| `AdminTransferred` event | **IN** (additive, appended last) |
| Squads vault creation / Squads program CPI inside PERMA | **OUT** — external; PERMA sees only a pubkey |
| Multisig runbook + localnet authority-transfer drill | **IN** |
| `--monitor` mode on `reconcile.mjs` + runbook checklist | **IN** |
| P2 indexer / charts / history APIs / Postgres | **OUT** |
| `unwind_empty_range` + `RangeUnwound` | **IN** (Q3 GO) |
| Orphan Orca position sweeper | **OUT** — the product short path is atomic open+add, so there is no orphan on it |
| Opening commission / PLP share / APY | **DEFER with ticket** |
| `pause_global` / `GlobalConfig` resize | **OUT** |
| Allowlist setter / premium-rate setter | **OUT** |
| Exit Guaranteed matrix changes | **OUT** |
| Oracle / liquidation / multi-leg / Raydium | **OUT** |

---

## Q2 — Multisig / `transfer_admin`

**Chosen path: ship the handoff, not the multisig.** PERMA never learns what a Squads vault is; it checks `require_keys_eq!(admin, config.admin)` exactly as it does today (`factory.rs:32-35`). Making Squads a hard dependency of pause would make the circuit breaker depend on a second program — the opposite of hardening.

- Handler order: `require_admin`, then `validate_new_admin` (rejects `Pubkey::default()`, the same silent-brick argument as `validate_allowlist_entry` at `factory.rs:21-28`).
- `new_admin == current` is a **no-op with no event**, matching `pause_market`'s idempotence (`lib.rs:151-165`).
- New error `InvalidAdmin`, appended after `InvalidRiskParams` (`errors.rs:174`) → on-chain code 6035. Append-at-end only.
- Accounts: `admin: Signer`, `global_config` `mut` at `["global_config"]`. No payer, no `system_program`, no layout change.
- Allowlist stays immutable — `transfer_admin` does not weaken the `state.rs:65-67` guarantee that a compromised admin cannot repoint the protocol at another pool.

**Ops sequence** (runbook): create the Squads vault externally → verify it → `yarn transfer-admin <vault>` signed by the current EOA → confirm with `yarn monitor` → all later pause / risk-param transactions are proposed and executed through the vault. Localnet drill uses a deterministic stand-in keypair.

---

## Q3 — Dust / range unwind: **GO**

This is not a policy invention. `08-burn-settle.md:232` already states the intended behaviour verbatim — "residue transfers out and `RangePremiumState` + `range_vault` close, rent to the closer — and that would be the only path by which the protocol receives any premium" — and `ADR-0002:86` names sweep-to-protocol-on-unwind as the Protocol V1 rule. `08-burn-settle.md:293` already reserves the event name `RangeUnwound`.

**Preconditions (all required, fail closed, checked before any transfer):**

1. `factory::require_admin`.
2. `range_state.market == market.key()`.
3. `range_state.total_short_liquidity == 0`.
4. `range_state.total_long_liquidity == 0`.
5. `range_state.receivable == 0`. This is the load-bearing one: a `PENDING_PREMIUM` short has already left `total_short_liquidity` (`position.rs:151`) but is still owed cash, and `range.receivable` is the range-wide mirror of every position's `premium_receivable` (`premium.rs:237-245`). Without it, unwind could sweep money a short is still entitled to — breaking `08-burn-settle.md:245` ("no claim expiry").
6. `range_vault` re-derived from `["range_vault", market, lower_le, upper_le]` and key-checked, as `check_range_vault` does (`lib.rs:1701-1718`).
7. `check_user_ata(range_vault, market.token_mint_b, market_authority)`.
8. `check_user_ata(destination, market.token_mint_b, admin.key())` — Q3a.
9. `token_amount(range_vault) == premium_pool + dust`. The shipped identity is asserted on the way out rather than trusted.

**Actions:** sweep the whole `premium_pool` if non-zero, close the vault (hand-built SPL `CloseAccount`, lamports to `admin`), zero the books, `close = admin` on `range_state`, emit `RangeUnwound { market, admin, tick_lower, tick_upper, amount_usdc }`.

**Safe re-creation.** `MintPosition` uses `init_if_needed` on `range_state` (`lib.rs:2113-2120`) and `ensure_range_vault` is idempotent (`lib.rs:1431`), so a later short in the same ticks recreates both. `poke_range` (`premium.rs:63-92`) only accumulates when both liquidity sides are non-zero, so a re-created range with `last_index = 0` catches up to the current index exactly as any brand-new range does. No special migration.

**Not touched:** `Market.vault_a` / `vault_b`, any `UserCollateral` free or locked balance, any position's `premium_receivable`. Unwind moves unattributable residue only — which is why it does not contradict `INSTRUCTIONS.md:97`'s "no admin path that moves **user** funds".

### Q3a — Destination: **Option A**

The destination must be an SPL token account with mint `Market.token_mint_b` whose owner is the **signing admin**, enforced by the existing `check_user_ata` helper. No new PDA, no new account type, no new seeds, no `init_if_needed`, and nothing new for `reconcile.mjs` to track. Once `GlobalConfig.admin` is a Squads vault, residue lands in that vault's USDC account with no further code. Option B (`["protocol_fee", market]` PDA) was rejected for this phase: it adds an account type, a second withdraw path to design, and more surface for no benefit Fair needs today.

---

## Q4 — Monitoring

**Extend `scripts/reconcile.mjs` with `--monitor` rather than adding a second script.** It already loads the IDL, derives the market PDA, has `amt()` and `i32()`, enumerates every range, and exits non-zero on a broken identity; a new file would duplicate all of it and drift.

Under `--monitor`, additionally print: `GlobalConfig.admin` and `allowlisted_whirlpool`; `Market.is_paused`, both risk params and both premium params; which ranges hold non-zero short/long liquidity; and a best-effort decode of recent admin events (`getSignaturesForAddress` + Anchor `EventParser`, same pattern as `apps/web/src/lib/events.ts:31-42`), wrapped so an RPC failure warns and never changes the exit code.

Runbook gains a **Monitoring checklist**. **OUT:** Prometheus, Grafana, PagerDuty, websockets, history APIs, any `indexer/` service.

---

## Q5 — Commission: **DEFER**

No concrete Fair demo path is broken without an opening commission — the Trade loop (deposit → mint → settle → burn → withdraw) is green at 102/102 with zero protocol skim. PRD B18 and `COMPLETE-PRODUCT-DEFINITION.md:56` keep commission as a complete-product requirement, and `NON-GOALS.md` forbids invented APY copy. Ticket: [`P1-DEFER-COMMISSION.md`](P1-DEFER-COMMISSION.md).

---

## Q6 — Layout / migration / localnet

- Zero account layout changes. `transfer_admin` writes existing bytes; `unwind_empty_range` only closes.
- Localnet redeploy is safe: existing PDAs keep their current admin until `transfer_admin` is called.
- No test requires Squads, so no suite can be bricked by a missing multisig program.
- Two new errors are appended at the **end** of the enum (6035 `InvalidAdmin`, 6036 `RangeNotEmpty`); no existing code shifts.

---

## Q7 — IDL / clients

`anchor build --arch v0`, then the documented manual sync `cp target/idl/perma.json target/types/perma.ts apps/web/src/idl/` (`apps/web/README.md:45-56`). No hand-edited discriminators. `tests/events.ts` asserts the IDL event count and must move 19 → 21. `apps/web/scripts/pause-market.ts` gains a `transfer-admin` subcommand in the existing positional-dispatch style.

---

## Decisions recorded

1. Ship the **authority handoff**, not a multisig implementation. No Squads CPI inside PERMA, ever, for pause.
2. `transfer_admin` is idempotent and silent on a no-op change, mirroring `pause_market`.
3. Unwind is **admin-gated**, never permissionless, and fails closed on any non-empty signal including `receivable`.
4. Residue destination is an **admin-owned USDC token account** (Option A). No protocol fee PDA in P1.
5. `dust` stays unwritten mid-life. Splitting residue from unclaimed entitlement is still the O(n)-per-poke work the accumulator exists to avoid (IMPL-08 residual #2); unwind sweeps `premium_pool` in full instead.
6. Commission deferred with a ticket. No bps, no APY.
7. Monitoring is a mode on an existing script plus a runbook checklist. Not an indexer.
8. ROADMAP P1 exit is **GO WITH BLOCKERS** until a real Squads vault holds `GlobalConfig.admin` on a live cluster and the checklist has been run there.
