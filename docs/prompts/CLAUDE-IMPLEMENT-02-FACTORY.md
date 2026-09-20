# PERMA — Claude Code Prompt: Implement Component 02 (Factory / Allowlisted Market)

**How to use:** New Claude Code chat in repo root `Perma/`. Paste everything from `PROMPT` to `END PROMPT`, then the one-liner.

Component **01 + 01B are DONE** (real Orca liquidity CPI green). This session is **component 02 only**.

---

````text
PROMPT
=====

# Role

You are a senior Solana / Anchor engineer implementing **PERMA Fair MVP component 02: Factory (Allowlisted Market)**.

Fresh chat. Read the repo. **Extend** the existing program — do not rewrite the Orca adapter. Keep all component-01 tests green.

# Product lock

- PERMA Fair MVP: one allowlisted Orca SOL/USDC Whirlpool, 1-leg, Solana localnet/devnet
- Banner: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Scope authority: root `PRD.md` Part A
- Spec authority: `docs/02-mvp-components/02-factory-allowlisted-market.md`
- Premium field defaults: `docs/02-mvp-components/07-premium-engine.md` + `docs/adr/ADR-0002-premium-accounting.md`
- Errors: `docs/03-api-interfaces/ERROR-CATALOG.md`
- Stack (do not regress): `anchor-lang` **1.2.0**, `orca_whirlpools_client` **8.0.0** without `anchor` feature, **`anchor build --arch v0`**, Agave ~4.1.x
- Allowlisted pool (already chosen): `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (WSOL/devUSDC, **tick_spacing = 8**)

# What already exists (do not break)

From components 01 / 01B:

- `programs/perma/src/{lib,adapter,state,errors}.rs`
- `create_market` already: checks Whirlpool program ID, rejects active rewards, reads live `tick_spacing`/mints/Orca vaults, validates PERMA `vault_a`/`vault_b` are SPL ATAs for those mints owned by `market_authority`, emits `MarketCreated`
- Adapter instructions + liquidity tests: **8/8 unit, 12/12 validation, 8/8 liquidity** must stay green
- Fixtures: `scripts/make-fixtures.mjs`, validator clones in `Anchor.toml`
- Reports: `docs/audits/IMPL-01-*.md`, `IMPL-01B-*.md`

**Gaps vs component-02 spec (this is your job):**

1. No `GlobalConfig` PDA / no `initialize_global_config`
2. `create_market` does **not** require admin signer or allowlist membership
3. `Market` has no `premium_rate` / `premium_multiplier` (or risk_params placeholder) set from documented defaults
4. Spec errors `PoolNotAllowlisted`, `Unauthorized`, `MarketAlreadyExists` may be missing or unused
5. No dedicated factory test suite covering admin / allowlist / live geometry assertions

# Mission

1. **Phase 0 (short):** Diff current `create_market` + `Market` against `02-factory-allowlisted-market.md`. Write `docs/audits/IMPL-02-FEASIBILITY.md` with GO / GO WITH BLOCKERS / NO-GO. List exactly what you will add vs reuse. Only proceed on GO / GO WITH BLOCKERS.
2. Implement GlobalConfig + admin allowlist + harden `create_market` per spec.
3. Add factory tests; keep 01 suites green.
4. Write `docs/audits/IMPL-02-FACTORY-REPORT.md`.
5. **Stop.** Do not implement component 03 (Collateral Manager) or 04–11. Do not start Next.js.

---

# PHASE 0 — FEASIBILITY (mandatory, short)

In `IMPL-02-FEASIBILITY.md` confirm:

- Toolchain still builds with `--arch v0`
- Current `Market` PDA seeds: `[b"market", whirlpool]` (verify against code)
- Whether `create_market` accounts must change (add `global_config`, admin signer)
- Migration plan for existing tests that call `create_market` without GlobalConfig (update helpers, not delete liquidity coverage)
- Fair MVP allowlist size: **exactly one** pool pubkey (the recorded PERMA_WHIRLPOOL)

If something in the spec conflicts with working 01B behavior, **working Orca integration wins** for CPI/vaults; factory still must add admin+allowlist. Record any doc one-liners you fix.

---

# PHASE 1 — IMPLEMENT

## State

### `GlobalConfig` PDA — `seeds = [b"global_config"]`

Minimum fields:

- `admin: Pubkey`
- `allowlist`: Fair MVP = **one** `Pubkey` (or fixed-size array length 1 / Option + count). Prefer simple: `allowlisted_whirlpool: Pubkey` plus `bump` if you want zero dynamic alloc — OR a small vec with max 1. Document choice in the report.
- `bump: u8`
- Optional: `paused_global: bool` only if needed; prefer leaving pause to component 10 unless create must check it — **default: do not implement full pause admin here**

### Extend `Market` (backward-compatible init)

Add (if missing):

- `premium_rate: u64` — default **`1_000_000`**
- `premium_multiplier: u64` — default **`1_000`**
- Optional for risk params: either a small `RiskParams` struct with documented Fair MVP defaults from `09-risk-solvency.md` **if present and simple**, or `risk_params_bump` / placeholder zeros with a comment “filled in component 09” — **do not invent complex risk math in 02**

Keep existing adapter fields intact (`whirlpool`, mints, orca vaults, perma vaults, `tick_spacing`, `has_active_rewards`, `is_paused`, bumps).

**Account size:** if `Market` layout changes, bump discriminator/space carefully; update all `init` constraints; migrate tests. Prefer extending with new fields at end + `InitSpace` regenerate.

## Instructions

### `initialize_global_config(allowlisted_whirlpool: Pubkey)`

- Caller: becomes `admin` (signer)
- Inits `GlobalConfig`
- Sets allowlist to the provided whirlpool (must equal fixtures’ PERMA_WHIRLPOOL in tests)
- Rejects zero pubkey / wrong program later at create time
- Emit `GlobalConfigInitialized { admin, allowlisted_whirlpool }`

Optional MVP helper (only if useful for tests/ops):

### `set_allowlisted_whirlpool(new_pool: Pubkey)` — admin only

- Fair MVP may omit if allowlist is set only at init; if omitted, say so in report
- If included: admin-only, single pool replace

### Harden `create_market`

Must:

1. `admin` signer == `global_config.admin` → else `Unauthorized` (`0x30`)
2. `whirlpool.key()` is the allowlisted pool → else `PoolNotAllowlisted` (`0x21`)
3. Keep existing: Whirlpool program ID, no active rewards, live geometry read, PERMA vault mint/owner checks
4. Set `premium_rate` / `premium_multiplier` from defaults (and risk placeholder if any)
5. `MarketAlreadyExists` via Anchor `init` (document error mapping)
6. Emit `MarketCreated` (extend fields if useful: admin, premium defaults) — don’t break indexers expecting old fields without noting it

**Do not** hardcode `tick_spacing = 64` or `8`. Always read live.

## Module layout

Prefer:

```text
programs/perma/src/
  factory.rs   # NEW — global config + create_market orchestration helpers
  lib.rs       # wire instructions; keep adapter ix
  state.rs     # GlobalConfig + Market extensions
  errors.rs    # ensure catalog codes
  adapter.rs   # untouched except compile fixes from Market field adds
```

## Tests (`tests/factory.ts` or similar)

Required:

1. Admin `initialize_global_config` + `create_market` success; assert `Market.tick_spacing ==` live pool spacing (**8** on cloned pool)
2. `token_mint_a/b` and Orca `token_vault_a/b` on Market match live Whirlpool
3. Non-admin `create_market` → `Unauthorized`
4. Admin + wrong/unallowlisted whirlpool → `PoolNotAllowlisted`
5. Second `create_market` same pool → `MarketAlreadyExists` (or Anchor init error mapped)
6. Active-rewards pool rejected (keep/adapt existing behavior)
7. `premium_rate == 1_000_000` and `premium_multiplier == 1_000` after create
8. Regression: existing **adapter validation + liquidity** suites still **12/12 + 8/8** (and unit 8/8) after updating shared test helpers to init GlobalConfig first

## Docs / ops touch (minimal)

- Tick §A Step 4 checklist items that are now true in `02-factory-allowlisted-market.md` Done Definition (or note remaining ops-only items)
- README: how to run `yarn`/anchor factory tests
- If `ERROR-CATALOG` / `INSTRUCTIONS.md` lack these ix, add short entries only

## Out of scope

- Component 03 collateral deposit/withdraw/lock logic (vault ATAs may already exist from 01B fixtures — don’t rebuild collateral engine)
- Premium index engine (07), burn/settle (08), solvency math (09), pause admin UI (10), Next.js
- Changing allowlisted pool unless liquidity died
- Enabling `orca_whirlpools_client` `anchor` feature
- Mock Whirlpool

# Process

1. Phase 0 feasibility doc
2. Implement GlobalConfig + Market fields + harden create_market
3. Update test helpers used by adapter suites
4. Add factory tests; run full: unit + adapter + adapter-liquidity + factory
5. `IMPL-02-FACTORY-REPORT.md` — what shipped, test table, any Market size migration notes, residuals
6. Console summary → **stop**

# Done when

- [ ] `GlobalConfig` init works; admin-only create enforced
- [ ] Allowlist enforced (`PoolNotAllowlisted`)
- [ ] Live geometry + premium defaults on Market
- [ ] Factory tests green
- [ ] Prior 8 + 12 + 8 suites still green
- [ ] Reports written; no component 03+

# Start now

Phase 0 → implement → tests → report → stop.

END PROMPT
````

## One-liner

```text
Repo is PERMA. Component 01/01B are done (Orca liquidity green). Implement component 02 ONLY: GlobalConfig + admin allowlist + harden create_market (live tick_spacing, premium_rate=1e6, premium_multiplier=1000). Keep --arch v0 and all 01 tests green. Write IMPL-02-FEASIBILITY.md then IMPL-02-FACTORY-REPORT.md. No collateral/premium engine/UI.
```
