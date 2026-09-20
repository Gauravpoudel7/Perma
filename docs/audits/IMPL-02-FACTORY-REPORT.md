# Component 02 — Factory (Allowlisted Market) — Implementation Report

**Date**: 2026-09-19
**Phase 0 gate**: [`IMPL-02-FEASIBILITY.md`](IMPL-02-FEASIBILITY.md) — **GO**
**Spec**: [`02-factory-allowlisted-market.md`](../02-mvp-components/02-factory-allowlisted-market.md)

## Status: **shipped**

`create_market` is now admin-only and allowlist-gated. Every component-01 suite stayed green through a breaking `Market` layout change.

| Suite | Before | After |
|---|---|---|
| Rust unit | 8 / 8 | **11 / 11** (+3 factory) |
| `tests/factory.ts` | — | **9 / 9** |
| `tests/factory-rewards.ts` (fresh ledger) | — | **2 / 2** |
| `tests/adapter.ts` (validation) | 12 / 12 | **12 / 12** |
| `tests/adapter-liquidity.ts` (real CPI) | 8 / 8 | **8 / 8** |

All suites verified twice for idempotency.

---

## 1. What shipped

| Item | Detail |
|---|---|
| `GlobalConfig` PDA | `["global_config"]` — `admin`, `allowlisted_whirlpool`, `bump` |
| `initialize_global_config(allowlisted_whirlpool)` | Caller becomes admin; rejects `Pubkey::default()`; emits `GlobalConfigInitialized` |
| `create_market` guards | `Unauthorized` → `PoolNotAllowlisted`, **before** any Whirlpool read |
| `Market` +2 fields | `premium_rate = 1_000_000`, `premium_multiplier = 1_000` |
| `factory.rs` | `validate_allowlist_entry`, `authorize_create_market` + 3 unit tests |
| Errors | `PoolNotAllowlisted`, `Unauthorized`, `MarketAlreadyExists`, `InvalidAllowlistEntry` |
| `MarketCreated` | Additive: `+admin`, `+premium_rate`, `+premium_multiplier` |

`adapter.rs` is **untouched**.

## 2. Decisions and deviations

### Allowlist is a single `Pubkey`, not a `Vec`

Fair MVP approves exactly one pool, so the type enforces the PRD constraint and the check is one `require_keys_eq!` — no `#[max_len]`, no scan, no way for a future caller to push a second pool. `INSTRUCTIONS.md` documented `allowlisted_pools: Vec<Pubkey>` and was corrected.

### No setter — the allowlist is immutable after init

An admin-key compromise cannot repoint the protocol at an attacker-controlled pool while markets hold real Orca positions. A setter would also let the allowlist and live `Market.whirlpool` values silently diverge, since existing markets keep the pool they recorded.

### `create_market` takes no `pool_address` argument

The spec pseudocode writes `create_market(ctx, pool_address)`. The shipped instruction takes none: the whirlpool arrives as an account and the `Market` PDA derives from it, so the parameter would be a redundant value that must equal `whirlpool.key()`. Noted inline in the spec.

### No `risk_params`

`09-risk-solvency.md` defines no concrete numeric defaults, and inventing risk math in the factory is out of scope. A zero-filled placeholder would be worse than its absence — it would look configured. Margin parameters land with component 09; a comment in `state.rs` says so.

### `MarketAlreadyExists` is a documented mapping, not a raised code

Anchor's `init` constraint fires first and surfaces its own account-already-in-use error (`0x0`). The variant exists so the catalog entry has a home and tests can assert either form. The program never raises it directly.

## 3. The finding worth knowing: the rewards check moved behind the allowlist

With allowlist-first ordering, a rewards-bearing pool now fails `PoolNotAllowlisted` — the `has_active_rewards` guard is never reached through the front door. It degrades to **defense-in-depth on the allowlisted pool itself**.

Rather than leave that unproven, I scanned all **9 753** devnet whirlpools under the PERMA config and found **3 with active reward vaults**:

| Pool | Active slots |
|---|---|
| `EgxU92G34jw6QDG9RuTX9StFg1PmHuDqkRKAE5kVEiZ4` | 0, 1 |
| `EdACSeagirp87pAkGwvHwsVkRwkjZTxd83v2UqgiB9LA` | 0 |
| `J3J1hfwBCXgqp5vVPyfwkzUmcWRpsh3FdAvDiLEMzzYZ` | 0 |

`EgxU92G…` is now cloned into the validator and used twice:

- **`tests/factory.ts`** — admin + rewards pool → asserts `PoolNotAllowlisted`, proving the ordering.
- **`tests/factory-rewards.ts`** — allowlists the rewards pool on a fresh ledger so execution *reaches* the guard, then asserts the rejection is `InvalidAsset` and explicitly **not** `PoolNotAllowlisted`. The guard is genuinely exercised, not assumed.

`GlobalConfig` is a singleton PDA, so the second suite cannot share a validator run — hence its own file and its own documented command.

## 4. Test table

### Rust unit (3 new)

| Test | Asserts |
|---|---|
| `rejects_default_pubkey_as_allowlist_entry` | `Pubkey::default()` refused, real key accepted |
| `authorizes_only_the_recorded_admin_and_pool` | wrong admin **or** wrong pool both fail |
| `admin_check_precedes_allowlist_check` | a non-admin gets `Unauthorized`, so the failure does not leak which pool is allowlisted |

### `tests/factory.ts` — 9

| # | Test |
|---|---|
| 1 | `initialize_global_config` records admin + allowlisted pool |
| 2 | Second init fails (singleton PDA) |
| 3 | `tick_spacing` read **live** from the pool; asserted equal to the raw account byte, and separately that it is 8 not 64 |
| 4 | Mints and Orca vaults copied from the live Whirlpool, compared **byte-for-byte** against the pool account |
| 5 | `premium_rate == 1_000_000`, `premium_multiplier == 1_000` |
| 6 | Non-admin `create_market` → `Unauthorized` |
| 7 | Admin + unallowlisted pool → `PoolNotAllowlisted` |
| 8 | Admin + active-rewards pool → `PoolNotAllowlisted` (ordering proof) |
| 9 | Second `create_market`, same pool → already-in-use |

Tests 6–8 target pools with **no existing market**, so Anchor's `init` cannot mask the authorization failure — the test would otherwise pass for the wrong reason.

### `tests/factory-rewards.ts` — 2 (fresh ledger)

| # | Test |
|---|---|
| 1 | `initialize_global_config(Pubkey::default())` → `InvalidAllowlistEntry`, and no account is created |
| 2 | Rewards pool allowlisted → `create_market` rejected with `InvalidAsset`, not `PoolNotAllowlisted`; no market created |

## 5. Migration: `Market` layout change

Adding `premium_rate` + `premium_multiplier` grows `Market` by **16 bytes**, so a pre-02 account fails to deserialize. Fields were appended at the end, keeping the adapter's existing offsets stable relative to one another.

- **The validator must run with `--reset`** after this change. Documented in `README.md`.
- `tests/adapter.ts` and `tests/adapter-liquidity.ts` kept **every** existing assertion; their setup paths gained a `ensureGlobalConfig()` helper and pass `globalConfig` into `createMarket`. No liquidity coverage was deleted — real CPI still runs and still passes.

## 6. Residual risks

1. **Admin is a single keypair.** The spec calls for a multisig in any mainnet-like demo; not implemented. With no setter, a compromised admin can still create markets for the (fixed) allowlisted pool.
2. **`is_paused` is written but never enforced** in `create_market`. Pause belongs to component 10; the field is inert today.
3. **No `risk_params`** — component 09.
4. **Premium defaults are demo-tuned**, not economically calibrated (`07-premium-engine.md` §A). They are also **fixed at creation with no admin update path** — spec says "admin-only thereafter", which currently means "unchangeable". A setter belongs with the premium engine.
5. **`factory-rewards.ts` needs a dedicated validator run.** If run after any suite that creates `GlobalConfig`, it skips with a clear message rather than failing — worth wiring into CI as a separate job so a silent skip is not mistaken for a pass.
6. **Ops-only checklist item open**: `yarn scripts:init-market` on devnet has not been run; the factory has only been exercised on a local validator with cloned accounts.

## 7. Scope compliance

| Boundary | Held |
|---|---|
| Components 03–11 | ✅ no collateral, premium engine, settlement, solvency, or pause logic |
| Next.js / indexer | ✅ none |
| `adapter.rs` untouched | ✅ |
| `--arch v0`, `anchor-lang 1.2.0`, no client `anchor` feature | ✅ |
| Allowlisted pool unchanged | ✅ `2WUgXb…ym9G`, still alive |
| No hardcoded `tick_spacing` | ✅ grep-verified: only a doc comment mentions `8` |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
