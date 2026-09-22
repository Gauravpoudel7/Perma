# PERMA — Claude Code Prompt: P3 Oracle + Price-Aware Risk (ADR-0004)

**How to use:** New Claude Code chat in the **P2-shipped** repo root (`Perma/`, prefer Mac `/Users/maxcell/perma/Perma`). Paste `PROMPT` → `END PROMPT`, then the one-liner.

**Why this session exists:**  
Fair MVP **01–11 is COMPLETE**. Protocol V1 **P1** shipped (`transfer_admin`, `unwind_empty_range`, `yarn monitor`). **P2** indexer + product UI shipped (release gate **114/114**, indexer tests **20/20**; prefer indexer port **8799** vs Headroom **8787**). Chart polish deferred — product path first.

This session ships **Protocol V1 P3 — Oracle + price-aware risk** under `docs/09-post-mvp/ROADMAP.md` / `ORACLE-AND-RISK-POLICY.md`: produce **ADR-0004 Accepted**, then implement a **fail-closed**, manipulation-resistant **external** (and/or PERMA-owned) price path so solvency/margin can become price-aware **where ADR scopes migration**. This is the **required entry** for P4 force/liquidation — **P4 instructions are forbidden here**. Protocol V1 completes on **devnet through P6**; firm audit/mainnet are **post-V1** (do not block P3 on mainnet).

**Explicitly OUT (blacklist — do not touch):** P4 `force_exercise` / `liquidate_account` (any name) or liquidation-distance UI gauges; inventing liquidation bonuses / force fees; P5 multi-leg; P6 non-Orca/Raydium adapter (Orca-only V1 charter); permissionless factory; treating Whirlpool **Oracle PDA (adaptive fee)** as TWAP; using **Orca spot tick / sqrt alone** as risk or liquidation input; fabricating off-chain “TWAP” / mark PnL charts; silently breaking Fair **premium-horizon** (ADR-0003) without ADR migration scope; renaming/reordering Fair/P1/P2 events; reopening Exit Guaranteed pause matrix; premium math / scales / payable-claimable; Orca CPI metas/account order; drive-by refactors; enterprise observability stacks.

**Honesty banner (repeat in feasibility + report):**  
`Prototype. Not audited. Single pool. Not production mainnet risk capital.`

---

````text
PROMPT
=====

# Role

You are a senior Solana / Anchor protocol engineer implementing **PERMA Protocol V1 — P3 Oracle + Price-Aware Risk (ADR-0004)**.

Fresh chat. Extend the **P2-shipped** program + indexer + UI. **Do not rewrite** the Orca adapter, premium engine, burn/settle cash path, Exit Guaranteed pause matrix (10), Fair/P1/P2 event names, `transfer_admin`, `unwind_empty_range`, or indexer honesty rules. Keep **114/114** release gate + **indexer 20/20** + unit suite green (helpers/additions only — never drop prior coverage).

**Hard sequencing rule:** **No on-chain risk path may consume a price until `docs/adr/ADR-0004-oracle-and-price-aware-risk.md` exists with Status: Accepted.** Phase 0 ends only when ADR-0004 is Accepted (or explicit NO-GO). Code that wires price into solvency is Phase 1+ only.

# Product lock

- Fair MVP closed + P1 + P2 local: one allowlisted WSOL/devUSDC Orca Whirlpool, 1-leg, localnet UI + indexer live
- Banner: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Program id (verify in `Anchor.toml` / `declare_id!`): `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt`
- Stack (on-chain): `anchor-lang` **1.2.0**, `orca_whirlpools_client` **8.0.0** **without** `anchor` feature, **`anchor build --arch v0`**
- Allowlisted pool (do not change): `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (tick_spacing **8**)
- Tip context: Fair tip was `f6a6a22`; P1/P2 are **local** — re-verify `git log -1`, EVENT-CATALOG count, gate **114**, indexer **20/20**, indexer port (**prefer 8799** vs Headroom 8787) on **your** checkout
- Suites that must stay green: **114** integration (RELEASE-GATE §4.2 + P1) + unit + **indexer 20/20** + web/copy; **add** P3 oracle/risk tests

# Authority docs (read in this order before Phase 0)

1. `docs/09-post-mvp/ROADMAP.md` — **P3** entry/exit/forbidden; P4 entry = P3 exit
2. `docs/09-post-mvp/ORACLE-AND-RISK-POLICY.md` — **primary** problem statement + option table (A Pyth / B Switchboard / C PERMA ring / D Orca Oracle PDA REJECTED / E spot-only REJECTED)
3. `docs/09-post-mvp/COMPLETE-PRODUCT-DEFINITION.md` — **Risk** checklist only (price-aware margin / external source; force/liq are P4)
4. `docs/09-post-mvp/GAP-ANALYSIS-FAIR-TO-COMPLETE.md` — oracle + price-aware margin rows; Fair stuck-state honesty
5. `docs/09-post-mvp/LIQUIDATION-AND-FORCE-EXERCISE.md` — **P3 entry for P4 only** — read for coupling constraints; **forbid implementing P4**
6. `docs/09-post-mvp/NON-GOALS.md` — no Orca-Oracle-as-TWAP; no spot-only liq; no invented bonus numbers
7. `docs/adr/ADR-0003-fair-mvp-risk-model.md` — **what must NOT silently change** (premium-horizon; no price; long burn PnL = 0; `OracleDeviationTooHigh` deferred)
8. `docs/adr/ADR-0004-oracle-and-price-aware-risk.md` — **if missing, you MUST write it to Accepted in Phase 0 before any price-consuming risk code**
9. Live Fair solvency: `programs/perma/src/risk.rs`, `docs/02-mvp-components/09-risk-solvency.md`, `tests/risk-solvency.ts`
10. Error honesty: `docs/03-api-interfaces/ERROR-CATALOG.md` (`OracleDeviationTooHigh` deferred); `programs/perma/src/errors.rs`
11. Adapter honesty: `docs/02-mvp-components/01-clmm-adapter-orca.md` (no observations/TWAP); `PRD.md` B5.5 annotation
12. UI honesty: `apps/web` spot display-only (`useSpotPrice`, `MarketHeader` “Spot”); P2 IndexedCharts / INDEXER-AND-PRODUCT-UI — **no fake mark PnL**
13. Security: `docs/05-engineering/SECURITY-BASELINE.md` §Oracle; `docs/07-ops-presentation/RISK-DISCLOSURES.md` §3
14. Gate: `docs/06-testing/RELEASE-GATE.md`, `FIXTURES-AND-VECTORS.md`
15. Prior prompt quality bar: `docs/06-testing/CLAUDE-IMPLEMENT-P2-INDEXER-PRODUCT-UI.md`, `CLAUDE-IMPLEMENT-P1-PRODUCTION-HARDENING.md` (and `docs/prompts/` copies)
16. Inventory targets: absence of ADR-0004; no Pyth deps in `programs/perma/Cargo.toml`; no `observations` / `oracle` module; no `calculate_pnl`; Whirlpool Oracle PDA unused as price

# Repo facts (re-verify on disk; do not invent)

## Research snapshot (drafting agent, 2026-09-21 NPT) — HINTS ONLY

Mac `machineId` `67a1ed8b-11e7-4872-947f-bdff8253ed02` may be unreachable from some executor sandboxes. Snapshot below is from box/GitHub Fair tip **`f6a6a22`** + human context that **P1+P2 are local** (gate **114/114**, indexer **20/20**, prefer port **8799**). **Your Phase 0 inventory on the Mac checkout is authoritative.**

### Already true — DO NOT BREAK

| Fact | Where |
|---|---|
| Fair 01–11 complete; P1 local (`transfer_admin`, `unwind_empty_range`, monitor); P2 indexer+UI local | RELEASE-GATE, human context — **verify on Mac** |
| Gate **114/114** + indexer **20/20** must stay green | RELEASE-GATE; indexer package |
| ADR-0003 solvency: **no price input**; premium-horizon + buffer; spot display/range-gate only | `risk.rs`, ADR-0003, `09-risk-solvency.md` |
| `OracleDeviationTooHigh` **not** in `errors.rs`; ERROR-CATALOG marks deferred | `errors.rs`, ERROR-CATALOG |
| Orca `orca_whirlpools_client` 8.0.0: **no** observation ring / TWAP; Whirlpool **Oracle PDA = adaptive fee** | ADR-0003, ORACLE-AND-RISK-POLICY, audits/DOCS-SYNC-AUDIT-09 |
| UI spot labeled **"Spot"** only; no TWAP framing | `useSpotPrice.ts`, `MarketHeader.tsx` |
| Long burn PnL = 0; no `calculate_pnl` | ADR-0003, burn path |
| No ADR-0004 file on public main (2026-09-21) | `docs/adr/` — expect to create |
| No Pyth/Switchboard crate in program Cargo.toml (Fair tip) | `programs/perma/Cargo.toml` |
| No `poke_observations` ix; INSTRUCTIONS explicitly deleted fake oracle poke | `INSTRUCTIONS.md` |
| Indexer charts honesty: real series only; `/liquidations` empty until P4; no mark % | INDEXER-AND-PRODUCT-UI, P2 prompt DoD |
| Program id / whirlpool / tick_spacing locked as above | Anchor.toml, factory |

### Missing (this phase — P3 ONLY)

1. **`docs/adr/ADR-0004-oracle-and-price-aware-risk.md` Accepted** — feed IDs / ring params, max staleness, spot-vs-reference deviation, conservative price selection, fail-closed reject-vs-pause, **explicit migration map** from ADR-0003 call sites, documented refusal of Orca Oracle PDA as TWAP
2. On-chain **oracle consumer** (Pyth pull and/or PERMA observation ring) with fail-closed staleness/confidence/deviation
3. **Scoped** price-aware risk/margin/PnL changes **only where ADR lists them** — not silent full rewrite of Fair horizon
4. Localnet/devnet **fixtures**: stale feed, wide confidence, spot spike vs reference, ring gap (if C), pause interaction
5. Append-only errors (e.g. `OracleStale`, `OracleDeviationTooHigh`, `OracleConfidenceTooWide` — names per ADR) — **never reorder** existing codes
6. Tests + living-doc surgery + `IMPL-P3-*` feasibility/report
7. UI: honest reference-price / oracle-health display **if** ADR requires; **no** liquidation distance; **no** fake mark PnL charts

## Doc conflicts (resolve in Phase 0; do not silently pick the unsafe / vaporware side)

| Conflict | Safer P3 rule (mandated unless Phase 0 proves otherwise) |
|---|---|
| PRD B5.5 “prefer pool observations/TWAP” vs Orca reality (no observations) | **External or PERMA-owned source required.** Documented refusal of Whirlpool Oracle PDA as TWAP. Spot alone **never** risk input. |
| ADR-0003 “no price” Accepted vs COMPLETE Risk “price-aware margin” | ADR-0004 **explicitly supersedes scoped paths**. Until Accepted, Fair horizon stays. After Accepted, only named call sites change; regression suites prove unscoped paths unchanged. |
| ORACLE options A/B/C vs “just use spot for now” | Spot-only = Option E = **Rejected**. Do not ship interim spot-risk. |
| Desire to “prepare liquidation” vs ROADMAP forbid liq before P3 exit / P4 | **No** `liquidate_*` / `force_*` instructions, accounts, bonuses, or UI distance gauges in P3. Oracle + risk wiring only; P4 consumes them later. |
| Inventing liquidation bonus / force fee / margin % in code | **Forbidden.** Numerics only in ADR-0004 + frozen fixtures. Prefer **named constants in ADR** over magic numbers in `lib.rs`. |
| PERMA ring (C) vs short-mint CU/account headroom (ADR-0003 measured ~76 B) | Phase 0 **must measure**. If ring write on short mint blows headroom, prefer **Pyth-primary (A)** and either (i) permissionless `poke_oracle_ring` separate ix, or (ii) DEFER ring with ticket — do not silently enlarge short mint. |
| Pyth mainnet/devnet feeds vs localnet absence | **Require** localnet strategy: mock pull receiver **or** cloned accounts + controllable fixtures. Tests must mutate stale/confidence/price without mainnet RPC. |
| UI “show PnL” vs ADR-0003 / P2 honesty | **Forbidden** to invent unrealized mark %. If ADR introduces on-chain conservative mark for solvency, UI may show **only** what on-chain/events expose, labeled per ADR — never decorative CEX PnL. |
| GAP/09 README still calling 10/11 Fair leftovers | Stale vs disk. Surgically note Fair+P1+P2 done; do not reopen. |
| ERROR-CATALOG deferred `OracleDeviationTooHigh` vs new errors | **Append** variants at end of `PermaError`; update catalog; never renumber prior codes. |
| Indexer `/liquidations` empty vs wanting liq history | Keep empty until P4; may index **oracle reject / pause** events if you add them (additive). |
| “Pause market on oracle outage” vs Exit Guaranteed burns | Fail-closed per ADR: reject risk-increasing ix and/or pause — **never** block Exit Guaranteed burns under normal pause rules. |

---

# PHASE 0 — FEASIBILITY + ADR-0004 (mandatory before price-consuming code)

Write `docs/audits/IMPL-P3-FEASIBILITY.md` with **GO / GO WITH BLOCKERS / NO-GO**.

**Also write (or refine to Accepted):** `docs/adr/ADR-0004-oracle-and-price-aware-risk.md`.

## Q0 — Live inventory (cite file:line)

Table on **your** Mac checkout:

1. Confirm **absence or draft state** of ADR-0004
2. Every solvency call site: `check_withdraw_allowed`, `check_long_mint_allowed`, `required_free_usdc`, `required_margin*` — prove **no price read** today
3. Every spot/`tick_current_index`/`sqrt_price` read (adapter range gate vs UI display)
4. Confirm Whirlpool Oracle PDA **not** used as price (search `Oracle`, `volatility_accumulator`, observations)
5. `PermaError` last variants + ERROR-CATALOG deferred oracle rows
6. Cargo deps: any pyth/switchboard crates? (expect none)
7. Account sizes / tx byte headroom for short mint, long mint, withdraw (re-measure if touching accounts)
8. P2 indexer port + health; IndexedCharts honesty surfaces; `/liquidations === []`
9. Localnet/devnet pool mapping: which SOL/USD (or WSOL/devUSDC) Pyth feed is plausible; what exists on **your** cluster
10. Any stub `observations` module, `calculate_pnl`, or “TWAP” helper (expect none / comments only)

## Q1 — In-scope vs OUT matrix (implement exactly this)

| Work item | P3 decision |
|---|---|
| Write ADR-0004 to **Accepted** before price-consuming risk code | **IN — hard gate** |
| Choose oracle: **A Pyth** and/or **C PERMA ring** (B Switchboard only if Phase 0 proves better fit) | **IN — Phase 0 pick; document** |
| Documented refusal: Orca Oracle PDA ≠ TWAP; spot-only ≠ risk | **IN** |
| Fail-closed: stale / wide confidence / deviation > limit | **IN** |
| Localnet mock or clone + **fixtures** (stale, deviate, manipulate, pause) | **IN** |
| Migrate **named** ADR-0003 paths to price-aware policy | **IN — only paths ADR lists** |
| Keep unscoped Fair horizon behavior bit-identical + tested | **IN** |
| Append oracle errors; emit additive oracle/pause events if useful | **IN** |
| UI: oracle health / reference price labeled honestly | **IN if ADR needs it**; else minimal |
| P4 `force_exercise` / `liquidate_*` instructions | **OUT** |
| Liquidation bonus / force fee numerics | **OUT** (P4 ADR) |
| Liquidation-distance UI | **OUT** |
| Fake TWAP from spot samples without ADR ring rules | **OUT** |
| Fake chart mark PnL / APY/TVL | **OUT** |
| P5 multi-leg / P6 non-Orca (Raydium) | **OUT** (V1 = Orca-only; more Orca pools are P6 later) |
| Reopen Exit Guaranteed / premium formulas / Orca metas | **OUT** |
| Rename/reorder existing events or error codes | **OUT** |

## Q2 — ADR-0004 required contents (acceptance checklist)

ADR-0004 must include **all** of the following before Status: Accepted:

1. **Decision:** A / B / C / A+C (with rationale vs ORACLE-AND-RISK-POLICY table)
2. **Feed identity:** Pyth feed id(s) for the allowlisted market mapping (WSOL/devUSDC ↔ SOL/USD or explicit pair policy); OR ring PDA seeds + window + poke auth
3. **Max staleness** (slots or seconds) + **confidence** rule
4. **Spot-vs-reference deviation limit** + what “spot” means here (Whirlpool tick/sqrt **comparison only**, never sole risk input)
5. **Conservative price selection** (which side of confidence; min/max of spot vs reference when both present)
6. **Fail-closed behavior:** reject ix vs `pause_market` / halt — map to PRD B30 spirit without silent bad-debt socialization
7. **Migration map from ADR-0003:** table of call sites → `UNCHANGED` / `SUPERSEDED` / `AUGMENTED` with exact new predicate
8. **What is still not shipped:** force exercise, liquidation, long intrinsic credit, multi-leg portfolio margin
9. **Explicit rejection statement:** Whirlpool Oracle PDA is adaptive-fee, not TWAP; will not be used as risk TWAP
10. **Fixture vector IDs** (names + intents) frozen before implementation numbers are hardcoded
11. **Account/CU budget** notes (esp. if choosing C)
12. **Status: Accepted** + date + decider

**Default recommendation if Phase 0 finds no blockers (override only with written reason):**

| Choice | Default |
|---|---|
| Primary source | **A — Pyth pull** (`PriceUpdateV2` / current receiver SDK compatible with anchor 1.2.0 — pin exact crate versions in ADR) |
| Complement | **C — PERMA ring** only if measured headroom OK **or** as separate permissionless poke ix (not on short-mint critical path) |
| Switchboard | Secondary / DEFER unless Pyth localnet path fails Phase 0 |
| Fair horizon | Remain **floor** for long premium debt; price-aware policy **AUGMENTS** solvency for underwater / mark components **only as ADR specifies** — do not delete premium-horizon without replacement that still covers premium runaway |
| P4 | Interfaces may be sketched in ADR “Forward” section only — **no code** |

## Q3 — Migration semantics (must be testable)

Write an explicit table in ADR + feasibility, for example:

| Path | ADR-0003 today | P3 after ADR |
|---|---|---|
| `withdraw_collateral` | premium-horizon free USDC gate | per ADR (likely: still require premium liability coverage; plus price-aware checks if ADR says so) |
| `mint_position(LONG)` | InsolventMint via horizon | per ADR |
| `mint_position(SHORT)` / lock | unchanged | unchanged unless ADR says otherwise |
| Long burn PnL | 0 | **remain 0** in P3 (intrinsic needs P4 counterparty) |
| Short burn LP | `returned − locked` once | unchanged |
| Liquidation / force | absent | **still absent** |
| UI spot | display-only | display-only **or** show reference beside Spot with labels — never “TWAP (Orca)” |

Every `SUPERSEDED`/`AUGMENTED` row needs **named tests** proving old Fair vectors still pass where `UNCHANGED`, and new oracle vectors pass/fail as specified.

## Q4 — Fixtures (mandatory names — fill expected amounts only after ADR pins numbers)

| Vector ID | Intent |
|---|---|
| `ORACLE_HEALTHY_OK` | Fresh reference within deviation → risk path accepts (per ADR) |
| `ORACLE_STALE_FAIL` | Stale update → fail closed |
| `ORACLE_CONF_WIDE_FAIL` | Confidence too wide → fail closed |
| `ORACLE_SPOT_SPIKE_FAIL` | Whirlpool spot manipulated vs healthy reference → fail closed / conservative per ADR |
| `ORACLE_DEVIATION_FAIL` | Deviation > limit → `OracleDeviationTooHigh` (or ADR name) |
| `ORACLE_RING_GAP_FAIL` | If C: insufficient ring samples / gap → fail closed |
| `ORACLE_PAUSE_INTERACTION` | Oracle outage + pause policy per ADR; burns still Exit Guaranteed |
| `ORACLE_FAIR_HORIZON_REGRESSION` | Unscoped ADR-0003 vectors still green |
| `ORACLE_NO_ORCA_PDA_TWAP` | Static/doc+code assertion: adaptive-fee Oracle account never read as TWAP |

## Q5 — Localnet / devnet oracle strategy

Phase 0 must pick and document **one** primary localnet approach:

1. **Mock Pyth pull program** owning price-update accounts with test setters (stale/price/conf), **or**
2. **Cloned** receiver/price accounts from devnet/mainnet **plus** a writable mock path for negative fixtures, **or**
3. **PERMA ring-only** localnet if A is deferred (must still refuse Orca PDA TWAP)

Re-verify what exists for **this** pool on Solana localnet/devnet. Do not assume a feed account is present.

## Q6 — Tests & gate

**On-chain / TS integration (add):**
- Fixture table above
- CU/account smoke for any new accounts on mint/withdraw
- Regression: existing `tests/risk-solvency.ts` behaviors for `UNCHANGED` paths

**Keep green:**
- `yarn test:unit` / `cargo test -p perma --lib`
- RELEASE-GATE **114/114** both orders on fresh ledger
- Indexer **20/20** (and any P2 web tests)
- `cd apps/web && yarn test && yarn check-copy`
- `node scripts/reconcile.mjs` / `yarn monitor` still run

**Do not** delete or skip prior tests to go green.

## Q7 — Docs / IDL

- `ADR-0004` Accepted
- Update `ORACLE-AND-RISK-POLICY.md` pointer: Proposed → **Accepted ADR**
- Update `ERROR-CATALOG.md`, `INSTRUCTIONS.md` (new ix only if ADR needs poke/config), `09-risk-solvency.md` status honesty
- Update `SECURITY-BASELINE.md` §Oracle, `RISK-DISCLOSURES.md` §3
- Update `RELEASE-GATE.md` / `FIXTURES-AND-VECTORS.md` surgically
- `docs/audits/IMPL-P3-FEASIBILITY.md` + `IMPL-P3-ORACLE-RISK-REPORT.md`
- Do **not** rewrite historical IMPL-09/P1/P2 bodies (one-line pointer OK)
- IDL regen if instructions/accounts change

End Phase 0 with **GO** only when ADR-0004 is **Accepted** and fixtures IDs + localnet strategy are written.

---

# PHASE 1 — IMPLEMENT (ordered slices — maximize safety, minimize blast radius)

Execute **in order**. Do not start slice N+1 until slice N tests/docs for that slice are done. **Stop** if Phase 0 is NO-GO. **Do not** implement P4.

## Slice 0 — ADR-0004 Accepted (docs only)

1. Author ADR-0004 to Status: Accepted with full Q2 checklist
2. Freeze fixture IDs + tentative numeric policy
3. Feasibility GO / GO WITH BLOCKERS

## Slice 1 — Oracle module + localnet harness (no silent solvency change yet)

1. Add oracle module / accounts / CPI reads per ADR (Pyth and/or ring)
2. Localnet mock/clone + helpers to set price/staleness/confidence
3. Unit tests for parse + fail-closed helpers in isolation
4. Optional: permissionless `poke_oracle_ring` **only if** ADR chooses C

## Slice 2 — Wire price into **ADR-scoped** risk paths only

1. Implement migration map rows marked SUPERSEDED/AUGMENTED
2. Append errors; emit additive events if ADR requires
3. Prove `ORACLE_FAIR_HORIZON_REGRESSION` + new fail-closed vectors
4. Measure CU/tx size; fix without breaking short mint if possible

## Slice 3 — UI / indexer honesty (minimal)

1. If showing a reference price: label per ADR (**not** “Orca TWAP”)
2. Oracle degraded/stale empty states — never fake series
3. Keep `/liquidations` empty; **no** liquidation distance gauge
4. Keep RPC cross-check before risk-increasing actions
5. Prefer indexer port **8799** (document if changed)

## Slice 4 — QA + gate + report

1. Full gate: unit + **114** both orders + indexer **20/20** + web/copy + new P3 tests
2. `IMPL-P3-ORACLE-RISK-REPORT.md` with residuals (Switchboard?, ring density?, P4 readiness checklist without P4 code)
3. Surgical living-doc updates

## STOP

Do not start P4/P5/P6. Do not add force/liq instructions or bonuses. Do not treat Orca Oracle PDA as TWAP. Do not use spot alone for risk. Do not invent mark PnL charts. Do not silently replace ADR-0003 without migration tests. Do not “clean up” unrelated modules.

---

# Hard constraints (breakage blacklist)

1. **Do not** write price-consuming risk code before ADR-0004 Status: Accepted.
2. **Do not** implement `force_exercise`, `liquidate_account`, or any P4 actor path.
3. **Do not** invent liquidation bonus / force-fee percentages.
4. **Do not** use Whirlpool Oracle PDA (adaptive fee) as TWAP/reference.
5. **Do not** liquidate or size risk using **only** Orca spot tick/sqrt.
6. **Do not** fabricate off-chain TWAP or unrealized mark PnL charts.
7. **Do not** silently delete premium-horizon coverage of premium runaway.
8. **Do not** break Exit Guaranteed burn-under-pause.
9. **Do not** rename/reorder/remove Fair/P1/P2 events or renumber existing errors.
10. **Do not** change program id, allowlisted whirlpool, or tick_spacing.
11. **Do not** change premium formulas / Orca CPI metas / account order except ADR-required oracle accounts.
12. **Do not** delete or skip prior tests to go green.
13. **Do not** drive-by format the whole repo.
14. **Do not** require mainnet Pyth RPC to pass local DoD — localnet fixtures mandatory.
15. **Do not** show liquidation distance UI.

# Suites that must stay green

Verify script names on disk, then run at least:

```bash
yarn test:unit
# cargo test -p perma --lib

# RELEASE-GATE §4.2 — 114 both orders on a fresh ledger:
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
# + P1 tests (admin-transfer / range-unwind) — confirm filenames on disk
# + new P3 oracle/risk tests

# Indexer (P2):
# yarn workspace indexer test   OR   cd indexer && yarn test   # expect 20/20
# prefer INDEXER_PORT=8799 (or project default) — document vs Headroom 8787

cd apps/web && yarn test && yarn check-copy
node scripts/reconcile.mjs
# yarn monitor
```

If validator flakes, restart once and re-run — do not disable assertions.

# Done when

- [ ] `docs/adr/ADR-0004-oracle-and-price-aware-risk.md` exists with **Status: Accepted** and full Q2 checklist
- [ ] `docs/audits/IMPL-P3-FEASIBILITY.md` filed with Q-matrix, oracle choice, migration map, localnet strategy, GO / GO WITH BLOCKERS
- [ ] Oracle consumer live per ADR (Pyth and/or PERMA ring) with fail-closed staleness/deviation/confidence
- [ ] Documented refusal of Orca Oracle PDA as TWAP (ADR + code assertions / comments)
- [ ] ADR-0003 paths migrated **only** as scoped; Fair horizon regressions green where UNCHANGED
- [ ] Fixtures: stale / deviate / spot-spike / conf-wide / pause (+ ring gap if C) green
- [ ] **No** P4 force/liq instructions, bonuses, or liquidation-distance UI
- [ ] **No** fake mark PnL / fake TWAP charts
- [ ] **114 + unit + indexer 20/20 + web/copy** green; P3 tests added
- [ ] Living docs + ERROR-CATALOG/INSTRUCTIONS/SECURITY/RISK-DISCLOSURES updated surgically
- [ ] `IMPL-P3-ORACLE-RISK-REPORT.md` written with residuals / P4 entry checklist (docs only)
- [ ] Honesty banner still true

# Start now

**Phase 0 first:** live inventory (Q0) → draft ADR-0004 to **Accepted** (Q2) → migration map (Q3) → fixture IDs + localnet strategy (Q4–Q5) → feasibility GO. Only then Slice 1 (oracle harness) → Slice 2 (scoped risk wire-up) → Slice 3 (honest UI) → Slice 4 (gate+report). **Prefer fail-closed over available-but-wrong. Prefer ADR silence over invented liquidation economics. Prefer hidden PnL over lying PnL.**

END PROMPT
````

## One-liner

```text
Repo is PERMA Fair-closed + P1 + P2 local (01–11 + transfer_admin/unwind_empty_range/monitor + indexer/UI; gate 114/114; indexer 20/20; prefer port 8799). Implement Protocol V1 P3 Oracle + price-aware risk ONLY: Phase 0 FIRST — inventory risk.rs (no price today), confirm no ADR-0004, measure CU headroom; WRITE docs/adr/ADR-0004-oracle-and-price-aware-risk.md to Status Accepted (Pyth and/or PERMA ring; max staleness; deviation; conservative price; fail-closed; explicit ADR-0003 migration map; documented refusal of Orca Oracle PDA as TWAP) BEFORE any on-chain risk path reads a price. Then ship localnet fixtures (stale/deviate/spot-spike/conf/pause) + scoped solvency migration only where ADR lists; keep Fair premium-horizon regressions for UNCHANGED paths. Do NOT implement P4 force/liq ix, bonuses, or liquidation-distance UI; do NOT use spot alone or Orca adaptive-fee Oracle as TWAP; do NOT invent mark PnL charts; do NOT break Exit Guaranteed, premium math, Orca metas, or event/error order. Keep yarn test:unit + 114 release gate + indexer 20/20 + web/copy green; add P3 tests. Write IMPL-P3-FEASIBILITY.md + IMPL-P3-ORACLE-RISK-REPORT.md.
```

## Design note for the human

P3’s failure modes are (1) coding price into `risk.rs` before ADR-0004 is Accepted, (2) faking a TWAP from Orca’s adaptive-fee Oracle PDA or spot tick, (3) sneaking P4 liquidation/force instructions or bonus numbers “while we’re here,” and (4) replacing Fair premium-horizon so a long can again run from premium debt. This prompt forces ADR-first sequencing, fail-closed fixtures, an explicit migration map from ADR-0003, and a hard P4 blacklist — while freezing the 114 gate and indexer 20/20.
