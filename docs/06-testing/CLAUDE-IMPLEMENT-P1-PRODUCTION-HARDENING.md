# PERMA — Claude Code Prompt: P1 Production Hardening

**How to use:** New Claude Code chat in the Fair-closed repo root (`Perma/`, prefer Mac `/Users/maxcell/perma/Perma` at Fair tip `f6a6a22` or newer). Paste `PROMPT` → `END PROMPT`, then the one-liner.

**Why this session exists:**  
Fair MVP **01–11 is COMPLETE**. Release gate **GREEN** (2026-09-21): **102/102** integration suites both orders on a fresh ledger, **`yarn test:unit` 66** green, commit **`f6a6a22`**. Pause/admin (10) and thin events (11) shipped. Protocol V1 starts at **P1 — Production Hardening** under `docs/09-post-mvp/ROADMAP.md`.

P1 makes the Fair surface **ops-ready for a startup**, not a demo-day slide: retire single-EOA admin risk via a **realistic Squads path**, add **lean monitoring** on the live event catalog, and close the real Fair gap of **empty-range premium residue** (declared `dust` / no unwind). Commission is **deferred with a ticket** unless Phase 0 proves demo continuity requires it (it does not today).

**Explicitly OUT (blacklist — do not touch):** P2 indexer/charts/Postgres/history APIs; P3 oracle / ADR-0004 code; P4 liquidation / force-exercise; P5 multi-leg; P6 Raydium / multi-pool; renaming or reordering Fair events; reopening Exit Guaranteed pause matrix; premium math / scales / payable-claimable; Orca CPI metas or account order; ADR-0003 solvency formulas; `pause_global` / `GlobalConfig` resize; allowlist mutation; premium-rate setters; inventing APY or commission bps; drive-by refactors; full observability stacks (Prometheus/Grafana/PagerDuty).

**Honesty banner (repeat in feasibility + report):**  
`Prototype. Not audited. Single pool. Not production mainnet risk capital.`

---

````text
PROMPT
=====

# Role

You are a senior Solana / Anchor engineer implementing **PERMA Protocol V1 — P1 Production Hardening**.

Fresh chat. Extend the **Fair-closed** program + thin UI from components **01–11**. **Do not rewrite** the Orca adapter, premium engine, burn/settle cash path, solvency math (ADR-0003), Exit Guaranteed pause matrix (10), or Fair event names (11). Keep **102/102** release gate + **unit 66** green. Helpers only — never drop prior suite coverage.

# Product lock

- Fair MVP closed: one allowlisted WSOL/devUSDC Orca Whirlpool, 1-leg, localnet UI live
- Banner: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Program id (verify in `Anchor.toml` / `declare_id!`): `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt`
- Stack: `anchor-lang` **1.2.0**, `orca_whirlpools_client` **8.0.0** **without** `anchor` feature, **`anchor build --arch v0`**
- Allowlisted pool (do not change): `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (tick_spacing **8**)
- Fair tip at prompt draft: commit **`f6a6a22`** — re-verify `git log -1` on your checkout
- Suites: **102** integration (RELEASE-GATE §4.2) + **66** unit (`yarn test:unit`) must stay green; add P1 tests

# Authority docs (read in this order before Phase 0)

1. `docs/09-post-mvp/ROADMAP.md` — **P1** entry/exit/forbidden
2. `docs/09-post-mvp/COMPLETE-PRODUCT-DEFINITION.md` — **Ops** checklist (multisig, monitoring, range unwind/dust)
3. `docs/09-post-mvp/GAP-ANALYSIS-FAIR-TO-COMPLETE.md` — dust/unwind, commissions, multisig, monitoring rows
4. `docs/09-post-mvp/SECURITY-AUDIT-MAINNET.md` — admin key abuse, pause exit guarantee themes
5. `docs/09-post-mvp/NON-GOALS.md` — no fake APY; no Fair reopen; admin multisig sufficient (no DAO)
6. `docs/05-engineering/SECURITY-BASELINE.md` — admin authority baseline
7. `docs/07-ops-presentation/RUNBOOK-DEVNET.md` — Emergency Pause (single-key today)
8. `docs/02-mvp-components/10-pause-admin.md` — what shipped; multisig deferred; Exit Guaranteed matrix (do not reopen)
9. Fair living: `docs/06-testing/RELEASE-GATE.md`, `docs/00-overview/MVP-SCOPE.md`, `docs/02-mvp-components/COMPONENT-INDEX.md`, `docs/03-api-interfaces/INSTRUCTIONS.md`, `docs/03-api-interfaces/EVENT-CATALOG.md`
10. Premium residue truth: `docs/02-mvp-components/08-burn-settle.md` (range unwind **Not implemented**), `docs/adr/ADR-0002-premium-accounting.md` (sweep-to-protocol on unwind), `docs/audits/IMPL-08-BURN-SETTLE-REPORT.md` residuals #2–#3
11. Prior prompt quality bar: `docs/prompts/CLAUDE-IMPLEMENT-10-PAUSE-ADMIN.md`, `docs/prompts/CLAUDE-IMPLEMENT-11-EVENTS-INDEXING.md`
12. Live code: `programs/perma/src/{lib,state,factory,premium,errors}.rs`, `scripts/reconcile.mjs`, `apps/web/scripts/pause-market.ts`, `apps/web/src/lib/events.ts`, `tests/pause-admin.ts`, `tests/events.ts`

# Repo facts (re-verify on disk; do not invent)

## Research snapshot (drafting agent, 2026-09-21 NPT) — HINTS ONLY

Mac `machineId` `67a1ed8b-11e7-4872-947f-bdff8253ed02` was **unreachable** from the drafting executor. Snapshot below is from public GitHub `Gauravpoudel7/Perma` **main @ f6a6a22** (Fair closed). **Your Phase 0 inventory on the Mac checkout is authoritative.**

### Already true — DO NOT BREAK

| Fact | Where |
|---|---|
| Fair 01–11 complete; gate GREEN 102/102 + unit 66 | `RELEASE-GATE.md`, `MVP-SCOPE.md`, `COMPONENT-INDEX.md` |
| `GlobalConfig { admin, allowlisted_whirlpool, bump }` — **no** pause field; **no** admin setter; allowlist fixed at init | `state.rs`, `INSTRUCTIONS.md` |
| Admin auth: `factory::require_admin` + `GlobalConfig.admin` | `factory.rs`; used by `create_market`, `pause_market`, `unpause_market`, `set_market_risk_params` |
| Pause writers + Exit Guaranteed matrix shipped | `10-pause-admin.md`, `lib.rs`, `tests/pause-admin.ts` (17) |
| 19 Fair events catalogued; thin consumer in web | `EVENT-CATALOG.md`, `apps/web/src/lib/events.ts`, `tests/events.ts` |
| Ops scripts: `yarn pause-market` / `unpause-market` / `set-risk-params` | `apps/web/scripts/pause-market.ts` |
| Conservation: `scripts/reconcile.mjs` checks `range_vault.amount == premium_pool + dust` | `scripts/reconcile.mjs` |
| `RangePremiumState.dust: u64` **declared, never written**; residue stays in `premium_pool` | `state.rs`, IMPL-08 residual #2 |
| **No** `transfer_admin` / `set_admin` / `AdminTransferred` | `lib.rs` / `INSTRUCTIONS.md` |
| **No** range unwind / dust sweep instruction; INSTRUCTIONS §5 says so explicitly | `INSTRUCTIONS.md`, `08-burn-settle.md` |
| Short mint is atomic open+add — product path does **not** leave orphan Orca positions | `INSTRUCTIONS.md` SHORT path |
| **No** on-chain `commission_rate` / protocol fee vault / PLP share fields | `state.rs` inventory |
| Program id / whirlpool / tick_spacing locked as above | `Anchor.toml`, factory |

### Missing (this phase — P1 ONLY)

1. **Multisig path:** on-chain ability to **transfer** `GlobalConfig.admin` + ops runbook to point it at a Squads (or equivalent) vault; localnet proof that pause/risk still work after transfer
2. **Monitoring hooks:** lean script/checklist on EVENT-CATALOG + reconcile — not a product indexer
3. **Empty-range unwind / residue cleanup:** named instruction + ironclad tests (real Fair gap per ADR-0002 / IMPL-08) — **or** Phase 0 DEFER with ticket if preconditions cannot be proven safe
4. **Commission:** default **DEFER with ticket** (Fair demo continuity does not require it; inventing bps/APY forbidden)
5. Surgical living-doc updates + `IMPL-P1-*` feasibility/report
6. P1 tests; **102 + 66 stay green**

## Doc conflicts (resolve in Phase 0; do not silently pick the unsafe / vaporware side)

| Conflict | Safer P1 rule (mandated unless Phase 0 proves otherwise) |
|---|---|
| ROADMAP P1 exit “Admin authority **is** multisig” vs Fair single EOA + no Squads CPI in-repo | **Ops-ready path:** ship `transfer_admin` + tested authority handoff + Squads (or stand-in) **runbook**. Do **not** embed Squads program CPI into PERMA. Do **not** redesign `GlobalConfig` into a half-broken “squad PDA” account type. Localnet may use Keypair B as multisig stand-in. |
| COMPLETE Ops “range unwind / dust cleanup” vs 08 “governance question unanswered” | **In scope if** Phase 0 writes ironclad empty-range preconditions + destination rule aligned with ADR-0002 (“sweep to protocol on unwind”). Prefer **admin-gated** P1 ix over permissionless fund movement. If you cannot prove safety without inventing policy, **DEFER with ticket** and still ship multisig + monitoring. |
| GAP “orphan / leftover liquidity chunks” vs atomic short mint (no Orca orphan on product path) | **Do not invent** an “orphan Orca rescue” ix. Scope unwind to **PERMA range premium residue** (`premium_pool` when range empty). Adapter harness leftovers stay test-only. |
| PRD B18 commission REQUIRED (complete product) vs ROADMAP “if product requires for demo continuity” | **DEFER** with explicit ticket. Fair Trade loop works without opening commission. Do **not** invent ~10 bps or APY copy. |
| `docs/09-post-mvp/README.md` still calls 10/11 Fair leftovers | Stale relative to `MVP-SCOPE` / RELEASE-GATE / `f6a6a22`. Surgically note gate passed; do not reopen Fair. |
| INSTRUCTIONS “no admin path that moves user funds” vs unwind moving residue | Unwind moves **unattributable residue**, not user free/locked collateral. Document the distinction; never add arbitrary admin withdraw of user vaults. |
| EVENT-CATALOG stability (no rename/reorder) | Additive events only (`AdminTransferred`, `RangeUnwound`). Never rename Fair events. |
| Monitoring vs P2 indexer | Scripts + runbook checklist only. No Postgres, no chart APIs, no `indexer/` product service. |

---

# PHASE 0 — FEASIBILITY (mandatory before code)

Write `docs/audits/IMPL-P1-FEASIBILITY.md` with **GO / GO WITH BLOCKERS / NO-GO**.

## Q0 — Live inventory (cite file:line)

Table on your checkout:

1. Every admin-gated ix + `require_admin` call sites
2. `GlobalConfig` / `Market` / `RangePremiumState` field layouts (confirm no silent realloc plan)
3. Every `dust` / `premium_pool` / `receivable` read/write
4. Every `emit!` relevant to pause/admin (already shipped) + consumer entrypoints
5. Existing scripts: `reconcile.mjs`, `pause-market.ts`, any monitor gaps
6. Confirm **absence** of commission fields and transfer-admin

## Q1 — In-scope vs OUT matrix (implement exactly this)

| Work item | P1 decision |
|---|---|
| `transfer_admin(new_admin)` | **IN** — write `GlobalConfig.admin` in place; emit `AdminTransferred` |
| Squads vault creation / Squads program CPI inside PERMA | **OUT** — document external Squads (or equivalent) + localnet stand-in |
| Multisig pause/unpause/set-risk runbook + drill | **IN** — extend `RUNBOOK-DEVNET.md`; script may print ix for Squads proposal |
| Lean monitoring script + checklist | **IN** — see Q4 |
| P2 indexer / charts / history APIs | **OUT** |
| `unwind_empty_range` (name may vary; pick one) | **IN by default** if Q3 GO; else **DEFER with ticket** |
| Orphan Orca position sweeper | **OUT** (not a Fair product-path gap) |
| Opening commission / PLP share / APY | **DEFER with ticket** (default) |
| `pause_global` / resize `GlobalConfig` | **OUT** |
| Allowlist setter / premium-rate setter | **OUT** |
| Exit Guaranteed matrix changes | **OUT** |
| Oracle / liquidation / multi-leg / Raydium | **OUT** |

## Q2 — Multisig / `transfer_admin` (realistic Fair→P1 path)

**Chosen path (mandated):**

1. Add `transfer_admin(new_admin: Pubkey)`:
   - Accounts: `admin` (signer, current), `global_config` (mut, PDA `b"global_config"`)
   - `factory::require_admin`; reject `new_admin == Pubkey::default()` (reuse or append error at **end** of enum only)
   - Idempotent OK if `new_admin == current` (document emit-or-not; prefer no-op no event like pause)
   - Write `global_config.admin = new_admin` **in place** — **no layout change**
   - Emit `AdminTransferred { old_admin, new_admin }` on real change
2. **Do not** change allowlist; still no allowlist setter
3. **Do not** require Squads accounts in PERMA ix surface
4. Ops:
   - Document: create Squads vault (devnet/mainnet later) → `transfer_admin(vault)` signed by current EOA → future pause/risk txs proposed via Squads
   - Localnet/devnet test: Keypair A (current) transfers to Keypair B; A pause → `Unauthorized`; B pause/unpause/set-risk OK
5. Extend `apps/web/scripts/pause-market.ts` **or** sibling script with `transfer-admin <pubkey>` (same wallet conventions)
6. Update `10-pause-admin.md` / `INSTRUCTIONS.md` / SECURITY notes: single-EOA retired **when** transfer completed; until then honesty remains

## Q3 — Dust / range unwind (prove or defer)

**Truth:** residue is real; `dust` field never written; no unwind ix; ADR-0002 intends sweep-to-protocol when a range **fully unwinds**.

**If GO (preferred):** ship **admin-only** `unwind_empty_range(tick_lower, tick_upper)` (final name in feasibility):

**Preconditions (all required — fail closed):**

- `factory::require_admin`
- `range_state.total_short_liquidity == 0`
- `range_state.total_long_liquidity == 0`
- `range_state.receivable == 0`
- `range_vault.amount == range_state.premium_pool` (with `dust` still 0 as shipped — assert identity; do not invent mid-life `dust` writes unless Phase 0 proves a safe split **without** O(n) poke)

**Actions:**

- Transfer **entire** `premium_pool` USDC from `range_vault` → **destination** (Q3a)
- Zero books; close `range_vault` + `RangePremiumState` (rent to admin/closer as documented)
- Emit `RangeUnwound { market, admin, tick_lower, tick_upper, amount_usdc }` (fields finalize in Phase 0; additive)

**Q3a — Destination (pick one; document; no APY):**

| Option | When to choose |
|---|---|
| **A (default):** admin-signed USDC token account (ATA of admin or explicit recipient account constrained to admin authority) | Lowest blast radius; no new PDA |
| **B:** `ProtocolFeeVault` PDA (`["protocol_fee", market]`) init_if_needed | Cleaner long-term accounting; more surface — only if A is unacceptable |

**Forbidden in unwind:** touching `Market.vault_a/b` user collateral; forgiving `premium_receivable`; closing ranges with open inventory; permissionless drain; inventing protocol skim mid-life.

**Tests (minimum):** empty range with residue → success + conservation; non-empty short/long/receivable → error; non-admin → `Unauthorized`; double unwind → account gone / error.

**If Phase 0 cannot lock destination + preconditions without policy invention:** mark **DEFER**, file `docs/audits/P1-DEFER-RANGE-UNWIND.md` (or section in feasibility), and continue with multisig + monitoring only. ROADMAP exit then becomes **GO WITH BLOCKERS** until unwind ships — say so honestly.

## Q4 — Monitoring (lean)

**IN:**

1. Script e.g. `scripts/monitor-health.mjs` (or extend `reconcile.mjs` with a `--monitor` mode) that prints:
   - `GlobalConfig.admin`, allowlisted whirlpool
   - `Market.is_paused`, risk params
   - reconcile identities for every range (`pool+dust`, receivable)
   - coarse inventory: ranges with non-zero short/long liquidity
2. Optional: fetch recent program signatures and decode `MarketPauseSet` / `MarketPauseCleared` / `AdminTransferred` via the same patterns as `apps/web/src/lib/events.ts` / `tests/events.ts` — **best-effort**, not a DB
3. Checklist section in `RUNBOOK-DEVNET.md`: pause drill, admin key check, reconcile OK, what to do if conservation breaks (halt risk-increasing via pause — already exists)

**OUT:** Prometheus, Grafana, PagerDuty, websockets product, P2 history APIs.

## Q5 — Commission

Default: **DEFER**. Write `docs/audits/P1-DEFER-COMMISSION.md` (short): Fair continuity does not need opening commission; PRD B18 remains complete-product; no bps invented; revisit when product asks for continuity or V1 parity matrix forces it with an ADR.

Only flip to IN if Phase 0 cites a **concrete** broken demo path without it (there is none on Fair gate). Still no APY marketing copy.

## Q6 — Layout / migration / localnet

- Prefer **zero** account layout changes
- `transfer_admin` writes existing `admin` bytes
- Unwind closes PDAs — does not resize `Market` / `GlobalConfig`
- Localnet redeploy OK; warn existing PDAs keep prior admin until `transfer_admin`
- Do **not** brick localnet by requiring Squads for tests

## Q7 — IDL / clients

After build: regenerate IDL; sync `apps/web` IDL/types as prior components. No hand-edited discriminators. Update `pause-market` script family for `transfer-admin` (+ unwind if shipped).

End Phase 0 with **GO** only when Q1–Q5 decisions are written and unwind is either designed or explicitly deferred.

---

# PHASE 1 — IMPLEMENT (ordered slices — maximize value, minimize blast radius)

Execute **in order**. Do not start slice N+1 until slice N tests/docs for that slice are done. Stop early only on Phase 0 NO-GO.

## Slice 1 — Monitoring + runbook (no risky fund movement)

1. `scripts/monitor-health.mjs` (or reconcile `--monitor`)
2. `RUNBOOK-DEVNET.md`: Emergency Pause (existing) + **Admin custody / multisig transfer drill** stub + **Monitoring checklist**
3. Yarn script wiring if repo pattern warrants (`package.json` / `apps/web/package.json`)
4. Honesty banner retained

## Slice 2 — `transfer_admin` + multisig ops path

1. On-chain ix + event + error if needed (append enum **end** only)
2. Tests in `tests/admin-transfer.ts` (or extend `pause-admin.ts` carefully without weakening Exit Guaranteed coverage)
3. Script: `transfer-admin <pubkey>`
4. Docs: `INSTRUCTIONS.md`, `10-pause-admin.md` (multisig checkbox → ops path), `SECURITY-BASELINE.md` one-liner, EVENT-CATALOG additive row
5. Runbook: Squads (external) steps + localnet stand-in procedure

## Slice 3 — `unwind_empty_range` (only if Q3 GO)

1. Instruction + accounts (admin, market, market_authority, range_state, range_vault, destination USDC ATA, token_program, system/rent as needed)
2. Fail-closed preconditions; no user-collateral paths
3. Event `RangeUnwound`
4. `tests/range-unwind.ts` ironclad cases
5. Doc updates: `08-burn-settle.md` Done bits, `INSTRUCTIONS.md` §5, EVENT-CATALOG, ADR-0002 honesty note (“now implemented for empty ranges”)
6. Reconcile script still green on ledgers after unwind

## Slice 4 — Commission ticket (always, unless Q5 flipped IN)

File the defer ticket. Do not implement commission.

## Slice 5 — Report + gate

1. `docs/audits/IMPL-P1-PRODUCTION-HARDENING-REPORT.md`
2. Run full gate: `yarn test:unit` (66+) + RELEASE-GATE §4.2 **102+** both orders on fresh ledger + prior suites still listed
3. `cd apps/web && yarn test && yarn check-copy` (and typecheck if that is the project norm)
4. Surgical updates only to living specs touched above; do not rewrite historical IMPL-0* bodies (one-line pointer OK)

## STOP

Do not start P2/P3/P4/P5/P6. Do not redesign UI. Do not “clean up” unrelated modules. Do not reopen Fair components except bugfix required to keep gate green.

---

# Hard constraints (breakage blacklist)

1. **Do not** change premium formulas, scales, payable/claimable helpers, or live-range vault conservation identity.
2. **Do not** change Orca CPI account metas / order for short mint/burn or `adapter_*`.
3. **Do not** weaken ADR-0003: withdraw remaining-accounts open-longs rule, insolvent mint/withdraw errors, margin ceil / `validate_risk_params`.
4. **Do not** reopen Exit Guaranteed: burn/settle/withdraw/unlock stay allowed under pause; mint/deposit/lock + risk-increasing adapter stay blocked.
5. **Do not** rename/reorder/remove Fair events; additive only.
6. **Do not** resize `GlobalConfig` / `Market` / position / collateral layouts; no `pause_global`.
7. **Do not** add allowlist setter or premium-rate / multiplier setters.
8. **Do not** add admin withdraw of user `vault_a` / `vault_b` free or locked balances.
9. **Do not** invent commission bps, APY, TVL tiles, or fake depth.
10. **Do not** embed Squads/Serum/whatever multisig program CPI as a hard dependency of pause.
11. **Do not** drive-by format the whole repo; touch only files you need.
12. **Do not** change program id, allowlisted whirlpool, or tick_spacing assumptions.
13. **Do not** delete or skip prior tests to go green.
14. **Do not** build P2 `indexer/` product stack.

# Suites that must stay green

Verify script names on disk, then run at least:

```bash
yarn test:unit
# → cargo test -p perma --lib   (66 must remain; P1 may add)

# RELEASE-GATE §4.2 — 102 both orders on a fresh ledger (plus new P1 cases):
# tests/adapter.ts
# tests/adapter-liquidity.ts
# tests/factory.ts
# tests/factory-rewards.ts
# tests/collateral.ts
# tests/position-short.ts
# tests/position-long.ts
# tests/settle-premium.ts
# tests/risk-solvency.ts
# tests/pause-admin.ts
# tests/events.ts
# + new P1 tests (admin-transfer / range-unwind as applicable)

cd apps/web && yarn test && yarn check-copy
node scripts/reconcile.mjs
# + new monitor script once added
```

If validator flakes, restart once and re-run — do not disable assertions.

# Done when

- [ ] `docs/audits/IMPL-P1-FEASIBILITY.md` filed with Q-matrix + GO / GO WITH BLOCKERS
- [ ] Monitoring script + RUNBOOK monitoring checklist live
- [ ] `transfer_admin` shipped; admin-only; Unauthorized covered; localnet transfer drill green
- [ ] Multisig/Squads **ops runbook** written (external Squads; localnet stand-in tested) — not vaporware CPI
- [ ] Unwind shipped **or** explicit defer ticket with reason (honesty)
- [ ] Commission defer ticket filed (default) **or** ADR-parameterized implementation if Q5 somehow IN (no invented APY)
- [ ] Additive events catalogued; IDL synced; INSTRUCTIONS / EVENT-CATALOG / 10-pause-admin / RUNBOOK updated surgically
- [ ] New P1 tests green; **102+ and unit 66+ green**; no prior suite gutted
- [ ] `docs/audits/IMPL-P1-PRODUCTION-HARDENING-REPORT.md` written with residuals
- [ ] P2–P6 not started; Fair event names and Exit Guaranteed untouched
- [ ] Honesty banner still true

# Start now

Phase 0 inventory + Q-matrix first. Then Slice 1 (monitoring) → Slice 2 (`transfer_admin`) → Slice 3 (unwind iff GO) → defer tickets → report. **Do not** break the working Fair Trade loop while unpaused. **Do not** trap users under pause.

END PROMPT
````

## One-liner

```text
Repo is PERMA Fair-closed (01–11, gate GREEN 102/102 + unit 66, tip f6a6a22). Implement Protocol V1 P1 Production Hardening only: Phase 0 first — inventory admin/dust/events/commission; publish Q-matrix. Ship lean monitoring hooks on EVENT-CATALOG + reconcile; ship transfer_admin (in-place GlobalConfig.admin write) + Squads/ops runbook + localnet authority-transfer drill (no Squads CPI inside PERMA); ship admin-only unwind_empty_range for empty ranges per ADR-0002 OR defer with ticket if unsafe; DEFER commission with ticket (no invented bps/APY). Do NOT touch P2 indexer, P3 oracle, P4 liq, P5 multi-leg, P6 Raydium, Fair event names, Exit Guaranteed matrix, premium math, Orca metas, or ADR-0003 formulas. Keep yarn test:unit + 102 release gate + web tests green. Write IMPL-P1-FEASIBILITY.md + IMPL-P1-PRODUCTION-HARDENING-REPORT.md.
```

## Design note for the human

P1’s failure modes are (1) claiming “multisig” while still hard-wiring a single EOA with no transfer path, (2) inventing an orphan-Orca or commission feature Fair does not need, and (3) an unwind that can drain non-empty ranges or user collateral. This prompt forces an ops-real admin handoff, lean monitoring first, and fail-closed empty-range residue cleanup — or an honest defer — without reopening Fair.
