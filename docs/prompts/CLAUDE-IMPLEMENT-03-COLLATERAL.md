# PERMA — Claude Code Prompt: Implement Component 03 (Collateral Manager)

**How to use:** New Claude Code chat in `Perma/` repo root. Paste `PROMPT` → `END PROMPT`, then the one-liner.

**Context:** Components **01 + 01B + 02 are DONE** (Orca liquidity CPI green; GlobalConfig allowlist + hardened `create_market`). This session is **component 03 only**.

Do deep Phase 0 first. The collateral spec is thin; several traps are already visible from 01/02 work and ADR-0002. Resolve them explicitly before coding.

---

````text
PROMPT
=====

# Role

You are a senior Solana / Anchor engineer implementing **PERMA Fair MVP component 03: Collateral Manager**.

Fresh chat. Inspect the live program and docs. **Extend** the existing program — do not rewrite adapter or factory. Keep all 01/02 suites green (or update helpers only as needed, never delete liquidity coverage).

# Product lock

- Fair MVP: one allowlisted Orca WSOL/devUSDC Whirlpool, 1-leg, localnet/devnet
- Banner: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Scope: root `PRD.md` Part A (esp. A5 deposit/withdraw, A11 order: market+collateral after adapter)
- Specs (read all before Phase 0):
  1. `docs/02-mvp-components/03-collateral-manager.md` — primary
  2. `docs/02-mvp-components/09-risk-solvency.md` — withdraw gate (partially out of scope; see Phase 0 decision)
  3. `docs/02-mvp-components/08-burn-settle.md` — `debit_usdc` / `credit_usdc` / `range_vault` contract
  4. `docs/adr/ADR-0002-premium-accounting.md` — premium is USDC-only; seniority; vault separation
  5. `docs/03-api-interfaces/INSTRUCTIONS.md` §2 + `ERROR-CATALOG.md` §1
  6. `docs/audits/IMPL-01B-LIQUIDITY-CPI-REPORT.md`, `IMPL-02-FACTORY-REPORT.md` — vault ownership lessons
- Stack: `anchor-lang` **1.2.0**, `orca_whirlpools_client` **8.0.0** (no `anchor` feature), **`anchor build --arch v0`**
- Pool: `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (tick_spacing **8**)
- Mints: WSOL `So111…1112` (9 dp), Orca devUSDC `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k` (6 dp)

# What already exists (critical — do not invent a parallel vault system)

From 01/01B/02:

- `Market.vault_a` / `Market.vault_b` — PERMA SPL token accounts, **owned by `market_authority`**, mints must match the Whirlpool. Validated at `create_market`.
- Liquidity tests inject funded balances into those vault ATAs via `--account` fixtures (`scripts/make-fixtures.mjs`).
- `GlobalConfig` + admin allowlist; `create_market` admin-only.
- `PermaPosition` for shorts; adapter moves tokens **between** `Market.vault_*` and Orca vaults.
- **No** `UserCollateral` yet. **No** deposit/withdraw instructions yet.
- Adapter currently assumes vaults already hold tokens (fixture-funded). After 03, the honest user path is deposit → (later mint locks) → adapter spends from the same `Market.vault_*`.

**Design rule:** The protocol collateral vaults **are** `Market.vault_a` / `Market.vault_b`. Do not create a second pair of “collateral vaults” unless Phase 0 proves the current design cannot work. User accounting lives in `UserCollateral`; tokens live in the existing market vaults (plus separate `range_vault` for premium escrow).

---

# PHASE 0 — FEASIBILITY (mandatory, write the doc first)

Write `docs/audits/IMPL-03-FEASIBILITY.md` with verdict `GO` / `GO WITH BLOCKERS` / `NO-GO`.

You must answer these research questions with evidence from the repo (quote file paths). Do not skip.

## Q1 — SOL vs WSOL

The collateral spec says `sol_balance` / “SOL”. The pool and vaults use **WSOL** (SPL).  
Decide and document one Fair MVP model:

- **Recommended:** Treat “SOL collateral” as **WSOL** balances. `deposit_collateral` accepts WSOL ATA transfer (and optionally wrap native SOL in the same ix via sync_native). Never hold raw lamports in UserCollateral as if they were SPL.
- Reject dual native-SOL + WSOL bookkeeping unless you can prove conservation.

## Q2 — Shared vault conservation

Invariant: `sum(user free + locked for mint A) == vault_a.amount` (same for B), **excluding** amounts that live only in Orca positions mid-short (those left the PERMA vault via adapter).  

Be precise:

- After deposit: vault ↑, user free ↑
- After lock (accounting only): free ↓, locked ↑; vault unchanged
- After short add-liquidity (adapter, later components): vault ↓ into Orca; locked should still reflect obligation **or** you redefine locked to mean “reserved in vault pre-CPI” — **pick one model and stick to it**

**Recommended Fair MVP model (document if you choose it):**

1. `lock_collateral` is **accounting-only** (free → locked) before CPI.
2. Adapter `add_liquidity` pulls from `Market.vault_*` (already locked amount must be ≥ tokens sent).
3. On successful add, either keep `locked` as “capital at risk / reserved” while tokens sit in Orca, **or** move locked into an `in_orca` field. Prefer **minimal fields**: keep `*_locked` meaning “committed to open short(s)” including capital currently in Orca; vault conservation then is:

   `vault_amount + sum(orca_exposure_tracked) == sum(user free + locked)`  

   If that is too heavy for 03 alone, then for **03-only** define conservation as:

   `vault_a.amount == sum_over_users(usdc_or_sol free + locked)`  

   and require that **adapter liquidity tests** either (a) deposit via the new instructions before CPI, or (b) also credit matching `UserCollateral.locked` in test setup so the invariant holds. Prefer (a).

State the chosen invariant in the feasibility doc mathematically.

## Q3 — Solvency before component 09

`withdraw_collateral` must call a solvency check. Full PnL/TWAP/premium liability math is component **09** (and premium engine **07**).

Choose one and implement it honestly:

- **Option S1 (recommended for 03):** Implement `risk::check_withdraw_allowed` stub used only by withdraw:
  - Reject if `amount > free_balance` (`InsufficientFunds`)
  - Reject if user has `locked > 0` and withdrawal would require touching locked (`InsolventWithdrawal` or `InsufficientFunds`)
  - Reject if free after withdraw would be `< accrued_premium_liability` when that field exists; if premium engine absent, add `usdc_premium_owed: u64` on `UserCollateral` default 0, enforced now, written later by settle
  - Document that full `AccountValue >= RequiredCollateral` with PnL arrives in 09; wire a single function callers will replace internals later
- **Option S2:** Port a minimal real `is_solvent` now — only if you can do it without inventing undocumented margin formulas (09 still has no numeric `risk_params` after 02).

Do **not** invent margin percentages. Do **not** mark solvency “done” for 09.

## Q4 — Premium hooks in 03 without implementing 07/08

Spec requires `debit_usdc` / `credit_usdc` and `range_vault` PDA `["range_vault", market, tick_lower_le, tick_upper_le]` authority `market_authority`.

For 03:

- Implement **internal** helpers + optional thin test-only or admin/crank instructions **or** `pub(crate)` functions invoked by future burn/settle
- Create/init `range_vault` ATA (USDC only) when first needed
- Unit/integration tests: debit long → vault→range_vault; credit short → range_vault→user free; conservation `range_vault.amount == tracked_pool + dust` with a small `RangePremiumVaultState` **or** test-only counters
- Do **not** implement full `settle_premium` / index math here

## Q5 — CEI / re-entrancy

Solana account locks help, but still: **update `UserCollateral` before or atomically with token transfers in the same instruction**; never transfer then hope the CPA write succeeds. Prefer: validate → debit accounting → transfer with `market_authority` signer seeds → emit event.

## Q6 — Compatibility with 01B fixtures

Liquidity suite injects vault balances. After 03:

- Either update liquidity tests to `deposit_collateral` / credit users then lock before adapter CPI
- Or keep injection but also synthesize `UserCollateral` so vault conservation checks can run in a new suite
- Prefer migrating liquidity setup to deposit+lock so the demo path is real

## Q7 — Layout / validator reset

Extending accounts may require `--reset`. Document like 02.

End Phase 0 with GO and a checklist of files you will touch.

---

# PHASE 1 — IMPLEMENT (only after GO)

## State

### `UserCollateral` — `PDA(["collateral", market, user])`

Suggested fields (adjust names to match catalog, keep InitSpace clean):

- `market: Pubkey`
- `owner: Pubkey`
- `bump: u8`
- WSOL side: `balance_a` / `locked_a` (or `sol_*` if you insist — but document = WSOL)
- USDC side: `balance_b` / `locked_b`
- `premium_owed_usdc: u64` — accrued unsettled long premium liability (0 until 07/08 writes it)
- Optional: `bump` only; no floating point

Invariants enforced in helpers:

- `balance_*` and `locked_*` never underflow
- withdraw only from free `balance_*`
- lock requires `balance >= amount`; unlock requires `locked >= amount`

Seeds constants in `state::seeds`.

### Range vault

- Token account: seeds per spec; mint = `Market.token_mint_b` (USDC); owner = `market_authority`
- Companion state PDA if needed for `premium_pool` / `dust` bookkeeping used by tests (minimal)

## Module

```text
programs/perma/src/collateral.rs  # NEW
# wire in lib.rs
# risk_withdraw.rs or risk.rs stub for withdraw gate (optional thin module)
```

## Instructions (public)

### `deposit_collateral(amount_a: u64, amount_b: u64)`

- Signer: user
- Init-if-needed `UserCollateral`
- Transfer WSOL/USDC from user ATAs → `Market.vault_a` / `vault_b`
- Increase free balances
- Reject zero-zero; reject wrong mint ATAs
- Emit `CollateralDeposited`

### `withdraw_collateral(amount_a: u64, amount_b: u64)`

- Run solvency stub (Phase 0 decision)
- Decrease free balances first
- Transfer vault → user with `market_authority` signer
- Emit `CollateralWithdrawn`
- Errors: `InsufficientFunds` (`0x01`), `InsolventWithdrawal` (`0x02`)

### `lock_collateral` / `unlock_collateral`

- Prefer **`pub(crate)` / CPI-internal** called later by mint/burn, **plus** test harness instructions behind clearly named `test_` or documented as interim if needed for tests
- Or public but restricted: only callable when `remaining` proves a program self-call — simplest Fair MVP: **public instructions with user signer** that only move free↔locked for that user (mint will call in same tx via invoke later). For 03, user-signed lock/unlock is OK if mint isn’t built yet; document that 05 will compose them.

### Premium helpers

- `debit_usdc(user, amount)` / `credit_usdc(user, amount)` as documented — usable from same program modules
- Fail `InsufficientCollateralForLoss` (`0x53`) when debit exceeds free USDC (seniority: do not silently take from locked unless Phase 0 explicitly allows — **default: debit free USDC only**)

## Pause

If `Market.is_paused`, reject deposit/withdraw/lock that increases risk (at least withdraw-to-external and deposit — match security baseline if documented). Don’t build full pause admin (10).

## Errors

Ensure catalog codes exist and are used: `InsufficientFunds`, `InsolventWithdrawal`, `InsufficientCollateralForLoss`; add any missing with stable hex.

## Tests (mandatory)

New `tests/collateral.ts` (and unit tests in `collateral.rs`):

1. Deposit WSOL/USDC → balances + vault amounts match
2. Withdraw happy path
3. Withdraw > free → `InsufficientFunds`
4. Lock then withdraw that would steal locked → fail
5. Unlock restores free
6. Vault conservation: sum of users’ free+locked equals vault amount (multi-user smoke)
7. `debit_usdc` / `credit_usdc` + range_vault conservation
8. Non-owner cannot withdraw someone else’s PDA
9. Wrong mint ATA rejected
10. After pause flag if easy to set in test — optional

**Regression:** unit + factory + factory-rewards + adapter + adapter-liquidity still green. Update liquidity setup to deposit/lock if that was the Phase 0 choice; never drop real CPI coverage.

## Docs (minimal)

- Tick Done Definition boxes in `03-collateral-manager.md` that are truly done; note 09 still owns full solvency
- README: how to run collateral tests
- `IMPL-03-FEASIBILITY.md` + `IMPL-03-COLLATERAL-REPORT.md`
- One ADR addendum **only if** you change a documented invariant (e.g. SOL→WSOL naming)

## Out of scope

- Components 04–11 product flows (mint/burn/premium index/full solvency/pause admin/UI)
- Inventing margin formulas / liquidation
- Changing allowlisted pool
- Enabling client `anchor` feature / dropping `--arch v0`
- Mock Whirlpool
- Second collateral vault system parallel to `Market.vault_*`

# Process

1. Phase 0 research doc with Q1–Q7 answered
2. Implement state + collateral module + withdraw stub
3. Tests + migrate 01B setup if required
4. Full suite run (document factory-rewards separate ledger command)
5. Report → console summary → **STOP** (no component 04)

# Done when

- [ ] Deposit/withdraw work against `Market.vault_*`
- [ ] Lock/unlock accounting works
- [ ] Withdraw solvency stub honest + documented
- [ ] Premium debit/credit + range_vault hooks tested
- [ ] Conservation invariant stated and tested for the 03 model
- [ ] Prior suites green
- [ ] Feasibility + impl reports written

# Start now

Phase 0 first. Do not code deposit until Q1–Q7 are written down.

END PROMPT
````

## One-liner

```text
Repo is PERMA. 01/01B/02 done. Implement component 03 ONLY after Phase 0 answers SOL-vs-WSOL, vault conservation with existing Market.vault_*, solvency stub vs full 09, and premium range_vault hooks. Reuse Market.vault_a/b (no second vault system). Keep --arch v0 and all prior suites green. Write IMPL-03-FEASIBILITY.md then IMPL-03-COLLATERAL-REPORT.md. No mint/burn/UI.
```

## Why this prompt is stricter than 02 (for the human)

Lessons baked in from prior sessions:

1. **Impossible pins / silent assumptions** → Phase 0 questions are mandatory and written to a file first  
2. **Placeholder vaults** → forbids a second vault; forces conservation math  
3. **Unreachable guards** → solvency stub must be honestly tested (locked + free), not claimed  
4. **Spec vs reality (SOL vs WSOL, create_market args)** → explicit Q1/Q decisions like 02’s allowlist  
5. **Premium double-count risk** → debit/credit + range_vault separation from ADR-0002 without building full 07/08  
6. **Layout breaks** → warn `--reset` and protect liquidity suite  

