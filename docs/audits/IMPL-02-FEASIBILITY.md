# Component 02 (Factory / Allowlisted Market) — Phase 0 Feasibility

**Date**: 2026-09-19 · **Scope**: `GlobalConfig`, admin, enforced allowlist, premium defaults.
**Spec**: [`02-factory-allowlisted-market.md`](../02-mvp-components/02-factory-allowlisted-market.md)

## Verdict: **GO**

| Check | Result |
|---|---|
| Toolchain | anchor-cli `1.2.0`, rustc `1.98.1`, solana `3.0.0`; `--arch v0` still mandatory ✅ |
| `Market` PDA seeds | `[b"market", whirlpool]` — confirmed in `state.rs` / `lib.rs` ✅ |
| Allowlisted pool | `2WUgXb…ym9G` alive, `tick_spacing = 8`, no active rewards ✅ |
| Fair MVP allowlist size | **exactly one** pool pubkey |

## Gap diff — current vs spec

| # | Spec requirement | Today | Action |
|---|---|---|---|
| 1 | `GlobalConfig` PDA + `initialize_global_config` | **absent** (zero hits) | **add** |
| 2 | `create_market` is admin-only | has an `admin: Signer` but **never checks who it is** | **add guard** |
| 3 | `create_market` enforces the allowlist | **no allowlist check at all** | **add guard** |
| 4 | `premium_rate` / `premium_multiplier` on `Market` | **absent** | **add**, defaults `1_000_000` / `1_000` |
| 5 | `Unauthorized`, `PoolNotAllowlisted`, `MarketAlreadyExists` | **none in `errors.rs`** | **add** (`0x30`, `0x21`, mapping) |
| 6 | Factory test suite | **absent** | **add** |

**Reused unchanged** (components 01/01B, all working): Whirlpool program-ID check, active-rewards rejection, live `tick_spacing`/mints/vault reads, PERMA vault mint+owner validation, `MarketCreated`, and the entire adapter. `adapter.rs` is not touched.

## Decisions

- **`allowlisted_whirlpool: Pubkey`** — a single fixed field, not a `Vec`. The type enforces the PRD's "exactly one pool"; no dynamic allocation, and the check is one `require_keys_eq!`. `INSTRUCTIONS.md` currently documents `allowlisted_pools: Vec<Pubkey>` — a one-line doc fix.
- **No setter.** The allowlist is immutable after init, so an admin-key compromise cannot repoint the protocol at an attacker-controlled pool while markets hold real Orca positions.
- **No `risk_params`.** `09-risk-solvency.md` defines no concrete numeric defaults, and inventing risk math here is out of scope. Left to component 09; a zero-filled placeholder would be worse than its absence.
- **`create_market` keeps its no-arg form.** The spec writes `create_market(pool_address)`, but the whirlpool already arrives as an account and the `Market` PDA derives from it. A `pool_address` parameter would be a redundant value that must equal `whirlpool.key()` — an anti-pattern. Deviation recorded in the report.

## Two findings that shape the work

### A. The rewards check becomes unreachable through the front door

With allowlist-first ordering, a pool with active rewards fails `PoolNotAllowlisted` **before** the rewards check runs. The `has_active_rewards` guard degrades to defense-in-depth on the allowlisted pool itself.

It can still be proven directly. Scanning all **9 753** devnet whirlpools under the PERMA config found **3 with active reward vaults**:

| Pool | Active slots |
|---|---|
| `EgxU92G34jw6QDG9RuTX9StFg1PmHuDqkRKAE5kVEiZ4` | 0, 1 |
| `EdACSeagirp87pAkGwvHwsVkRwkjZTxd83v2UqgiB9LA` | 0 |
| `J3J1hfwBCXgqp5vVPyfwkzUmcWRpsh3FdAvDiLEMzzYZ` | 0 |

A standalone suite (`tests/factory-rewards.ts`) points `GlobalConfig` at `EgxU92G…` on a fresh ledger and asserts the rejection. `GlobalConfig` is a singleton PDA, so this cannot share a validator run with the main suite.

### B. Extending `Market` is a breaking layout change

`+16` bytes (`premium_rate`, `premium_multiplier`) means an **old `Market` account fails to deserialize**. `GlobalConfig` is likewise a new singleton.

**Migration plan** — helpers are updated, liquidity coverage is preserved, nothing is deleted:

1. Validator must run with **`--reset`** after this change.
2. `tests/adapter.ts` and `tests/adapter-liquidity.ts` keep every existing assertion; their setup paths gain a GlobalConfig-ensure step and pass `globalConfig` into `createMarket`.
3. New fields are appended at the end, so the adapter's existing field offsets stay stable relative to one another.

## Proceed criteria

Only on GO / GO WITH BLOCKERS. **Verdict is GO** — no blockers. Components 03–11 and the UI remain out of scope.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
