# PERMA — Claude Code Prompt: Component 08 Burn & Settle (premium cash)

**How to use:** New Claude Code chat in `Perma/` repo root. Paste `PROMPT` → `END PROMPT`, then the one-liner.

**Why this session exists:**  
Component 06 shipped long mint + premium scaffold (index, range state, poke-before-weights) and an honest gap: longs record `premium_owed_usdc` with **no transfer**, shorts accrue entitlement they **cannot claim**. ADR-0002 addendum states the forward requirement plainly: **08 must both transfer USDC into the range vault and clear the liability**. Clearing without transferring forgives real debt.

**Explicitly OUT:** numeric P&L / `risk::calculate_pnl` (component 09), liquidation, UI, multi-leg, Raydium.

---

````text
PROMPT
=====

# Role

You are a senior Solana / Anchor engineer implementing **PERMA Fair MVP component 08 — Burn & Settle (premium cash path)**.

Fresh chat. Extend the live program from components 01–06. Do not rewrite the Orca adapter. Keep all prior suites green (update helpers only; never drop short CPI / long inventory coverage).

# Product lock

- Fair MVP: one allowlisted WSOL/devUSDC pool, 1-leg
- Banner: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Read **in this order** before Phase 0:
  1. `docs/02-mvp-components/08-burn-settle.md` (esp. §A–F, invariants, V5/PendingPremium)
  2. `docs/02-mvp-components/07-premium-engine.md` (payable_from / floor-with-carry — already implemented; do not re-derive)
  3. `docs/adr/ADR-0002-premium-accounting.md` + **both addenda** (WSOL collateral; long-burn liability-without-cash → 08 must transfer+clear)
  4. `docs/audits/IMPL-06-LONG-MINT-REPORT.md` (residuals #1 tx headroom, #2 settle gap, #6 assert.fail pattern)
  5. `docs/06-testing/FIXTURES-AND-VECTORS.md` vectors **V2, V3, V5, V6** (cash settle)
  6. `docs/03-api-interfaces/INSTRUCTIONS.md` — `settle_premium`
  7. Live: `programs/perma/src/{lib,position,premium,collateral,state,risk,errors}.rs`
- Stack: `anchor-lang` 1.2.0, `orca_whirlpools_client` 8.0.0 **without** `anchor` feature, **`anchor build --arch v0`**
- Pool: `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (tick_spacing **8**)

# Already true (do not break)

- Short mint/burn still does real Orca liquidity + 3-step close
- Long mint inventory-gated; poke-before-weights proven (V4 unit tests)
- `premium.rs`: `update_index`, `poke_range`, `accrue_long`, `payable_from`, `claimable_for`
- `RangePremiumState.premium_pool` / `receivable` / `dust` exist and are **always zero** today — 08 must make them real without a migration story beyond init
- `UserCollateral.premium_owed_usdc` is written on long burn (06) and enforced on withdraw (03) — **never cleared without a matching USDC transfer**
- `debit_usdc` / `credit_usdc` are `pub(crate)` — keep that; no admin settle backdoor
- Conservation on market vaults: `vault + Σ in_orca == Σ (free+locked)` for WSOL/USDC collateral path
- Short mint ~1123 B / ~185k CU — **~109 bytes headroom** (residual #1). Measure before adding accounts.

---

# PHASE 0 — FEASIBILITY (mandatory)

Write `docs/audits/IMPL-08-FEASIBILITY.md` with GO / GO WITH BLOCKERS / NO-GO.

Answer with **repo evidence**:

## Q1 — Scope boundary (08 vs 09)

`08-burn-settle.md` §E applies **P&L** via `risk::calculate_pnl`. That function does **not** exist as a real valuation (09).

**Required decision (recommended):**  
Ship **premium cash settle only**. On burn paths, **P&L = 0 stub** (no debit/credit for PnL). Document that §E steps 3–4 are deferred to 09. Do **not** invent mark/TWAP math.

Premium settle + `PendingPremium` + `range_vault` are in. Fake PnL is out.

## Q2 — `range_vault` lifecycle

Seeds: `["range_vault", market, tick_lower_le, tick_upper_le]` — USDC mint, owner/`authority` = `market_authority` (same as market vaults).

Decide and prove:

- When is the ATA created? (Recommended: `init_if_needed` on first `settle_premium` that needs it, or on first short that creates `RangePremiumState` — pick one; rent payer = caller or admin; document.)
- Invariant: **`range_vault.amount == premium_pool + dust`** after every successful settle/claim.
- Range vault is **not** the market `vault_b`. Mixing them breaks conservation checks.

## Q3 — Clearing `premium_owed_usdc` (ADR forward requirement)

Today long burn: `payable_from` → `premium_owed_usdc += payable`, **no transfer**.

After 08:

- `settle_premium` (long) and long burn’s settle step must **transfer µUSDC from market `vault_b` → `range_vault`**, `debit_usdc` the owner, `premium_pool += paid`, and **decrease `premium_owed_usdc` by the amount transferred** when that liability was previously recorded — **or** stop writing `premium_owed` on burn entirely once settle-at-burn always transfers first.
- **Forbidden:** zeroing `premium_owed_usdc` without an equal successful token transfer into `range_vault`.
- Pre-existing demo debts from 06 (closed longs with `premium_owed > 0` and no open position): document residual — tests use fresh collateral; do **not** add a silent forgive instruction.

## Q4 — Long `settle_premium` (permissionless)

Per §C / INSTRUCTIONS:

- Anyone may crank any **Open** long.
- Order: `update_index` → `poke_range` → `accrue_long` → `payable_from` → require `payable > 0` else `NothingToSettle` → debit + transfer → `premium_pool +=` → pay down `receivable = min(receivable, premium_pool)` accounting per spec.
- Floor-with-carry already in `payable_from` — do not change rounding.
- CEI: update all bookkeeping, then token transfer (or prove Anchor account constraints make re-entry impossible); never transfer then “forget” to clear liability.

## Q5 — Short claim + `PendingPremium`

- Enable `position_status::PENDING_PREMIUM` (comment in `state.rs` already anticipates this).
- Add `premium_receivable: u64` on `PermaPosition` if missing.
- Short settle (§D): claim while still in denominator if Open; `paid = min(owed, premium_pool)`; remainder → `premium_receivable` / `receivable`.
- Short burn (§E.2 order is security): **claim/settle premium FIRST** (while `total_short` still includes this position) → **then** poke-before-weights decrease `total_short` → then existing Orca 3-step close + unlock → status `Closed` or `PendingPremium`.
- Later `settle_premium(short)` on `PendingPremium` that clears receivable closes the account and refunds rent.
- Vector **V5** must be an integration test, not a comment.

## Q6 — Long burn rewrite

Replace 06 liability-only long burn:

1. Real `settle_premium_long` (must succeed for payable; if `payable==0` proceed)
2. If free USDC cannot cover payable → `InsufficientCollateralForLoss` / existing debit error; position stays **Open**
3. `poke` → decrease `total_long` → close PDA
4. **Do not** leave new `premium_owed` if transfer succeeded
5. P&L stub = 0 (Q1)

## Q7 — Tx size (residual #1)

Short burn / settle paths gain `range_vault` (+ maybe token program accounts already present).

**Measure** before and after: short mint, short burn, long burn, `settle_premium` long/short — bytes, account count, CU. If any product ix exceeds 1232 bytes, split (e.g. ensure range_vault exists in a prior ix) — **measure, don’t guess**.

## Q8 — Conservation identity upgrade

Keep market vault identity. Add:

- `range_vault.amount == premium_pool + dust`
- Per-range zero-sum over a test: `Σ long payments == Σ short claims + dust` (V2/V3)

Assert both in integration tests around settle paths.

## Q9 — Test harness / residual #6

- `position-long.ts` must still leave no open longs (after hook).
- Prefer rethrowing `chai.AssertionError` instead of string-matching `assert.fail` messages in **new** tests; optionally sweep residual #6 in suites you touch (do not boil the ocean).

End Phase 0 with GO and a concrete file touch list.

---

# PHASE 1 — IMPLEMENT

## State / seeds

- Use existing `seeds::RANGE_VAULT` (already in `state.rs`).
- Wire `PendingPremium` status constant; extend `PermaPosition` with `premium_receivable` if absent.
- Keep `premium_pool` / `receivable` / `dust` semantics exactly as `08-burn-settle.md` §A.

## New instruction: `settle_premium`

- Args: leg discriminator or infer from position.
- Accounts: market, index, range, position, user_collateral, market vault_b, range_vault, authority, token program, caller (signer; for long crank need not be owner — **permissionless long**).
- Long path: §C. Short path: §D.
- Errors: `NothingToSettle`, `RangeStateMismatch`, collateral/token failures.

## Rewrite burns

- Long burn: settle cash then close (Q6).
- Short burn: settle/claim then weight decrease then Orca close (Q5).
- Still **no** real PnL (Q1).

## Optional: range unwind / dust sweep

If cheap after core path: when `total_short==0 && total_long==0 && receivable==0`, allow closer to move `dust` to a protocol fee ATA and close range+vault. If this threatens scope or tx size, document as residual and skip — **core settle/claim/PendingPremium come first**.

## Unit tests

- Keep V4 ordering tests green.
- Add / extend cash-facing unit coverage where pure (claimable capping by pool, receivable math) without requiring a validator.

## Integration tests (`tests/settle-premium.ts` or extend position-long/short)

Must include:

1. Long settles → vault_b down, range_vault up, `premium_pool` matches, free USDC down, `premium_owed` not increased  
2. Double settle same slot → second `NothingToSettle`  
3. Permissionless: non-owner crank on long succeeds  
4. **V5:** short burns while pool empty → `PendingPremium` + receivable; long later settles; short claims → Closed + rent reclaim  
5. **V2-style:** unequal shorts claim pro-rata after long funds; `claims + dust == paid`  
6. Long burn with accrued premium moves cash (not liability-only)  
7. Withdraw still blocked while `premium_owed > 0`; after full settle/clear, withdraw of remaining free works  
8. Regression: prior suites green (two ordered passes)  
9. Measured tx sizes recorded in the report  

## Docs

- `docs/audits/IMPL-08-FEASIBILITY.md`
- `docs/audits/IMPL-08-BURN-SETTLE-REPORT.md`
- Update `08-burn-settle.md` done checkboxes only for what shipped; mark PnL §E as deferred to 09
- ADR-0002 short addendum: “08 transfers + clears; PnL deferred to 09” if needed
- README / RELEASE-GATE test commands

## Out of scope (hard)

- Real PnL / oracle / TWAP / insolvent long liquidation (09)
- Admin pathway that moves user funds without matching settle math
- Forgiving `premium_owed` without transfer
- Changing poke-before-weights or PREMIUM_SCALE math
- Multi-leg, Raydium, UI
- Dropping `--arch v0` / enabling client `anchor` feature
- Claiming component 07 “fully done” beyond what 06 already shipped

# Process

1. Phase 0 doc with Q1–Q9  
2. `range_vault` + `settle_premium` long/short  
3. Rewrite long/short burn premium steps  
4. Integration tests (especially V5) + measure sizes  
5. Report → **STOP** (do not start component 09)

# Done when

- [ ] `settle_premium` long (permissionless) and short (claim) move real USDC via `range_vault`
- [ ] `range_vault.amount == premium_pool + dust` after every settle path
- [ ] Long burn no longer leaves unpaid premium as “owed without transfer” when settle succeeds
- [ ] `premium_owed_usdc` never decreases without a matching transfer into `range_vault`
- [ ] `PendingPremium` + V5 proven
- [ ] P&L explicitly stubbed / deferred to 09
- [ ] All prior suites green; sizes measured
- [ ] Feasibility + report written; 09 not started

# Start now

Phase 0 first. Do not ship a `settle_premium` that clears `premium_owed_usdc` without a token transfer.

END PROMPT
````

## One-liner

```text
Repo is PERMA. 01–06 done (long mint + premium scaffold green; cash settle deliberately not done). Implement component 08 Burn & Settle premium cash only: range_vault, settle_premium long (permissionless) + short (claim), PendingPremium / V5, rewrite burns to transfer before close. MUST transfer USDC into range_vault AND clear premium_owed — never clear without transfer. Stub P&L = 0 (defer real PnL to 09). Phase 0 → IMPL-08-FEASIBILITY.md → code → IMPL-08-BURN-SETTLE-REPORT.md. Measure tx size (short mint has ~109 B headroom). Keep --arch v0 and all prior suites green. STOP before 09.
```

## Design note for the human (why this prompt is careful)

06 correctly refused to fake payment. The failure mode for 08 is the opposite: clearing `premium_owed_usdc` or `receivable` in bookkeeping while leaving USDC in the market vault. The prompt makes transfer+clear a hard gate, separates `range_vault` from market vaults so conservation stays checkable, forces V5/`PendingPremium` (shorts who exit early still get paid when cash arrives), and keeps fake PnL out so 09 is not silently “done.”
