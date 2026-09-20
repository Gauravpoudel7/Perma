# PERMA — Claude Code Prompt: Component 09 Risk & Solvency (Fair MVP)

**How to use:** New Claude Code chat in `Perma/` repo root. Paste `PROMPT` → `END PROMPT`, then the one-liner.

**Why Phase 0 must rewrite docs before code:**  
`09-risk-solvency.md` is **not implementation-ready**. It names APIs and invariants but defines **no numeric margin**, no concrete `calculate_pnl` that conserves tokens, and assumes a Uniswap-style `get_observations()` / TWAP path that **does not exist** on Orca Whirlpool (`orca_whirlpools_client` 8.0.0: pool has spot `sqrt_price` / `tick_current_index` only; the `Oracle` PDA is adaptive-fee state, not a TWAP ring). Shipping invented margin % or a PnL that credits USDC from nowhere would be worse than an honest stub.

**Also wrong / stale in related docs (fix during Phase 0):**
1. **`08-burn-settle.md` §E** applies `risk::calculate_pnl` then `credit/debit_usdc` on **short** burn — but short realized PnL is **already** absorbed when `close_short` does `free += returned` and `locked -= spent` (`position.rs` / event text: `returned - unlocked` is realized PnL). A second PnL apply **double-counts** and breaks conservation.
2. **Long “intrinsic” PnL** with no funding source would **print money** (no counterparty debit). Fair MVP must not invent a USDC credit for long intrinsic.
3. **`09` still says `mint_options` / vague `UserValue`** — live instructions are `mint_position` / `burn_position` / `settle_premium`.
4. **Premium liability after 08:** open longs carry accrual in `accrued_scaled` / `payable_from`, not only legacy `premium_owed_usdc` (06-era). Solvency that only reads `premium_owed_usdc` **under-counts** live long debt.
5. **Long mint stub** (`balance_b > 0`) lets 1 µUSDC longs accrue unpayable premium (08 residual #5–#6).
6. **Short mint ~76 B headroom** (08 report). Adding oracle/price accounts onto short mint without measuring (or splitting init) will break the 1232-byte limit.
7. **`Market` has no risk params** (explicit note in `state.rs`). 09 must add them with demo defaults + ADR, same pattern as `premium_rate` / `premium_multiplier`.
8. **Liquidation** is Part B / stretch (`PRD.md` §A2, §A11). Do **not** ship `liquidate_account`.

---

````text
PROMPT
=====

# Role

You are a senior Solana / Anchor engineer implementing **PERMA Fair MVP component 09 — Risk & Solvency**, after first auditing **all** project docs against the live build and making the specs honest and implementable — without breaking shipped code or correct documentation.

Fresh chat. Extend the live program from components 01–08. Do not rewrite Orca adapter CPI paths. Keep all prior suites green.

# Product lock

- Fair MVP: one allowlisted WSOL/devUSDC pool, 1-leg, **no liquidation**
- Banner: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Read **in this order** before writing code:
  1. `docs/02-mvp-components/09-risk-solvency.md` (today: incomplete — you will rewrite)
  2. `docs/02-mvp-components/08-burn-settle.md` §E–G + Done Definition (P&L deferred; short path already realizes LP PnL via returns)
  3. `docs/adr/ADR-0002-premium-accounting.md` (premium seniority; no liquidation)
  4. `docs/audits/IMPL-08-BURN-SETTLE-REPORT.md` residuals #1, #5, #6
  5. `docs/audits/IMPL-06-LONG-MINT-REPORT.md` residual long solvency stub
  6. `programs/perma/src/{risk,position,premium,collateral,state,lib}.rs`
  7. `docs/02-mvp-components/01-clmm-adapter-orca.md` § security (spot vs settlement price)
  8. `orca_whirlpools_client` 8.0.0 account layouts: `Whirlpool`, `Oracle` — **verify there is no pool observation TWAP ring**
- Stack: `anchor-lang` 1.2.0, `orca_whirlpools_client` 8.0.0 **without** `anchor` feature, **`anchor build --arch v0`**
- Pool: `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (tick_spacing **8**)

# Already true (do not break)

- Short mint locks observed spend; short burn credits **returned** amounts → realized LP PnL already in free balances
- Premium cash settle via `range_vault` + `settle_premium`; liability clear only with transfer
- `check_withdraw_allowed` is the single withdraw seam (03 stub: free balance + `premium_owed_usdc`)
- Long mint uses `balance_b > 0` stub (not `InsolventMint`)
- Conservation: market vaults + Σ in_orca == Σ (free+locked); range_vault == premium_pool + dust (dust field may still be 0 — do not “fix” by inventing dust writes unless in scope)
- Short mint ~1156 B / ~76 B headroom

---

# PHASE 0 — DOCS + FEASIBILITY (mandatory, before code)

Order: **(1) full docs audit → (2) ADR-0003 + rewrite 09 → (3) feasibility GO → (4) only then code.**

Deliverables:

1. `docs/audits/DOCS-SYNC-AUDIT-09.md` — full-tree audit (see Q0)
2. `docs/audits/IMPL-09-FEASIBILITY.md` — GO / GO WITH BLOCKERS / NO-GO  
3. **Rewrite** `docs/02-mvp-components/09-risk-solvency.md` into an implementation-ready Fair MVP spec  
4. **`docs/adr/ADR-0003-fair-mvp-risk-model.md`** — decisions and rejected alternatives  
5. Surgical P0/P1 fixes to living specs per Q0 fix policy (not historical IMPL reports)


## Q0 — Full docs tree audit (mandatory, before rewriting 09)

Sweep **every** markdown file under `docs/` (and root `PRD.md` if present) against the **live** program + tests + latest `IMPL-*-REPORT.md` files. Goal: find anything wrong, stale, contradictory, or unsafe relative to what we are actually building — **without breaking correct docs or regressing shipped behavior**.

### How to audit (do not skip)

1. Inventory: list all `docs/**/*.md` and `PRD.md`.
2. For each file, check against live truth in `programs/perma/src/`, `tests/`, and shipped reports (01→08).
3. Flag issues into buckets:
   - **P0 — false / dangerous**: would cause wrong code, double-counts, printed money, fake oracles, wrong seeds, wrong instruction names that break integrators
   - **P1 — stale / contradictory**: old names (`mint_options`), “done” checkboxes that lie, TWAP claims, liquidation as required for Fair MVP, margin that doesn’t exist
   - **P2 — polish**: typos, broken links, wording only
4. Write findings to `docs/audits/DOCS-SYNC-AUDIT-09.md` with: file path, quote/snippet, why it’s wrong vs live code, proposed fix, risk if left alone.

### Known hotspots (verify, don’t assume)

- Component specs `01`–`11`, `COMPONENT-INDEX.md`
- `08-burn-settle.md` §E PnL vs `position::close_short` realized returns
- `09-risk-solvency.md` (numeric margin, TWAP, liquidation UI)
- `01-clmm-adapter-orca.md` observation/TWAP security notes
- `03` / `06` solvency / `InsolventMint` language
- `07` instruction names vs live `settle_premium` / `mint_position`
- `adr/ADR-0001`, `ADR-0002` (+ addenda) vs live
- `03-api-interfaces/INSTRUCTIONS.md`, `ERROR-CATALOG.md`
- `06-testing/RELEASE-GATE.md`, `FIXTURES-AND-VECTORS.md`, `LOCAL-DEV` if present
- `04-ui-ux/*` only if they claim on-chain behavior that isn’t true
- Presentation docs: don’t “fix” pitch language unless factually false

### Fix policy — **be sure not to break things**

- **Do not** rewrite history in `docs/audits/IMPL-*-REPORT.md` or `IMPL-*-FEASIBILITY.md` for past components (those are shipped records). At most add a one-line “superseded by ADR-0003 / 09” note if a claim is now wrong.
- **Do not** change live Rust behavior to match a bad doc. Fix the doc (or ADR) instead — unless Phase 1 intentionally implements a decided 09 behavior.
- **Do not** mass-reformat unrelated files (`cargo fmt` drive-bys). Same rule as 08.
- **Do not** invent features in docs (liquidation, TWAP, long intrinsic credits) to make the tree “look complete.”
- **Do** fix P0/P1 in **living** specs (component specs, ADR addenda, INSTRUCTIONS, ERROR-CATALOG, RELEASE-GATE, COMPONENT-INDEX) when the fix aligns docs to **already shipped** code or to **ADR-0003 decisions**.
- **Do** keep banner: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Prefer **minimal surgical edits** over full-file rewrites except for `09-risk-solvency.md` (full rewrite allowed/required).
- After doc fixes: links still resolve; no checkbox marked done for unshipped work; Fair MVP vs Part B clearly separated.

### Gate

Phase 0 is not GO until `DOCS-SYNC-AUDIT-09.md` exists and all **P0** items are either fixed or explicitly accepted with rationale in ADR-0003. P1 living-spec items should be fixed in the same Phase 0 pass when cheap; otherwise listed as residual with owner.


## Q1 — What 09 actually ships (scope)

**In (recommended Fair MVP):**
- Concrete **margin parameters** on `Market` (admin-set, demo defaults documented)
- **`check_solvency` / replace `check_withdraw_allowed` body** so withdraw cannot strand unpayable long premium
- **`InsolventMint` on long mint** (and any risk-increasing mint path you define)
- Accrued **open-long premium** counted as liability (not only legacy `premium_owed_usdc`)
- Honest documentation of **short realized PnL** (already via Orca returns) — **no second PnL debit/credit on burn**
- Long burn: **no synthetic intrinsic USDC credit** (conservation)

**Out:**
- `liquidate_account` / force-exercise
- Fake TWAP invented without a real data source
- PnL that credits a long from thin air
- Double-applying PnL on short burn
- UI “distance to liquidation” (docs may note UI later)
- Components 10–11 except errors/events you must emit from risk checks

## Q2 — Price / TWAP reality check (blocker-quality)

Prove with crate evidence:

- Does Whirlpool expose an observation array / TWAP? (Expected: **no** in client 8.0.0.)
- What is `Oracle` PDA actually? (Expected: adaptive fee, not TWAP.)

**Required decision (pick one, document in ADR-0003):**

| Option | When allowed |
|---|---|
| **A (recommended Fair MVP)** | Solvency **does not depend on mark/TWAP**. Use token balances + premium liability + explicit USDC margin buffer. Spot tick only for display / optional soft checks. `OracleDeviationTooHigh` stays reserved / unused. |
| **B** | PERMA maintains its **own** tick observation ring (write on mint/burn/settle) and builds a crude TWAP — only if you can specify seeds, update rule, window, and tests without blowing tx size. |
| **C** | External oracle (e.g. Pyth) — only if you justify dependency + account size; usually **NO-GO** for this hackathon session. |

**Forbidden:** claiming `clmm_adapter.get_observations()` exists when it does not.

Update `01-clmm-adapter-orca.md` security paragraph and `09` so they match the chosen option. Fix `ERROR-CATALOG` if `OracleDeviationTooHigh` is unused in Fair MVP (mark deferred).

## Q3 — PnL definition that conserves tokens

**Short:**  
`realized_pnl_s ≈ returned_s - locked_s` already applied in `close_short`.  
`calculate_pnl` for **settlement apply must be 0** (or a pure view helper that is never used to credit twice). Fix `08-burn-settle.md` §E.2 steps 3–4 accordingly.

**Long:**  
Premium is settled via `settle_premium` / burn settle.  
**Do not** implement intrinsic long PnL that `credit_usdc` without a matching debit from a defined pool. Document as Protocol V1 / stretch with liquidation & force-exercise.

If you expose `calculate_pnl` at all, make it a **view** that returns short realized estimate from stored `locked_*` vs current in-range amounts **without** mutating balances — or omit it from burn paths entirely.

## Q4 — Margin parameters (must be numeric)

Propose and pin on `Market` (names can vary; must be precise):

Example shape (you may refine with math proof in ADR):

- `long_initial_margin_usdc: u64` — minimum free USDC after mint, **or**
- `long_margin_per_liq: u64` — µUSDC required per liquidity unit (demo-tuned), **and/or**
- `long_premium_horizon_slots: u64` — require free USDC ≥ floor(horizon × rate × L × multiplier / PREMIUM_SCALE) + flat buffer

Defaults must be **demo-visible**, labeled **not fair-value**, same honesty as premium defaults.

Short margin: locked spend **is** the collateral; do not invent a second lock unless justified.

Rounding: margin **up** (protocol-conservative).

## Q5 — How solvency sees open longs (account model)

`UserCollateral.open_positions` counts **shorts only**. Open longs are separate PDAs.

Choose one:

- **A (recommended):** On `withdraw_collateral` and `mint_position` (LONG), require `remaining_accounts` = every open long for (market, owner); verify each PDA, owner, market, status Open, leg LONG; compute Σ payable after `update_index`+`accrue_long` (read-only accrual in a temp copy **or** write checkpoints — prefer write-through accrue only if CEI-safe). Count must match an `open_longs` counter you add, **or** accept max 1 long in Fair MVP and pass that one account.
- **B:** Maintain `UserCollateral.accrued_premium_liability_usdc` updated on every long touch — must prove no drift vs sum of positions.

Document max positions if remaining_accounts bounded by tx size.

## Q6 — Withdraw & mint gates

Replace stub logic:

```text
withdraw:
  free after ≥ 0
  free_b after ≥ premium_owed_usdc + Σ open_long_payable (+ margin buffer if required while longs open)
  locked still untouchable

long mint:
  inventory gate (existing)
  then InsolventMint if post-mint free USDC < required_margin(L) + any existing premium liability
```

Short mint: already requires balances ≥ token_max; optionally also run solvency if shorts could withdraw into insolvency — primary hole is **long premium**.

## Q7 — Tx size (residual #1)

Measure before/after: short mint, long mint, withdraw, burn.

If solvency needs extra accounts on short mint and breaks 1232 B: **do not** silently drop checks — split (`initialize_range` already exists pattern) or keep heavy accounts off short mint (prefer withdraw/long mint to carry long position accounts).

## Q8 — Tests

Unit: margin round-up; liability sums; short PnL helper does not mutate; no double-credit scenarios.

Integration:
1. Long with tiny USDC that would have passed `balance_b > 0` now fails `InsolventMint` when below margin
2. Open long accrues; withdraw that would leave unpaid premium → `InsolventWithdrawal`
3. Settle/burn premium then withdraw remaining free succeeds
4. Short burn still conservation-green; free balances reflect returned−locked **without** extra PnL ix
5. All prior suites green (multiple ordered passes); restart validator if flaky (08 residual)
6. Record measured tx sizes

## Q9 — Docs checklist (Phase 0 deliverable)

- [ ] `DOCS-SYNC-AUDIT-09.md` complete (every `docs/**/*.md` + `PRD.md` reviewed)
- [ ] All P0 findings fixed or ADR-accepted; living-spec P1s fixed or residual-listed
- [ ] Rewrite `09-risk-solvency.md` (formulas, params, gates, non-goals)
- [ ] ADR-0003 accepted
- [ ] Patch `08-burn-settle.md` §E PnL so short doesn’t double-apply; long intrinsic deferred
- [ ] Patch adapter security note / ERROR-CATALOG for TWAP decision
- [ ] Update `06-long-mint-inventory.md` InsolventMint done criteria
- [ ] COMPONENT-INDEX / INSTRUCTIONS naming (`mint_position`)
- [ ] No historical IMPL reports rewritten; no invented features; no drive-by fmt

End Phase 0 with **GO** only when audit + ADR + rewritten 09 exist and Q2/Q3 are decided.

---

# PHASE 1 — IMPLEMENT (only after Phase 0 GO)

1. Add Market risk fields + admin setter (or set at `create_market` / `initialize_global_config` defaults)  
2. Rewrite `risk.rs`: solvency helpers; withdraw seam; long mint gate  
3. Wire `lib.rs` call sites; remaining_accounts for longs as decided  
4. Fix burn paths: **ensure no second PnL token move**  
5. Errors: use `InsolventMint` / `InsolventWithdrawal` correctly (not `InsufficientFunds` for true margin fails)  
6. Tests + `IMPL-09-RISK-SOLVENCY-REPORT.md`  
7. **STOP** — do not start 10/11/UI unless asked  

## Out of scope (hard)

- Liquidation / force-exercise  
- Invented TWAP without ADR option B/C  
- Synthetic long intrinsic credits  
- Forgiving premium without settle transfer  
- Dropping `--arch v0`  
- Boiling the ocean on `cargo fmt` unrelated files (same rule as 08: own commit if needed)

# Done when

- [ ] `DOCS-SYNC-AUDIT-09.md` filed; living-spec P0s resolved  
- [ ] ADR-0003 + rewritten 09 spec merged in docs  
- [ ] Long mint uses real margin → `InsolventMint`  
- [ ] Withdraw counts open-long accrued premium (+ legacy owed)  
- [ ] No double PnL on short burn; no printed long intrinsic  
- [ ] TWAP/oracle story matches Orca reality  
- [ ] Prior suites green; sizes measured  
- [ ] Report written; 10 not started  

# Start now

Phase 0 full docs audit first, then ADR + rewrite 09. **Do not invent margin percentages in code before they appear in ADR-0003. Do not break shipped code or historical audit reports to match a bad doc.**

END PROMPT
````

## One-liner

```text
Repo is PERMA. 01–08 done (premium cash settle green). Component 09 Risk & Solvency: Phase 0 FIRST — audit EVERY docs/**/*.md + PRD.md into DOCS-SYNC-AUDIT-09.md (P0/P1/P2 vs live code); fix living-spec P0/P1 surgically without rewriting historical IMPL reports, without inventing features, without breaking shipped behavior. Then rewrite 09-risk-solvency.md + ADR-0003 (no numeric margin today; Orca TWAP/observations do not exist in whirlpools_client 8.0.0; 08§E short PnL would double-count returned−locked). Fair MVP: no liquidation; open-long premium on withdraw; InsolventMint with Market margin params; no synthetic long intrinsic; no second PnL on short burn. Measure tx size (~76 B headroom). Phase 0 → IMPL-09-FEASIBILITY.md → code → IMPL-09-RISK-SOLVENCY-REPORT.md. Keep --arch v0 and all prior suites green. STOP before 10.
```

## Design note for the human

The dangerous failure mode for 09 is “looks like Panoptic risk” while either (a) under-counting live long premium, (b) printing USDC via fake long PnL, or (c) double-paying shorts on burn. This prompt forces an ADR that matches the live token machine and Orca’s real accounts before any Rust lands.
