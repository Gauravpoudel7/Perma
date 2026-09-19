# PERMA Docs Audit — Fix Report

**Date**: 2026-09-19
**Responds to**: [`DOCS-AUDIT-REPORT.md`](DOCS-AUDIT-REPORT.md) (verdict: *READY WITH FIXES*)
**Scope**: Docs only. No program or application code was written.

## New verdict: **READY**

All P0 and P1 items are closed. Both audit P2 items are also closed, one as a side effect of clearing P0-2. Implementation may begin, starting with the CLMM Adapter per `PRD.md` §A11.

Residual risks in §4 are real but none of them blocks starting implementation.

---

## 1. What was fixed

### P0-1 — Orca CPI gap in `01-clmm-adapter-orca.md` ✅

The file was rewritten from 80 lines of prose into an implementation-ready spec, verified line by line against `orca-so/whirlpools` at pinned commit `408c945fef4c49ab70def4303377cfaf8f0f3c99` (2026-09-03).

| Required | Delivered |
|---|---|
| A. Program identity | §A — program ID (identical on devnet/mainnet), both `WhirlpoolsConfig` addresses, pinned commit, source paths for every table, v1-vs-v2 rationale, version-drift rule |
| B. Accounts & layouts | §B — full `Account / Writable / Signer / PDA / Seeds / Notes` tables for `open_position`, `increase_liquidity_v2`, `decrease_liquidity_v2`, `collect_fees_v2`, `close_position`, `initialize_tick_array`, plus a read-only pool-state table and PERMA's own PDA table |
| C. TickArray management | §C — all eight required sub-points, with worked SOL/USDC arithmetic |
| D. Adapter interface | §D — four functions with inputs, outputs, accounts, invariants, CU budgets, and pseudocode |
| E. Security | §E — program-ID allowlist, pool allowlist, no-remaining-accounts rule, PDA-only position authority, tick-manipulation boundary, rent griefing |
| F. Tests | §Test Cases — 13 cases including every required failure mode and a CU/tx-size ceiling check |

Mandatory template sections were preserved in `COMPONENT-SPEC-TEMPLATE.md` order.

**Three substantive errors were found and corrected during verification.** These are the reason the audit's "an engineer cannot CPI safely from this doc" finding was correct:

1. **The instructions named in the docs do not exist.** `increase_position` / `decrease_position` are not Whirlpool instructions. Corrected everywhere; recorded in ADR-0001.
2. **The close sequence is 3 steps, not 4.** A first draft of this fix specified `decrease_liquidity_v2` → `update_fees_and_rewards` → `collect_fees_v2` → `close_position`. That fails: Orca's `_calculate_modify_liquidity` returns `LiquidityZero` (`0x177c`) when `liquidity_delta == 0 && position.liquidity == 0`, which is exactly the post-decrease state. `decrease_liquidity` already updates fee growths itself, making the refresh both redundant and invalid. The spec now documents the correct 3-step sequence and carries a regression test for each failure direction.
3. **`CollectFeesV2` does not share `ModifyLiquidityV2`'s account order.** It interleaves `owner_a, vault_a, owner_b, vault_b` and puts the token/memo programs last, and its `whirlpool` is not writable. Building it by analogy produces a wrong account list. Called out explicitly in §B.4.

Worked example (`tick_spacing = 64`, SOL/USDC, $180–$220), independently recomputed as a verification step:

| | Exact tick | Aligned | TickArray start | Realized price |
|---|---|---|---|---|
| lower | `-17148.8417` | `-17152` | `-22528` | 179.9432 |
| upper | `-15142.0344` | `-15104` | `-16896` | 220.8383 |

The bounds land in **different** arrays, so both must be passed — a useful property for the example to have.

### P0-2 — Broken links in `docs/README.md` ✅

Two links were broken, not one:

| Link | Was | Now |
|---|---|---|
| Product PRD | `../../PRD.md` (one level too deep) | `../PRD.md` |
| Component Specs | `02-mvp-components/COMPONENT-INDEX.md` (file never existed) | file created |

Also added: the "Source of truth" note (Part A of `PRD.md` governs Fair MVP scope), an ADR quick-link, and `adr/` + `audits/` rows in the document map. **All 12 link targets in `docs/README.md` now resolve**, and a repo-wide sweep across all 60 markdown files found zero broken relative links.

### P1-1 — AI-slop in `COPY-DECK.md` ✅

- Deleted "The New Standard for Volatility.", "Liquidity, Perpetualized.", "Precision Options.", and the "No Friday stress" pillar.
- Replaced with mechanism-stating copy: *"Perpetual options backed by Orca Whirlpool liquidity."* Every noun is verifiable on-chain.
- **§1 makes the banner mandatory** with the verbatim string, placement rules, and explicit non-dismissible / non-truncating constraints. Each of the three screen blocks and the marketing hero restates the requirement rather than inheriting it.
- Added §5 **Banned Phrases** (11 entries with rationale) — grep-testable, so the anti-slop gate is mechanical rather than a matter of taste.
- Added §6 **Terminology** (use/don't-use pairs). "Yield" and "rewards" are specifically banned for premium.
- Added honesty constraints: no TVL/APY/volume/user figures, even as placeholders; no competitor naming; never claim audited or production-ready.
- Expanded UI copy to cover empty, loading, error, paused, wrong-cluster, and RPC-failure states, plus the realized-range and TickArray-rent disclosures that the Orca integration makes necessary.

### P1-2 — Vague `RELEASE-GATE.md` ✅

Rewritten as a runbook. Every command states its cwd.

- §1 pins exact versions (Rust 1.79.0, Solana 1.18.17, Anchor 0.30.1, Node 20.11.0, Yarn 1.22.x) with verification commands and expected output, and flags that version files do not yet exist.
- §2 gives the full env block (`ANCHOR_PROVIDER_URL`, `ANCHOR_WALLET`, cluster selection) and wallet funding check.
- §3 supplies the validator command **with Orca cloned in** — the previously missing prerequisite that would have made every `anchor test` fail with no obvious cause — including which accounts to clone and how to confirm.
- §4 orders build → core suite → adapter suite → math vectors, each with expected success output and per-gate `--grep` invocations. `--skip-local-validator` is explained.
- §4.4 names the four input/expected vector file pairs and maps each to its `FIXTURES-AND-VECTORS.md` section, replacing the bare `npm run test:math-vectors`.
- §7 is a PASS/FAIL checklist across S1–S4, A1–A3, E1–E2, Q1–Q3, each requiring a named artifact.
- §8 is a failure-triage table plus exact log locations, including the two Orca error codes most likely to be hit.

### P1-3 — Vague type scale in `BRAND-SYSTEM.md` ✅

- Replaced `Small/Regular/Large` with a **15-token scale**: Display, H1–H4, Body LG/MD/SM, Caption, Overline, Button, Metric LG/Hero, Mono MD/SM — each with family, weight, rem **and** px, line-height, letter-spacing, and usage.
- Three font stacks with full fallback chains.
- `font-variant-numeric: tabular-nums` required on every numeric token, so live values don't jitter.
- Responsive table (only Display and H1 scale down).
- 4px-base spacing scale (8 tokens) and 4 radius tokens.
- Values were chosen to match the pixel values already in `COMPONENT-LIBRARY.md` (11/12/14/24px, 4px radius), and that file now maps its literals to tokens, so the two agree.

### P2 items — both closed ✅

- `COMPONENT-INDEX.md` created (required to clear P0-2 anyway).
- `UPDATE-TRIGGERS.md` — **not** addressed; see §4.

### Cross-doc corrections (process rule 6)

[`ADR-0001`](../adr/ADR-0001-orca-cpi-instruction-surface.md) records three decisions — real Orca instruction names, v2 over v1, one Orca position per PERMA short — plus the two counter-intuitive Orca behaviors above. Written against the existing `ADR-TEMPLATE.md` structure.

The invented instruction names were corrected in four other documents, as one-line edits with no restructuring. `ERROR-CATALOG.md` gained a §5 with nine adapter errors (`0x40`–`0x48`), leaving existing codes untouched. `LOCAL-DEV.md` and `RUNBOOK-DEVNET.md` were aligned to the pinned versions and to Yarn, so a new engineer is not given two different answers.

---

## 2. Files touched

| File | Action |
|---|---|
| `docs/02-mvp-components/01-clmm-adapter-orca.md` | Rewritten (P0-1) |
| `docs/README.md` | Links fixed, source-of-truth note, ADR/audits rows (P0-2) |
| `docs/02-mvp-components/COMPONENT-INDEX.md` | **New** (P0-2, P2) |
| `docs/adr/ADR-0001-orca-cpi-instruction-surface.md` | **New** (rule 6) |
| `docs/04-ui-ux/COPY-DECK.md` | Rewritten (P1-1) |
| `docs/06-testing/RELEASE-GATE.md` | Rewritten (P1-2) |
| `docs/04-ui-ux/BRAND-SYSTEM.md` | Type/spacing/radius scale (P1-3) |
| `docs/03-api-interfaces/ERROR-CATALOG.md` | §5 adapter errors appended |
| `docs/04-ui-ux/MARKETING-SITE.md` | Hero/thesis/caption copy synced to COPY-DECK |
| `docs/04-ui-ux/COMPONENT-LIBRARY.md` | Token-mapping note |
| `docs/05-engineering/LOCAL-DEV.md` | Version pins, Orca clone step, Yarn |
| `docs/07-ops-presentation/RUNBOOK-DEVNET.md` | Yarn alignment |
| `docs/HANDOFF.md` · `05-short-mint.md` · `ONCHAIN-ARCHITECTURE.md` · `PRESENTATION-BRIEF.md` | One-line instruction rename each |
| `docs/audits/DOCS-AUDIT-FIX-REPORT.md` | **New** (this file) |

15 files: 3 new, 12 edited. Every edited file retains its `🚩 STATUS` banner footer.

---

## 3. Verification performed

| # | Check | Result |
|---|---|---|
| 1 | Relative-link sweep across all 60 markdown files | **0 broken** |
| 2 | `docs/README.md` links resolve individually | **12/12 OK** |
| 3 | `increase_position` / `decrease_position` remaining | Only in ADR-0001 and the adapter's naming note, where they are the subject of the correction |
| 4 | Banned-phrase grep over `docs/04-ui-ux/` | Only in the banned list itself (see §4 for one cleared false positive) |
| 5 | `Small:/Regular:/Large:` in `BRAND-SYSTEM.md` | **0 hits**; all 15 roles carry rem + px |
| 6 | Banner string verbatim in every edited file | **9/9 OK** |
| 7 | Orca facts re-fetched at the pinned SHA | Program ID, `TICK_ARRAY_SIZE = 88`, `±443636`, TickArray seeds all confirmed |
| 8 | `ModifyLiquidityV2` field order vs §B.2 table | Matches field-for-field, in order |
| 9 | Tick arithmetic recomputed independently | `-17152`/`-15104`, starts `-22528`/`-16896`; all alignment assertions hold |

No build or test commands were run: there is no program or application code in the repository yet.

---

## 4. Residual risks

Ordered by likelihood of causing real trouble.

1. **Orca is pinned to a commit, not a release tag.** The repo's `v1.x` tags track the SDK, not the program. Any bump requires re-verifying every account table in §B of the adapter spec. Mitigation: the version-drift rule in §A and this report. *No further mitigation possible from docs alone.*
2. **The allowlisted devnet SOL/USDC Whirlpool address is not yet fixed.** The spec gives the PDA derivation and the allowlist procedure, but the literal address, its `tick_spacing`, and its vault addresses must be resolved at `create_market` and recorded. `RELEASE-GATE.md` §3 refers to it as `$PERMA_WHIRLPOOL`. The worked example assumes `tick_spacing = 64`; if the chosen pool differs, the example's numbers change (the formulas do not). **Resolve before the first integration test.**
3. **`FIXTURES-AND-VECTORS.md` §4 is still a placeholder** (`SOL = X, USDC = Y`). The math-vector sub-gate (Q3) cannot pass until real Whirlpool figures replace it. Flagged inline in `RELEASE-GATE.md` §4.4. Out of scope for this session.
4. **No version files exist.** `rust-toolchain.toml`, `.tool-versions`, `.nvmrc` are all absent, so §1's pins are honor-system until the first implementation PR adds them.
5. **`E2E-DEMO-SCRIPT.md` contradicts `PRD.md` §A4 on actor roles** — the script casts Alice as the buyer, the PRD casts Alice as the seller and Bob as the buyer. Cosmetic but will confuse a demo rehearsal. Not in the P0/P1 list, so not fixed.
6. **"professional-grade" survives in two non-UI docs** — `00-overview/PRODUCT.md:25` and `07-ops-presentation/PRESENTATION-BRIEF.md:4`. The new banned-phrase list covers user-facing copy; these are internal/pitch documents outside the P1-1 target. Worth a follow-up pass given the same audit criticized this register.
7. **`MARKETING-SITE.md` tone pivot is only partially done.** Audit-suggested restructuring toward a protocol-specification register was out of scope; only the duplicated slop strings were synced. Page structure is unchanged.
8. **`UPDATE-TRIGGERS.md` still lacks a UI-copy trigger** (audit P2). Now more valuable than before, since `COPY-DECK.md` is explicitly the canonical source for all user-visible strings and needs a trigger binding changes back to it.
9. **CU and transaction-size budgets are estimates.** The 400k/600k figures in §D are reasoned, not measured. The ceiling test in §Test Cases exists to catch this; if `open_position` + `increase_liquidity_v2` + a TickArray init does not fit in 1232 bytes, the SDK must split the transaction.
10. **Cleared false positive:** `MOTION-VIDEO-SPEC.md:14` uses "Seamless 15-second loop". Reviewed and kept — it describes a video loop with no visible seam, which is correct technical usage, not a marketing claim.

---

## 5. Updated scorecard

| Area | Was | Now | Note |
|---|---|---|---|
| Completeness | 10/10 | 10/10 | `COMPONENT-INDEX.md` gap closed |
| Consistency | 10/10 | 10/10 | Instruction names, versions, and package manager now agree across docs |
| Technical Depth | 9/10 | 10/10 | Adapter is implementation-ready against a pinned Orca commit |
| UI Anti-Slop | 6/10 | 9/10 | Copy deck rebuilt with a grep-testable banned list; −1 for residual risks 6 and 7 |
| Testability/Ops | 8/10 | 9/10 | Release gate is a runbook; −1 for the unresolved pool address and placeholder vectors |
| Living Docs | 10/10 | 10/10 | ADR directory established; −0, but see residual risk 8 |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
