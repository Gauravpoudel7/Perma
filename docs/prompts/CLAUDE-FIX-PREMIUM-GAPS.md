# PERMA — Claude Code Prompt: Fix Premium + Residual Spec Gaps (New Chat)

**How to use:** Open a **new** Claude Code chat in the PERMA repo root (`Perma/`). Paste everything inside the `PROMPT` block. Repo already has docs at `READY` after the Orca/P0–P1 fix session — do **not** redo that work unless a cross-link is wrong.

Say: **execute this prompt end-to-end; do not ask me to restate the PRD.**

---

````text
PROMPT
=====

# Role

You are staff engineer + protocol designer for **PERMA** (Solana Fair MVP, Colosseum Crypto World's Fair, deadline Oct 12, 2026 PT).

This is a **fresh chat**. Read the repo. Fix the open **premium settlement and residual READY** gaps below. Docs-only. Do **not** implement Anchor/Next.js code. Do **not** expand Fair MVP into Part B (no demand-based premium, no multi-leg, no Raydium, no DAO/token).

# Product lock

- Name: PERMA
- Chain: Solana (devnet primary)
- CLMM: Orca Whirlpool only; one allowlisted SOL/USDC market
- Legs: 1-leg long/short only
- Core loop: deposit → short (add Orca liq) → long (needs short inventory) → streaming premium → burn/settle → solvency gates
- Banner: `Prototype. Not audited. Single pool. Not production mainnet risk capital.`
- Authority: `docs/PRD.md` Part A for scope; this prompt for fix precision
- Panoptic = behavioral reference only; **no BUSL Solidity copy**

# Already DONE (do not reopen unless broken)

Docs audit is **READY**. Orca CPI/TickArray, fake instruction renames, CollectFeesV2 order, close sequence, README links, COPY-DECK, RELEASE-GATE, BRAND type scale were fixed. Leave those alone unless a premium change forces a one-line cross-link update.

# Mission

Close every gap listed under **MUST FIX**. Write `docs/audits/PREMIUM-GAPS-FIX-REPORT.md` with verdict `READY` or honest remaining blockers. Prefer concrete numbers, formulas, tables, and worked examples over adjectives.

# Read first (mandatory)

1. `docs/PRD.md` — Part A only
2. `docs/02-mvp-components/07-premium-engine.md`
3. `docs/02-mvp-components/08-burn-settle.md`
4. `docs/02-mvp-components/04-position-engine-1leg.md`
5. `docs/02-mvp-components/05-short-mint.md`
6. `docs/02-mvp-components/06-long-mint-inventory.md`
7. `docs/02-mvp-components/03-collateral-manager.md`
8. `docs/02-mvp-components/09-risk-solvency.md`
9. `docs/03-api-interfaces/INSTRUCTIONS.md` + `ERROR-CATALOG.md`
10. `docs/06-testing/FIXTURES-AND-VECTORS.md` + `RELEASE-GATE.md`
11. `docs/audits/DOCS-AUDIT-FIX-REPORT.md` § residual risks (if present)
12. `docs/02-mvp-components/02-factory-allowlisted-market.md`

If paths differ, search the repo. Do not invent files.

---

# MUST FIX

## Gap A — Define `MARKET_MULTIPLIER` (and units)

**Problem:** Premium formula uses `MARKET_MULTIPLIER` / “multiplier” but no doc defines the value, type, who sets it, or units.

**Fix in `07-premium-engine.md` (and sync any callers):**

1. Rename for clarity if needed (e.g. keep `MARKET_MULTIPLIER` but define it once) — pick one canonical name and use it everywhere.
2. Specify:
   - Exact type (e.g. u64 fixed-point with N decimals)
   - Default Fair MVP value (a real number, not “TBD”)
   - Where it lives (Market PDA field vs constant vs GlobalPremiumIndex)
   - Who can set/update it (admin only; same authority model as `premium_rate`)
   - Units: how it interacts with `premium_rate`, `size`, and index delta so dimensional analysis works
3. Rewrite the canonical formula with units next to each term.
4. Worked example: open at slot S0, close at S1, given size and rates → exact premium integer after rounding.
5. Rounding rule: already says “in favor of protocol/receiver” — make that precise (which side on ties; floor/ceil per leg).

**Done when:** an engineer can implement `calculate_premium` with no questions about the multiplier.

## Gap B — Long → short premium handoff (including many shorts)

**Problem:** Burn/settle subtracts premium from longs and adds to shorts, and states a zero-sum invariant, but does **not** specify how premium is split when multiple shorts back the same range / one long.

**Fix in `08-burn-settle.md` primarily; cross-update `07-premium-engine.md`, `04-position-engine-1leg.md`, `06-long-mint-inventory.md`, `03-collateral-manager.md` as needed:**

1. Define the **accounting model** for Fair MVP. Choose ONE and document why (ADR if useful):
   - **Recommended for Fair MVP simplicity:** range-scoped **premium pool / escrow** on the Market (or per-range bucket): longs pay into the bucket on settle (or continuous debt), shorts withdraw pro-rata by `liquidity_size` in that range when they burn — OR settle pro-rata at each long burn.
   - Alternative: direct pairwise assignment (usually too heavy for MVP — only pick if you can fully specify it).
2. Whatever you choose must answer:
   - When a **long burns**, where does the premium amount go (which PDA/accounts)?
   - When a **short burns**, how much premium do they receive?
   - If shorts A and B both provide liquidity in the same tick range, and long L pays P, what does A get vs B? (formula: e.g. `P * short_i.size / total_short_size_in_range`)
   - What if a short already closed before the long settles?
   - What if long closes before some shorts?
   - Dust / rounding residue: who gets leftover lamports?
3. Pseudocode for both `burn_options` long path and short path showing **token/collateral movements**, not only “calculate amount.”
4. Invariants table:
   - Zero-sum (or explicit protocol fee skim if any — default **0 protocol skim** for Fair MVP unless PRD says otherwise)
   - Conservation of collateral vault balances
5. Failure cases: insufficient long collateral to pay premium; short owed but bucket empty (should be impossible — prove via invariant or define emergency behavior).
6. Tests: 1 long + 1 short; 1 long + 2 shorts unequal size; long closes first; short closes first; dust rounding.

**Done when:** multi-short premium split is implementable without inventing policy.

## Gap C — `update_index` poke incentive fee

**Problem:** Spec says anyone may call `update_index` “incentivized by a small fee,” but the fee is unspecified.

**Fix in `07-premium-engine.md` + `INSTRUCTIONS.md` + `ERROR-CATALOG.md` + collateral/burn as needed:**

1. Define Fair MVP poke reward precisely:
   - Amount (fixed lamports/USDC units) **or** formula (e.g. % of accrued index increment) — pick one simple rule
   - Paid from where (protocol reserve / market fee vault / first touch on next settle — must be fundable)
   - Paid to the caller’s collateral or wallet
   - Min elapsed slots before poke pays (anti-spam)
   - If mint/burn already update index, do those callers also earn the poke fee? (**Recommend: no** — only permissionless poke earns it)
2. If Fair MVP cannot safely fund a poke fee yet, document **explicit alternative**: poke fee = 0 for Fair MVP; mint/burn/mandatory paths keep index fresh; optional keeper later — and remove “incentivized by a small fee” language so docs are not lying.
3. Either way, delete vague wording. Pick **funded fee** OR **fee = 0 with mandatory mint/burn updates** and write it clearly.

**Done when:** no dangling “small fee” without a number or an explicit zero.

## Gap D — Residual READY risk: allowlisted devnet Whirlpool

**Problem:** Allowlisted SOL/USDC Whirlpool address still unresolved; example assumed `tick_spacing = 64`.

**Fix in `02-factory-allowlisted-market.md` + `01-clmm-adapter-orca.md` (cross-links) + `LOCAL-DEV.md` / `RUNBOOK-DEVNET.md`:**

1. Document the **procedure** to select and freeze the pool (even if address not known yet):
   - How to find a SOL/USDC Whirlpool on devnet
   - Required fields to record: address, tick_spacing, token mint A/B order, vaults, program ID
   - `create_market` must store tick_spacing from the live whirlpool account (do not hardcode 64 blindly)
2. Add a checklist row: `ALLOWLISTED_WHIRLPOOL=unset` → steps to fill `docs/06-testing/FIXTURES-AND-VECTORS.md` and env.
3. Keep formulas spacing-agnostic; mark the $180–$220 worked example as “illustrative for spacing=64.”

**Done when:** an engineer knows exactly how to pick/record the pool; missing address is an ops checkbox, not a silent assumption.

## Gap E — Residual READY risk: fixture placeholders

**Problem:** `FIXTURES-AND-VECTORS.md` still has SOL=X / USDC=Y style placeholders; release-gate Q3 cannot pass.

**Fix:**

1. Replace placeholders with **concrete numeric vectors** for premium + settlement tests (synthetic is OK if labeled “synthetic Fair MVP vectors”).
2. Include: premium_rate, multiplier, slots elapsed, size, expected premium (integer), 1-long-2-short split expected amounts, rounding cases.
3. Point `RELEASE-GATE.md` Q3 at these named vectors.
4. If real whirlpool address still unset, keep address as `TODO_ALLOWLIST_ADDRESS` but **numbers for premium math must be real**.

**Done when:** Q3 has numbers to assert, not X/Y.

---

# Explicit NON-goals (do not “fix” these)

- Do **not** add demand-based / utilization premium for Fair MVP. Flat admin `premium_rate` stays. Optionally add one sentence: “Utilization-reactive premium is Part B.”
- Do not implement programs or the app.
- Do not rewrite Orca CPI sections.
- Do not change product name or banner text.

# Process

1. Read the listed files.
2. Fix Gaps A→E in dependency order (A and C in premium engine; B in burn/settle + collateral; D/E fixtures/market).
3. Add `docs/adr/ADR-0002-premium-accounting.md` (or next free ADR number) summarizing: multiplier definition, handoff model choice, poke fee decision.
4. Sync ERROR-CATALOG + INSTRUCTIONS for any new errors (`InsufficientPremiumBucket`, `PokeTooSoon`, etc. only if real).
5. Write `docs/audits/PREMIUM-GAPS-FIX-REPORT.md`:
   - Checklist A–E
   - Files touched
   - Decisions (handoff model, poke fee vs zero)
   - Residual risks
   - Verdict
6. Console summary for the human: verdict, files changed, remaining blockers.
7. Stop.

# Start now

Confirm paths → patch A–E → ADR → fix report → stop. No protocol implementation.

END PROMPT
````

## Optional one-liner after the prompt

```text
Repo is PERMA. Fresh chat. Docs already READY from Orca audit fixes. Close premium gaps A–E only (multiplier, long→short handoff, poke fee, whirlpool allowlist procedure, fixture numbers). Flat premium_rate stays. Write PREMIUM-GAPS-FIX-REPORT.md. No code implementation.
```
