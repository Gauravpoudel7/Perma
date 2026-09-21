# IMPL-P1-PRODUCTION-HARDENING-REPORT

**Status**: Shipped (with named ops blockers). **Date**: 2026-09-21. **Scope authority**: [`ROADMAP.md`](../09-post-mvp/ROADMAP.md) P1 — Production Hardening · **Feasibility**: [`IMPL-P1-FEASIBILITY.md`](IMPL-P1-FEASIBILITY.md) (GO WITH BLOCKERS) · **Prompt**: [`CLAUDE-IMPLEMENT-P1-PRODUCTION-HARDENING.md`](../prompts/CLAUDE-IMPLEMENT-P1-PRODUCTION-HARDENING.md)

> **🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## 1. Shipped surface

| Piece | Where |
|---|---|
| `transfer_admin(new_admin: Pubkey)` — admin-only, rejects `Pubkey::default()`, writes `GlobalConfig.admin` in place, no-op (and silent) when `new_admin` is already the admin | `programs/perma/src/lib.rs` (`TransferAdmin` accounts: `admin` signer, `global_config` mut; no payer, no `system_program`) |
| `unwind_empty_range()` — admin-only, no parameters; sweeps a fully-empty range's premium residue to an admin-owned USDC account and closes both range accounts | `lib.rs` (`UnwindEmptyRange`), `close_token_account` helper (hand-built SPL `CloseAccount`, tag `9`, per ADR-0001) |
| `factory::validate_new_admin(&Pubkey)` + unit test `rejects_default_pubkey_as_new_admin` | `factory.rs` |
| `PermaError::InvalidAdmin` — appended, code **6035**; `PermaError::RangeNotEmpty` — appended, code **6036** | `errors.rs` |
| Events `AdminTransferred { global_config, old_admin, new_admin }`, `RangeUnwound { market, admin, tick_lower, tick_upper, amount_usdc }` — appended **after** `LiquidityRemoved`; nothing above them renamed or reordered | `lib.rs` events block |
| `--monitor` mode on the existing reconcile script: admin custody, allowlisted pool, pause state, risk parameters, and a decoded tail of the five admin events | `scripts/reconcile.mjs`; `yarn monitor` / `yarn reconcile` in the root `package.json` |
| `yarn transfer-admin <pubkey>`; every action now prints `admin=` before and after | `apps/web/scripts/pause-market.ts`, `apps/web/package.json` |
| `tests/admin-transfer.ts` (7 cases), `tests/range-unwind.ts` (5 cases) | root tests, placed before `pause-admin.ts` / `events.ts` in the gate list |
| IDL resynced (`apps/web/src/idl/perma.{json,ts}`): **19** instructions, **21** events, **37** errors | `apps/web/src/idl` |

**Account layouts: unchanged.** `state.rs` is not touched. `transfer_admin`
overwrites 32 existing bytes; `unwind_empty_range` only closes accounts. No
realloc, no `GlobalConfig` resize, no `pause_global`.

**Docs**: [`INSTRUCTIONS.md`](../03-api-interfaces/INSTRUCTIONS.md) (19 instructions; both new entries; §5 rewritten),
[`EVENT-CATALOG.md`](../03-api-interfaces/EVENT-CATALOG.md) (21 events),
[`RUNBOOK-DEVNET.md`](../07-ops-presentation/RUNBOOK-DEVNET.md) (monitoring checklist + admin custody / multisig transfer),
[`10-pause-admin.md`](../02-mvp-components/10-pause-admin.md) (custody note + multisig box),
[`SECURITY-BASELINE.md`](../05-engineering/SECURITY-BASELINE.md) §4 (transferability + the bound on admin reach),
[`08-burn-settle.md`](../02-mvp-components/08-burn-settle.md) and [`ADR-0002`](../adr/ADR-0002-premium-accounting.md) (dated addenda),
[`RELEASE-GATE.md`](../06-testing/RELEASE-GATE.md) (114 / 67),
[`P1-DEFER-COMMISSION.md`](P1-DEFER-COMMISSION.md).

## 2. Q-matrix as implemented

| Q | Feasibility said | Shipped as |
|---|---|---|
| Q1 scope | In: monitoring, `transfer_admin`, unwind, commission decision, report. OUT: P2–P6, event renames, pause matrix, premium math, Orca metas, ADR-0003, layouts | Held. The only on-chain additions are two instructions, two errors and two events, all appended. |
| Q2 `transfer_admin`, zero layout change | Write `GlobalConfig.admin` in place; no payer; idempotent self-transfer; reject the zero key | Exactly that. `require_admin` → `validate_new_admin` → early `Ok(())` on self-transfer → write + `emit!`. |
| Q3 unwind preconditions | `total_short_liquidity == 0`, `total_long_liquidity == 0`, `receivable == 0`; re-derive the vault; assert the escrow identity | All five guards present and fail-closed before any transfer, plus `range_state.market` and both `check_user_ata` calls. |
| Q3a destination | **Option A** — admin-owned USDC token account, no new PDA | `check_user_ata(destination, market.token_mint_b, admin.key())`. No protocol-fee PDA was created. |
| Q4 monitoring | Scripts + checklist, not an indexer | `--monitor` on `scripts/reconcile.mjs`, six-point checklist in the runbook. No service, no Prometheus, no Postgres. |
| Q5 commission | DEFER with a ticket | [`P1-DEFER-COMMISSION.md`](P1-DEFER-COMMISSION.md). No bps, no APY, no `Market` field. |
| Q6 layout / migration | No account grows; unwind only closes | Confirmed. Re-creation after a close is exercised by a test (see §4). |
| Q7 IDL / clients | Regenerate and copy; no hand-edited discriminators | `anchor build --arch v0` then `cp target/idl/perma.json target/types/perma.ts apps/web/src/idl/`. |

### The Q3a decision, in full

The residue goes to a **token account owned by the signing admin**, asserted
with the same `check_user_ata` helper used on every other user token account.
The rejected alternative was a protocol-fee PDA.

A new PDA would have been a new custody question — who owns it, who may
withdraw from it, what happens to the balance on a redeploy — answered under
implementation pressure rather than in an ADR. The amount at stake is
single-digit µUSDC per range at MVP scale. The honest shape is the one where
the operator's own account receives it and the runbook says so plainly; if a
real fee ever accrues, the ADR that introduces it can introduce the account
too. Recorded in the [ADR-0002](../adr/ADR-0002-premium-accounting.md) addendum
of 2026-09-21.

## 3. What the unwind is careful about

- **`receivable == 0` is the load-bearing guard.** A `PendingPremium` short has
  already left `total_short_liquidity` but is still owed cash;
  `RangePremiumState.receivable` is the range-wide mirror of those claims.
  Checking only the two liquidity totals would sweep money a short is entitled
  to and break the "no claim expiry" invariant.
- **The identity is re-proved, not trusted.** The handler requires
  `token_amount(range_vault) == premium_pool + dust` before it moves anything,
  so the sweep validates the books it is about to delete.
- **The ticks come from `range_state`.** With no instruction parameters, a
  caller cannot point the instruction at one range's accounting while passing
  another range's vault; the `range_vault` PDA is re-derived from the state
  account's own ticks and key-checked.
- **No user funds are reachable.** `Market.vault_a` / `vault_b`, every
  `UserCollateral` balance (free and locked) and every position's
  `premium_receivable` are untouched by both new instructions.
- **Not pause-gated.** Neither instruction increases risk or closes anything a
  user owns, so the Exit Guaranteed matrix is unchanged — no rows moved, none
  reopened.

## 4. Verification

| Gate | Command | Result |
|---|---|---|
| Unit | `yarn test:unit` | **67 passing** (66 + `rejects_default_pubkey_as_new_admin`) |
| Build | `anchor build --arch v0` | exit 0; IDL: 19 instructions, 21 events, errors through 6036 |
| IDL sync | `cp target/idl/perma.json target/types/perma.ts apps/web/src/idl/` | clean; no hand edits |
| Integration, pass 1 | RELEASE-GATE §4.2 list, fresh ledger | **114 passing, 0 failing** |
| Integration, pass 2 | same list, same ledger | **114 passing, 0 failing** |
| Integration, reversed | list reversed, same ledger | **114 passing, 0 failing** |
| Accounting | `node scripts/reconcile.mjs` | exit 0, `ESCROW IDENTITY HOLDS FOR EVERY RANGE` |
| Monitoring | `node scripts/reconcile.mjs --monitor` | exit 0; prints admin, pool, pause state, risk params, and a decoded admin-event tail (verified end-to-end by emitting a real pause/unpause through `yarn pause-market`) |
| Web | `cd apps/web && yarn typecheck && yarn test && yarn check-copy` | clean; 39 passing (5 files); copy gate clean |

**No test was deleted, skipped or weakened.** The one pre-existing assertion
that changed is `tests/events.ts`'s event count, 19 → 21, which the additive
events require.

### What the new suites prove

`tests/admin-transfer.ts` — non-admin transfer → `Unauthorized`; the zero key →
`InvalidAdmin`; self-transfer is silent (no event, so a retried ops script
leaves no phantom handoff); A→B moves `GlobalConfig.admin` and emits
`AdminTransferred` with the right old/new keys; the old admin then loses pause,
risk-params **and** transfer; the new admin holds the whole component-10
surface; B→A restores. The stand-in is `Keypair.fromSeed` of a fixed constant,
never `generate()`, so a run that crashed mid-handoff leaves an admin the next
run can still reconstruct, sign with and heal in `before()`.

`tests/range-unwind.ts` — a range with inventory refuses (`RangeNotEmpty`); a
non-admin refuses (`Unauthorized`); the sweep moves exactly `premium_pool` to
the admin's USDC account and closes both accounts; `RangeUnwound` decodes with
the right ticks and amount; a second unwind fails `AccountNotInitialized`; and
the range can be re-created afterwards by a plain mint with `premium_pool == 0`.
The short is minted with an **odd** liquidity (`100_000_001`) chosen so the
floored Q64.64 split leaves a residue of exactly 1 µUSDC — the sweep assertion
is never vacuously true.

## 5. What the run surfaced

- **One commitment, or races.** Anchor's env provider defaults to `processed`,
  which is *ahead* of `confirmed`. Mixing a `confirmed` preflight with
  `processed` sends lets a simulation run against a bank that has not seen the
  preceding transaction, which surfaced as phantom `AccountNotInitialized` and
  `RangeNotEmpty` failures. Both new suites pin one `CONFIRMED` constant on
  every `.rpc()`. Stable across five consecutive runs and the full three-pass
  gate.
- **Anchor's client reports event names in camelCase.** The monitor's event
  filter was written in PascalCase and silently matched nothing across 400
  signatures. Fixed in `scripts/reconcile.mjs`; the tests assert camelCase, as
  `tests/events.ts` already did.
- **Collateral drains as a suite repeats.** Premium paid and residue swept both
  leave free USDC a few µUSDC lower each pass, enough to trip the mint's own
  check. `tests/range-unwind.ts` tops up before every short mint rather than
  once in `before()`.
- **Shared fixtures deplete after roughly five passes on one ledger**
  (`InsolventMint`, SPL `0x1`). Not a code defect and out of P1's scope; the
  gate requires three passes on a fresh ledger, which is green.

## 6. Residuals (explicit)

1. **No real multisig holds `GlobalConfig.admin`.** P1 ships the mechanism, the
   ops script, the runbook procedure and a localnet drill. Creating a Squads
   vault and executing the handoff is an action on a live cluster, not a
   checkout. Until it happens the admin is a single EOA and a single point of
   failure. This was named as a blocker in the feasibility verdict and remains
   one.
2. **Devnet has never been deployed.** The monitoring checklist is written and
   exercised on a local validator; "live on devnet" is unmet for the same
   reason as (1). `RUNBOOK-DEVNET.md:3` still says so.
3. **`dust` is still never written mid-life.** The residue remains inside
   `premium_pool`, indistinguishable from unclaimed entitlement, until a range
   unwinds. Splitting it per settle is the O(n) work the accumulator exists to
   avoid.
4. **Commission is deferred**, not parameterized —
   [`P1-DEFER-COMMISSION.md`](P1-DEFER-COMMISSION.md).
5. **No protocol fee account.** The sweep pays an operator-owned token account
   (Q3a). There is no governed destination and nothing forces the sweep to run.
6. **No `pause_global`.** Still deferred: one market in Fair MVP, and the
   flag would resize the `GlobalConfig` singleton.
7. **A wrong-but-signable `new_admin` is unrecoverable.** Only
   `Pubkey::default()` is rejected. The runbook's verify-twice step is the
   whole mitigation; the program cannot tell a vault from a typo.
8. **No alerting.** `yarn monitor` is a command a human runs. No Prometheus, no
   Grafana, no PagerDuty — explicitly out of P1's scope.

## 7. Not started

**P2 — Indexer & Product UI** ([`ROADMAP.md`](../09-post-mvp/ROADMAP.md)):
history APIs, charts, and any Postgres-backed indexer service. Nothing in this
repo anticipates it; `indexer/` does not exist. Charts stay absent until they
can be fed by real indexed data.
