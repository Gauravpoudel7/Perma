# Docs Sync Audit — before component 09

**Date**: 2026-09-20 · **Scope**: every `docs/**/*.md` (87 files) + root `PRD.md` · **Against**: the live program (`programs/perma/src/`), the eight test suites (66 integration / 54 unit), and the shipped reports `IMPL-01`…`IMPL-08`.

**Why now**: `09-risk-solvency.md` cannot be implemented as written, and the tree around it repeatedly promises things that do not exist — a TWAP, a `calculate_pnl`, a solvency gate, a pause instruction. An implementer who trusted any one of those would write wrong code. This audit was done *before* ADR-0003 and the 09 rewrite so that both are built on what is actually there.

**Ground truth used** (each verified in source, not assumed):
- Live instructions (14): `initialize_global_config`, `create_market`, `validate_short_range`, `deposit_collateral`, `withdraw_collateral`, `lock_collateral`, `unlock_collateral`, `mint_position`, `burn_position`, `settle_premium`, `adapter_open_position`, `adapter_add_liquidity`, `adapter_remove_liquidity`, `adapter_close_position`. **No** `mint_options` / `burn_options` / `pause_market` / `poke_observations` / `liquidate_account`.
- `orca_whirlpools_client` 8.0.0: **zero** occurrences of `observation` or `twap` in the crate. `Oracle { whirlpool, trade_enable_timestamp, adaptive_fee_constants, adaptive_fee_variables { volatility_accumulator, tick_group_index_reference, … } }` — adaptive-fee state, not a price ring. `Whirlpool` exposes spot `sqrt_price` / `tick_current_index` only.
- `errors.rs`: `InsolventWithdrawal` exists. **`InsolventMint`, `OracleDeviationTooHigh`, `CPIFailure`, `IndexOverflow`, `InsufficientCollateral`, `SlippageError` do not.** Anchor emits `6000 + variant index` on chain; the catalog's `0x01…` labels are not what integrators see.
- `risk.rs`: one function, `check_withdraw_allowed` — free balance + legacy `premium_owed_usdc`. It does **not** see accrued premium on open longs. `Market` has no risk fields. Long mint's solvency is `balance_b > 0` → `InsufficientFunds`.
- Short realized PnL is applied by `position::close_short` (`free += returned`, `locked −= spent`). No `risk::calculate_pnl` exists. Long burn: premium in cash, P&L = 0.
- `is_paused` is set `false` in `create_market` and never written again. `burn_position` and `settle_premium` gate on it.
- `dust` is declared and never written. No range unwind or sweep exists.
- Events: `ShortMinted`, `LongMinted`, `ShortBurned`, `LongBurned`, `PremiumSettled`, `PositionOpened`, `PositionClosed`, `LiquidityAdded`, `LiquidityRemoved`, `CollateralDeposited/Withdrawn/Locked/Unlocked`, `MarketCreated`, `GlobalConfigInitialized`, `RangeValidated`.
- `package.json` scripts: `test:adapter`, `test:unit`, `lint`. **No** `test:math-vectors`; **no** `tests/vectors/`, `app/`, `indexer/`, `.github/workflows/`, `docs-check.sh`, `perma-cli`. Vectors V1–V6 are `#[test]`s in `premium.rs`.

## Totals

| Bucket | Count | Rule |
|---|---|---|
| **P0 — false / dangerous** | **11** | fixed in this pass, every one, before ADR-0003 is accepted |
| **P1 — stale / contradictory** | **124** | high-leverage clusters fixed in this pass; the rest listed in §Residual with an owner |
| **P2 — polish** | **82** | fixed only where a one-word edit; otherwise listed |

Historical records — `docs/audits/IMPL-*-{FEASIBILITY,REPORT}.md`, `PREMIUM-GAPS-FIX-REPORT.md`, `DOCS-AUDIT-*.md`, `docs/prompts/*` — are **not rewritten**. Where a shipped report's claim is now superseded, a one-line note is appended and nothing else changes.

---

## P0 — false or dangerous (11)

| # | File:line | Quote | Why it is wrong vs. live | Fix |
|---|---|---|---|---|
| 1 | `02-mvp-components/08-burn-settle.md:168-175` | `let pnl = risk::calculate_pnl(pos, …); credit_usdc(ctx.user_collateral, p as u64)` in **burn_long** | `risk::calculate_pnl` does not exist, and crediting a long its intrinsic value has **no counterparty** — it prints USDC out of the shared collateral vault. "Conservative of spot vs TWAP" is impossible on Orca. | Steps 3–4 → "P&L = 0. Any credit needs a funded counterparty model (Protocol V1, force-exercise). See ADR-0003." |
| 2 | `02-mvp-components/08-burn-settle.md:203-206` | `// 4. P&L. let pnl = risk::calculate_pnl(...)` in **burn_short** | `close_short` **already** realizes `returned − locked`. A second apply double-counts and breaks `vault + Σ in_orca == Σ(free + locked)`. | Delete step 4; state the realization rule inline. |
| 3 | `02-mvp-components/08-burn-settle.md:263` | "This should be unreachable because 09 counts accrued premium as a liability on every solvency check" | Present tense, and false: the live withdraw gate ignores `accrued_scaled` on open longs. **A long can withdraw USDC it will owe, today.** | "Reachable today — this is the gap component 09 closes." |
| 4 | `02-mvp-components/09-risk-solvency.md:74` | "It must use `clmm_adapter.get_observations()`" | No such function; Orca has no observations. Following this fabricates an oracle. | Full rewrite of 09 (this pass). |
| 5 | `01-architecture/THREAT-MODEL.md:19` | "Observation Gates … compare the spot price against a TWAP … derived from the pool's observations" — listed under mitigations *implemented in the MVP* | No TWAP, no gate, no liquidation to protect. | "No price-dependent settlement or liquidation exists in Fair MVP, so the flash-tick vector has no target. Spot is used for range gating only." |
| 6 | `03-api-interfaces/ERROR-CATALOG.md:29` | `0x23 OracleDeviationTooHigh — spot deviates too much from the TWAP` | Not in `errors.rs`; no TWAP. Integrators would map a code that is never raised. | Mark **deferred (Protocol V1) — not raised**. |
| 7 | `03-api-interfaces/INSTRUCTIONS.md:73-76` | `### poke_observations — Force an update of the GlobalPremiumIndex and pool observations` | Instruction does not exist; "pool observations" is a fake-oracle concept in the canonical surface. | Delete. "The index refreshes inside mint / burn / settle; there is no standalone poke." |
| 8 | `03-api-interfaces/INSTRUCTIONS.md:20-22` | `### pause_market / unpause_market` | No pause instruction exists. | Mark **NOT IMPLEMENTED — component 10**. |
| 9 | `02-mvp-components/04-position-engine-1leg.md:18` (also `PRD.md:370`, `THREAT-MODEL.md:9`) | `PDA(["position", market, owner, position_id])` | Live seeds are `["perma_position", market, owner, nonce.to_le_bytes()]`. An integrator derives the wrong address. | Fix all three. |
| 10 | `05-engineering/SECURITY-BASELINE.md:15` | "TWAP Requirement: All solvency checks must use the Orca Whirlpool observation window." | No such window exists. | "Price input is spot only. No TWAP exists in the Orca client; a manipulation-resistant price is a Part B requirement." |
| 11 | `07-ops-presentation/RUNBOOK-DEVNET.md:33-37` | "Emergency Pause … `yarn perma-cli pause-market`" | No pause instruction and no CLI. An operator following this in an incident has nothing. | "No on-chain pause ships in Fair MVP (component 10 unbuilt). Mitigation: none on-chain." |

## P1 — stale or contradictory (124), by cluster

Clusters marked **[fixed]** are edited in this pass. Others carry an owner in §Residual.

**A. "Component 09 already protects you" — 9 sites [fixed]**
`08:113` ("`debit_usdc` is expected to succeed" because premium is counted), `ADR-0002:87` ("the *only* defence"), `03:7` (long mint verifies margin), `03:93-94` (withdraw test expecting `InsolventWithdrawal` on accrued premium — does not exist), `COMPONENT-INDEX:29` ("solvency gates every withdraw and every mint"), `INSTRUCTIONS:35` ("Requires `RiskEngine::is_solvent()`"), `MVP-SCOPE:26` ("Margin-based checks on every mint and withdraw"), `06:47-48,64` (`verify_solvency`; solvency invariant), `SYSTEM-ARCHITECTURE:12`. → each reworded to the live stub + "09 closes this", and 09 itself gets a **Status: NOT IMPLEMENTED** banner until Phase 1 lands.

**B. TWAP / observations elsewhere [fixed where living spec]**
`COMPETITIVE-NOTES:30`, `GLOSSARY:59-60`, `01-clmm-adapter-orca.md:587` (TWAP path + `OracleDeviationTooHigh`), `09:66`, `SECURITY-BASELINE:14`, `RISK-DISCLOSURES:15`, `PRESENTATION-BRIEF:16`, `PRD.md:274-283,491,505,563,583` (Part B assumes a Uniswap-V3 oracle Orca lacks — annotated, not rewritten; it is north-star).

**C. Errors that do not exist [fixed]**
`InsolventMint` at `06:68,77`, `09:71`, `ERROR-CATALOG:28` — **09 adds it in Phase 1**, so these stay and become true. `CPIFailure` (`01:577-579`, `ERROR-CATALOG:37`), `AccountNotInitialized` as a PERMA error (`ERROR-CATALOG:36`), `IndexOverflow` (`07:228-230` → `MathOverflow`), `InsufficientCollateral` / `SlippageError` (`05:46-47,55` → `InsufficientFunds` / `SlippageExceeded`). `ERROR-CATALOG:7-64`: labels are not on-chain codes → on-chain-code column added.

**D. Stale instruction names — `mint_options` / `burn_options` / `mint_short` [fixed]**
`MVP-SCOPE:21`, `01:351,355`, `05:18`, `06:31`, `07:155,245`, `08:155,185`, `09:58,87`, `10:35,55-56`, `ADR-0002:63`, `SECURITY-BASELINE:23`, `TEST-STRATEGY:10`, `RUNBOOK-DEVNET:40`, `HANDOFF:11`, `RELEASE-GATE:255-257`, `PRD.md:92-95,438,440,518-519`. `INSTRUCTIONS.md` wholesale: LONG "not accepted" (`:43`), `burn_options (superseded)` section (`:57-60`), missing `validate_short_range` / `lock_collateral` / `unlock_collateral` / `adapter_*`, wrong account lists for mint / settle / withdraw (`:45,64,33-34`), `amount_sol/usdc` (`:28-29`).

**E. Events that do not exist [fixed in 04, 07, 08, 11; listed for 01]**
`PositionMinted/Burned` (`04:95-96`, `11:38-41,71`, `OFFCHAIN:22`, `METRICS:20`), `PremiumIndexUpdated/Accrued/Paid` (`07:252-254`), `PremiumPaid/Claimed/RangeUnwound` (`08:108,179,210,292-295`), `TickArrayRequired/FeesCollected` (`01:615-616`).

**F. Lying or stale checkboxes [fixed]**
`07:263-264` ("`settle_premium` does not exist yet" — it does; box unticked), `04:100-102` (LONG "rejected with `InvalidLegType`" — LONG shipped in 06), `02:164` (admin setter that does not exist), `TEST-PLAN-MVP:6-22` (unchecked boxes that 66 tests cover), `PRD.md:119-123`.

**G. State that does not exist [fixed]**
`risk_params` (`02:67,17,39`), `Market.available_short_liquidity` (`06:11`, `08:166,196`, `THREAT-MODEL:23`, `TEST-PLAN-MVP:18` — derived on `RangePremiumState`, never stored), `GlobalConfig.is_paused` / `GlobalPause` / `AllowlistedPools: Vec` (`10:36`, `ONCHAIN-ARCHITECTURE:10-11`), `Liquidated` status (`04:23`, `ONCHAIN:30`), `RangeInventory` (`01:532-543`), slippage bps on `Market` (`01:124`), `ONCHAIN-ARCHITECTURE:6-31` omits every 06/08 PDA.

**H. `dust` claimed written or swept [fixed]**
`07:82,84,218`, `08:234`, `ADR-0002:86`, `03:60,79`, `FIXTURES-AND-VECTORS:87,160,164`. Live: declared, never written; residue stays in `premium_pool`; no unwind exists (08 report residual #2).

**I. Non-existent vector runner [fixed]**
`FIXTURES-AND-VECTORS:3,36,52,73,133,143,155,168`, `RELEASE-GATE:189-215,277-279`, `TEST-STRATEGY:25-26` cite `tests/vectors/*.json` + `yarn test:math-vectors`. V1–V6 are `premium.rs` `#[test]`s (`v1_…`–`v6_…`) under `yarn test:unit`.

**J. RELEASE-GATE mechanics [fixed]**
`:138` second `anchor build` drops `--arch v0`; `:172-175` `--grep S1..S4` matches zero tests and pulls in `factory-rewards.ts`; `:229-240` `yarn scripts:*`, `perma-cli`, `app/` absent; `:259` S4 evidence claims a test that does not exist.

**K. Wrong demo range `[$180, $220]` [fixed]**
`E2E-DEMO-SCRIPT:10,15,20`, `RUNBOOK-DEVNET:22`, `RELEASE-GATE:231`. Pool trades ~20 USDC/SOL; demo range is 18–22 (ticks −40176 / −38168).

**L. P&L claimed on burn [fixed]**
`COPY-DECK:57,104`, `E2E-DEMO-SCRIPT:25`, `TEST-PLAN-MVP:22`, `FIXTURES-AND-VECTORS:131-139,162`, `RELEASE-GATE:257`, `SYSTEM-ARCHITECTURE:15`, `COMPONENT-INDEX:16,28`, `04:49`.

**M. Understated shipped state [fixed]**
`DEMO-DAY-SLIDES:45,63,94-95`, `DEMO-DAY-SCRIPT:16,39` (longs + settle "next" — they are live), `HANDOFF:4-12`, `CHANGELOG.md` (one docs entry; nothing for 01–08 or the toolchain re-pin).

**N. LOCAL-DEV.md [fixed]**
`:22-27` 2-clone validator command (every liquidity test fails); `:30` `anchor test` includes the rewards suite; `:33` `PERMA_WHIRLPOOL` env var nothing reads; `:35-55` `app/` / `indexer/` steps.

**O. Pause semantics (component 10 spec) [listed]**
`10:7,44` say burn stays available while paused; live `burn_position` and `settle_premium` gate on `!is_paused`. A spec decision for 10 — noted in the doc, not resolved here.

**P. Miscellaneous P1 [fixed]**
`08:199-201` unlocks by `returned` (would break conservation — live unlocks `locked_*`, credits `returned_*`); `05:37-38` shorts checkpoint `entry_acc_q64`, not `entry_index`; `03:36,39,41,68-71` stale API / pseudocode; `THREAT-MODEL:13,33` (no position-ID hashing; rounding is floor-with-carry, the *opposite* of "favor the protocol"); `07:35` "settable only by the admin" (no setter at all); `02:17,39`; `TECH-STACK:5` (Anchor "v0.29+"); `DOC-GOVERNANCE:20` (`docs-check.sh` in CI); `REPO-STRUCTURE:11,36`; `COPY-DECK:36,38` (pillar violates its own rule); `PRESENTATION-BRIEF:14`; `RISK-DISCLOSURES:21`; `CLIENT-SDK:7,14,52-53` (no SDK; "distance to liquidation").

## P2 — polish (82), listed

Field renames (`liquidity_size` → `liquidity` in `04:22`, `07:59,169,190`, `ADR-0002:58`, `FIXTURES:19`; `usdc_balance` → `balance_b` in `03:52`); event field lists (`02:158`, `03:98-99`, `05:58`); stale sizes in `INSTRUCTIONS:47,54`; toolchain "3.0.0+" vs "4.1.2" between `01:48` and `ADR-0001:97`; un-ticked adapter and 07 test boxes that are green (`01:595-608,623-630`, `07:241-247`); `PRD.md:690-696` repo tree; `CLIENT-SDK` illustrative signatures; `TECH-STACK:7,9-26` (Token-2022, CI, planned app/indexer); `CODING-STANDARDS:4` / `ERROR-CATALOG:3` (`ErrorCode` → `PermaError`); `UPDATE-TRIGGERS:10` (`S-S-S`); `GLOSSARY:6,35,38`; `PRODUCT:21,32`; `SYSTEM-ARCHITECTURE:48-49`; `THREAT-MODEL:29,39`; `01:156,441-448,477-483`; `02:50,112,147,155`; `04:81,86`; `05:26,51`; `06:72`; `07:246`; `08:12,20,256,271,302`; `09:7`; `10:60-61,64`; `11:19,25`; `ONCHAIN:28-29,36,38`; `OFFCHAIN` banner; `METRICS:16`; `DEMO-DAY-SLIDES:50`; `DEMO-DAY-SCRIPT:52`; `E2E-DEMO-SCRIPT:21`; `RELEASE-GATE:257,288`; `TEST-PLAN-MVP` missing suites; `TEST-STRATEGY:25-26`; `MARKETING-SITE:17,25` (inherits COPY-DECK); `ADR-0001:102`; `ADR-0002:229`; `ERROR-CATALOG` missing entries (`PositionsOutstanding`, `InventoryInvariantViolated`, `HarnessPathUnavailable`, `ZeroAmount`, `InvalidAllowlistEntry`, `InvalidWhirlpoolAccount`, `MathOverflow`) and `:10,64` wording.

## Clean (11)

`docs/README.md`, `04-ui-ux/APP-SHELL.md`, `BRAND-SYSTEM.md`, `COMPONENT-LIBRARY.md`, `WIREFRAMES.md`, `UI-QA-CHECKLIST.md`, `MOTION-VIDEO-SPEC.md`, `08-living-docs/CHANGELOG-POLICY.md`, `templates/ADR-TEMPLATE.md`, `templates/COMPONENT-SPEC-TEMPLATE.md`, `templates/PR-CHECKLIST.md`. P2-only: `PRODUCT.md`, `OFFCHAIN-ARCHITECTURE.md`, `ADR-0001`.

## Residual (not fixed in this pass) — owner

| Item | Owner |
|---|---|
| `10-pause-admin.md` burn-while-paused semantics vs live guard set (cluster O) | component 10 |
| `set_market_risk_params` admin setter (referenced by 07:35 / 02:164 as if present) | component 10 |
| `11-events-indexing.md` full live-event catalogue; `01:615-616` events | component 11 |
| `CLIENT-SDK.md`, `COPY-DECK.md` UI copy beyond the false on-chain claims, `MARKETING-SITE.md` | UI / component 12 |
| `PRD.md` Part B oracle sections (`:491,505,563,583`) — annotated "requires an external source on Orca", not rewritten | Part B design |
| `ERROR-CATALOG` missing entries (P2 list) | next integrator-facing pass |
| Historical `IMPL-06` residual #3 and `IMPL-08` residuals #5/#6 | closed by 09 — one-line note appended, reports otherwise untouched |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
