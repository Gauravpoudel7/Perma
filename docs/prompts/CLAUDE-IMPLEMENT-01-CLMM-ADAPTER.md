# PERMA — Claude Code Prompt: Implement Component 01 Only (Orca CLMM Adapter)

**How to use:** New Claude Code chat in repo root `/Users/maxcell/perma/Perma` (or wherever this clone lives). Paste PROMPT → END PROMPT, then the one-liner.

**Repo reality (verified 2026-09-19):** This clone is currently **docs-only**. There is **no** `Anchor.toml`, `programs/`, or `package.json` yet. `PRD.md` lives at the **repo root**, not `docs/PRD.md`. `PERMA_WHIRLPOOL` is still `TODO_ALLOWLIST_ADDRESS`. You must scaffold AND pass a feasibility gate before deep implementation.

---

````text
PROMPT
=====

# Role

You are a senior Solana / Anchor engineer implementing **PERMA Fair MVP component 01: CLMM Adapter (Orca Whirlpool)**.

Fresh chat. **Do not assume the previous prompt was correct.** Inspect this repo and Orca source yourself. Prove the plan will work **before** writing production adapter code.

# Product lock

- PERMA: perpetual options on Solana from Orca Whirlpool liquidity
- Fair MVP: one allowlisted SOL/USDC Whirlpool, 1-leg only, devnet primary
- Status line: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Scope authority: root `PRD.md` Part A
- CPI authority: `docs/02-mvp-components/01-clmm-adapter-orca.md` + `docs/adr/ADR-0001-orca-cpi-instruction-surface.md`
- No BUSL Panoptic Solidity copy

# Known repo facts (re-verify; do not skip)

1. GitHub remote may be `https://github.com/Gauravpoudel7/Perma.git`
2. Today the tree is documentation-heavy: `docs/`, root `PRD.md`, `README.md`, `CONTRIBUTING.md`, `.github/` — **no on-chain code yet**
3. `PRD.md` is at **repo root** (NOT `docs/PRD.md`)
4. Fixtures still have `TODO_ALLOWLIST_ADDRESS` for the Whirlpool — integration CPI tests need a real pool or an explicit local fixture strategy
5. Adapter Done Definition may still say “4-step” close while ADR-0001 and the test cases correctly require **3-step** (`decrease_liquidity_v2` → `collect_fees_v2` → `close_position`). Trust ADR + test cases; fix the one wrong Done Definition line if still present
6. Toolchain pins are in `docs/06-testing/RELEASE-GATE.md` §1 / `LOCAL-DEV.md` — the machine may not have them installed yet

# Authority docs (read in this order)

1. `PRD.md` (root) Part A
2. `docs/02-mvp-components/01-clmm-adapter-orca.md`
3. `docs/adr/ADR-0001-orca-cpi-instruction-surface.md`
4. `docs/03-api-interfaces/ERROR-CATALOG.md` (adapter errors)
5. `docs/05-engineering/REPO-STRUCTURE.md`, `TECH-STACK.md`, `LOCAL-DEV.md`, `CODING-STANDARDS.md`, `SECURITY-BASELINE.md`
6. `docs/06-testing/RELEASE-GATE.md` §1–3
7. `docs/02-mvp-components/02-factory-allowlisted-market.md` §A (pool selection)
8. `docs/06-testing/FIXTURES-AND-VECTORS.md` §6 (TODO allowlist)

Pinned Orca commit: `408c945fef4c49ab70def4303377cfaf8f0f3c99`
Whirlpool program ID: `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`
Devnet config: `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR`

Pinned tools: Rust `1.79.0`, Solana CLI `1.18.17`, Anchor `0.30.1`, Node `20.11.0`, Yarn `1.22.x`

---

# PHASE 0 — FEASIBILITY GATE (MANDATORY BEFORE IMPLEMENTATION)

You must complete Phase 0 and write findings into
`docs/audits/IMPL-01-FEASIBILITY.md`
**before** implementing the full adapter.

If Phase 0 fails a hard blocker, **stop**, report it clearly, and do not fake progress with mocks that pretend to be Orca CPI.

## 0.1 Repo inspection

- Confirm cwd is the PERMA repo root (directory that will contain `Anchor.toml` after scaffold).
- List what exists vs what `REPO-STRUCTURE.md` expects.
- Confirm `PRD.md` path (root).
- Note uncommitted docs changes; build on current working tree (do not discard premium/ADR fixes).

## 0.2 Toolchain reality check

Run version checks from RELEASE-GATE §1.

For each pin, record: installed version / missing / drift.

If Anchor/Solana/Rust/Yarn are missing OR major/minor drift (e.g. Node 24 vs 20.11):
- Install or pin to the documented versions if you can on this machine
- OR stop with exact install commands for the human
- Do not proceed to full CPI integration on a random toolchain

Add version files in the first implementation PR as RELEASE-GATE already requires: `rust-toolchain.toml`, and Node pin (`.nvmrc` or equivalent).

## 0.3 Orca CPI dependency will it actually build?

The spec says: use the `whirlpool` program crate with `cpi` feature at commit `408c945…`.

You must verify, not assume:

1. Clone or fetch that commit (shallow OK).
2. Locate the exact Cargo package path/name for CPI.
3. Attempt a **minimal** Anchor 0.30.1 program that depends on it with `features = ["cpi"]` (or the real feature name).
4. Record: Does it compile? Anchor version conflicts? `solana-program` version fights? Proc-macro issues?

If the monorepo crate is painful under Anchor 0.30.1, propose **one** alternative that still uses **real** Whirlpool instruction discriminators/account metas from that commit (e.g. checked CPI with hand-built accounts from IDL, or a thin vendored CPI shim). Write the choice + risk in the feasibility doc / ADR addendum. **Do not invent fake instruction names.**

## 0.4 Account tables still match source?

Spot-check against pinned commit (not memory):

- `increase_liquidity_v2` / `ModifyLiquidityV2` account order
- `collect_fees_v2` account order (must differ)
- TickArray PDA seeds = `start_tick_index.to_string()` ASCII
- Negative tick `div_euclid` examples: `-17152 → -22528`, `-15104 → -16896`
- Full close = 3-step only

If docs disagree with source: **source wins**; patch the doc line; note in feasibility report.

## 0.5 Whirlpool allowlist / test strategy

`PERMA_WHIRLPOOL` is TODO. Integration tests need either:

**Path A (preferred):** Follow factory §A, pick a real devnet SOL/USDC Whirlpool with liquidity and no active rewards, record the 7 values, export env vars, replace TODO in fixtures, clone accounts per RELEASE-GATE §3.

**Path B:** If no suitable pool / no network: document blocker; still deliver (1) tick-math unit tests, (2) compiling adapter scaffolding, (3) exact steps for Path A. Do not claim CPI integration green.

State which path you take in the feasibility doc **before** coding Path A integration tests.

## 0.6 Transaction / CU feasibility

From the spec: open + increase_v2 + optional tick array init may be tight on 1232-byte tx / CU limits; full close requests ~600k CU.

In Phase 0, sketch account counts per tx and whether TickArray init must be a separate prior transaction. Record the split plan.

## 0.7 Feasibility verdict

End `IMPL-01-FEASIBILITY.md` with one of:

- `GO` — toolchain OK, CPI dep compiles (or approved shim), pool path chosen, account tables verified
- `GO WITH BLOCKERS` — code can start but CPI integration tests wait on pool/toolchain (list blockers)
- `NO-GO` — cannot honestly implement (say why)

**Only if verdict is GO or GO WITH BLOCKERS, proceed to Phase 1.**  
If NO-GO: stop after the feasibility doc.

Print a short console summary of Phase 0 for the human, then continue only on GO / GO WITH BLOCKERS.

---

# PHASE 1 — IMPLEMENT COMPONENT 01 (only after Phase 0)

## Mission

1. Scaffold Anchor workspace matching `REPO-STRUCTURE.md` (minimal).
2. Implement `adapter.rs` + thinnest Market / `market_authority` / vault state needed for adapter tests.
3. Pass as many **Test Cases** from `01-clmm-adapter-orca.md` as Phase 0 path allows.
4. Write `docs/audits/IMPL-01-CLMM-ADAPTER-REPORT.md`.
5. Stop. No components 02–11, no Next.js, no indexer.

## Scaffold

```text
programs/perma/src/
  lib.rs
  state.rs
  errors.rs
  adapter.rs
Anchor.toml
Cargo.toml / programs/perma/Cargo.toml
tests/   # TS integration where possible
rust-toolchain.toml  # 1.79.0
```

Thin harness instructions that call the adapter are OK if allowlists are enforced.

## Adapter API (exact names)

- `add_liquidity_for_short` → `open_position` (if needed) + `increase_liquidity_v2` (+ `initialize_tick_array` when required, possibly prior tx)
- `remove_liquidity_for_short` → full close = **exactly** `decrease_liquidity_v2` → `collect_fees_v2` → `close_position`  
  Partial = decrease only. **Never** insert `update_fees_and_rewards` between decrease and collect.
- Read helpers from live Whirlpool account; **not for settlement**.

## Hard rules

1. Real Orca names only
2. v2 liquidity + collect
3. TickArray seeds: `[b"tick_array", whirlpool, start_tick_index.to_string()]`
4. Negative ticks: `i32::div_euclid`
5. One Orca position per PERMA short; NFT ATA owned by `market_authority`
6. Program ID + `market.whirlpool` allowlists
7. Empty remaining accounts; `RemainingAccountsInfo = None`
8. Pre-CPI validation + PERMA error mapping
9. CollectFeesV2 order from IDL/struct, not by analogy to modify-liquidity
10. Observed vault deltas; emit events from the spec

## Tests

Implement the checklist in the adapter spec. Regression tests for `0x1775` and `0x177c` are mandatory once CPI works.
Unit tests for negative tick starts are mandatory even on Path B.

## Doc hygiene

Fix Done Definition “4-step” → “3-step” if still wrong. No broad doc rewrites.

# Out of scope

02–11 full logic, UI, indexer, Raydium, demand premium, fake Orca program mocks that skip real CPI when Path A is available.

# Final deliverables

1. `docs/audits/IMPL-01-FEASIBILITY.md` (Phase 0)
2. Working adapter code + tests (as allowed by verdict)
3. `docs/audits/IMPL-01-CLMM-ADAPTER-REPORT.md` (what shipped, test table, pool used, CU notes, residuals)
4. README snippet: how to run adapter tests only
5. Console summary

# Start now

Phase 0 first → write feasibility doc → only then Phase 1 → report → stop.

END PROMPT
````

## One-liner

```text
Repo is PERMA at Gauravpoudel7/Perma. Docs-only today (no Anchor.toml yet). PRD.md is at repo root. Run PHASE 0 feasibility first (toolchain, whirlpool CPI crate vs Anchor 0.30.1, account tables vs commit 408c945, PERMA_WHIRLPOOL strategy) and write docs/audits/IMPL-01-FEASIBILITY.md with GO / GO WITH BLOCKERS / NO-GO. Only then implement component 01. 3-step close. No 02–11, no Next.js.
```
