# Component: Pause Admin

> **Status: IMPLEMENTED (Fair MVP).** `pause_market` / `unpause_market` write `Market.is_paused`; `set_market_risk_params` writes the two ADR-0003 risk fields with overflow re-validation. Pause guards are scoped to **risk-increasing** paths only — the earlier guard set (which also blocked burns and settles) was corrected to honor Exit Guaranteed. `pause_global` is **deferred** (see below). Record: [`IMPL-10-FEASIBILITY.md`](../audits/IMPL-10-FEASIBILITY.md), [`IMPL-10-PAUSE-ADMIN-REPORT.md`](../audits/IMPL-10-PAUSE-ADMIN-REPORT.md).

## Purpose
The Pause Admin provides the "emergency brake" for the protocol. It allows the admin to halt the *opening* of risk in the event of a critical bug, extreme market volatility, or an active exploit — without ever trapping the risk that is already open.

## User-Facing Behavior
When the market is paused, the TopBar badge reads **Paused**, the Trade open-position CTA and the Deposit form are blocked with the copy "Trading is paused. Open positions can still be closed.", and Withdraw / Close / Settle keep working. Users can still exit; they cannot add.

## Dependencies
- **Market**: the account whose `is_paused` flag and risk fields are written.
- **GlobalConfig**: `admin` authorizes every instruction here (`factory::require_admin`).

## State & PDAs
- **Market PDA** (`seeds = [b"market", whirlpool]`): `is_paused: bool` (existing, component 02), `long_margin_horizon_slots` / `long_margin_buffer_usdc` (existing, component 09). **No layout change** in component 10.
- **GlobalConfig PDA** (`seeds = [b"global_config"]`): `admin`. **No pause field** — see `pause_global` below.

## Pause matrix (what the flag does)

The rule: *pause blocks every path that adds risk, or adds funds that could back new risk; every path that reduces or exits risk stays open, subject to its own existing gates.* No second "freeze" mode exists in Fair MVP.

| Instruction | While `Market.is_paused` |
|---|---|
| `pause_market` / `unpause_market` | Allowed (admin) |
| `set_market_risk_params` | Allowed (admin) |
| `initialize_global_config` / `create_market` | Unchanged (admin; create sets `is_paused = false`) |
| `mint_position` (long + short) | **Reject** `MarketPaused` |
| `burn_position` | **Allow** |
| `settle_premium` | **Allow** |
| `deposit_collateral` | **Reject** |
| `withdraw_collateral` | **Allow** (still 09 solvency) |
| `lock_collateral` | **Reject** |
| `unlock_collateral` | **Allow** (still `PositionsOutstanding` when shorts open) |
| `validate_short_range` | Allow (read-only dry run) |
| `adapter_open_position` / `adapter_add_liquidity` | **Reject** `MarketPaused` |
| `adapter_close_position` / `adapter_remove_liquidity` | **Allow** |

## Public Interface

### `pause_market()`
- **Accounts**: `admin` (signer), `global_config`, `market` (mut).
- **Caller**: `global_config.admin`, else `Unauthorized`.
- **Action**: sets `Market.is_paused = true`. **Idempotent**: already paused → `Ok(())`, no event.

### `unpause_market()`
- Same accounts and authority. Sets `is_paused = false`. Idempotent the same way.

### `set_market_risk_params(long_margin_horizon_slots: u64, long_margin_buffer_usdc: u64)`
- Same accounts and authority. Writes exactly those two fields — never `premium_rate` / `premium_multiplier` (no setter in Fair MVP).
- **Re-validation (ADR-0003 forward requirement)**: before writing, `risk::validate_risk_params` rejects with `InvalidRiskParams` if `horizon == 0`, `buffer == 0`, or the margin at `risk::MARGIN_LIQUIDITY_BOUND` (= 2^52) — or its `MAX_OPEN_LONGS`-fold sum, as the withdraw gate computes it — would not fit `u64` under the market's current rate and multiplier. An overflow at mint merely fails the mint; an overflow at *withdraw* would lock every existing long's collateral. The bound's trade-off is documented on the constant.

### `pause_global()` — **deferred**
Would need `GlobalConfig.is_paused`, which resizes the singleton and bricks the existing PDA without a migration. With one allowlisted market in Fair MVP, `pause_market` *is* the global pause. Revisit with component 11 / multi-market.

## Algorithms & Pseudocode

```rust
// admin path (all three instructions)
factory::require_admin(&global_config, &admin.key())?;   // Unauthorized
if market.is_paused == desired { return Ok(()); }         // idempotent, no event
market.is_paused = desired;
emit!(MarketPauseSet { market, admin } /* or MarketPauseCleared */);

// guarded user path (mint / deposit / lock / adapter open+add only)
require!(!market.is_paused, PermaError::MarketPaused);
```

## Invariants
- **Exit Guaranteed**: pausing blocks new risk (mints, deposits, locks, harness open/add) and never blocks the closing of existing risk (burns, settles, withdraws, unlocks). Enforced by the matrix above and proven by `tests/pause-admin.ts`.
- **No layout change**: pause and the risk setter write existing bytes in place.

## Failure Modes & Errors
- **`MarketPaused`** (6013): a risk-increasing instruction was called while paused.
- **`Unauthorized`** (6015): a non-admin called `pause_market` / `unpause_market` / `set_market_risk_params`.
- **`InvalidRiskParams`** (6034): the candidate risk parameters fail the overflow / zero checks. Nothing is written.

## Security Notes
- **Admin Key Custody**: the on-chain check is a plain `require_keys_eq!` against `GlobalConfig.admin`, so custody is whatever that one pubkey is. Protocol V1 **P1** adds `transfer_admin`, which writes that field in place and lets the admin become a Squads vault — PERMA still contains no multisig CPI, the vault is simply the key that has to sign. Until a transfer is actually performed on a cluster, the admin is a single EOA and a single point of failure. Procedure: [`RUNBOOK-DEVNET.md`](../07-ops-presentation/RUNBOOK-DEVNET.md) §Admin custody; drill: `tests/admin-transfer.ts`.
- **Transparency**: every real transition emits an event (below). No-op calls emit nothing, by design.

## Test Cases (`tests/pause-admin.ts`, 17 cases, all green in the release gate)
- Non-admin pause / unpause / set-risk-params → `Unauthorized`.
- Admin pause → `mint_position` (both legs), `deposit_collateral`, `lock_collateral` → `MarketPaused`; `adapter_open_position` / `adapter_add_liquidity` → `MarketPaused` (not `WhirlpoolNotAllowlisted`).
- While paused: `settle_premium`, `withdraw_collateral` (with open-long remaining accounts), `burn_position` (long then short), `unlock_collateral` (owner with nothing outstanding) all succeed.
- Pause twice / unpause twice → no-op, no error.
- Unpause → mint, deposit, lock work again; `unlock` on an owner with open shorts fails `PositionsOutstanding`, not `MarketPaused`.
- `set_market_risk_params`: admin sets and reads back (premium fields untouched); `horizon = 1_000_000` (sum overflow), `horizon = u64::MAX` (product overflow), zero horizon, zero buffer → `InvalidRiskParams`, nothing written.

## Observability & Events
- `MarketPauseSet { market, admin }`
- `MarketPauseCleared { market, admin }`
- `MarketRiskParamsSet { market, admin, long_margin_horizon_slots, long_margin_buffer_usdc }`

(Named `*PauseSet` / `*PauseCleared` rather than the earlier draft `MarketPaused` / `MarketUnpaused` because `PermaError::MarketPaused` already owns that identifier.)

## Ops
`apps/web`: `yarn pause-market`, `yarn unpause-market`, `yarn set-risk-params <horizon> <buffer>` (signs with `~/.config/solana/id.json`; see `RUNBOOK-DEVNET.md` §Emergency Pause).

## MVP Done Definition
- [x] `is_paused` flag on `Market` *(component 02)*.
- [x] `pause_market` / `unpause_market` implemented, admin-only, idempotent, evented.
- [x] Pause guards scoped to risk-increasing instructions only; burn / settle / withdraw / unlock open under pause (Exit Guaranteed).
- [x] Adapter harness pause errors are `MarketPaused`.
- [x] `set_market_risk_params` with ADR-0003 overflow re-validation.
- [x] `tests/pause-admin.ts` in the release gate; UI Deposit form no longer allows-while-paused.
- [ ] `pause_global` — deferred (no `GlobalConfig` resize in Fair MVP).
- [x] Multisig admin — **mechanism** shipped in P1 (`transfer_admin` + `yarn transfer-admin`, `tests/admin-transfer.ts`). Still open as an *ops* action: no live vault holds `GlobalConfig.admin` yet.
