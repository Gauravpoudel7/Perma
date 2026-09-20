# PERMA Premium Gaps — Fix Report

**Date**: 2026-09-19
**Scope**: Gaps A–E in premium settlement and residual READY items. Docs only — no Anchor or Next.js code.
**Predecessor**: [`DOCS-AUDIT-FIX-REPORT.md`](DOCS-AUDIT-FIX-REPORT.md) (verdict *READY*)

## Verdict: **READY**

All five gaps are closed. The zero-sum premium invariant now has a mechanism behind it, every parameter in the premium formula has a name, type, owner, and numeric default, and all six premium vectors are verified by exact integer arithmetic.

Two design flaws were found and fixed while working the math — §3. Residual risks in §5 are documented and none blocks implementation.

---

## 1. Gap checklist

| Gap | Requirement | Status |
|---|---|---|
| **A** | Canonical name, type, default, owner, units for the multiplier | ✅ `premium_multiplier` |
| **A** | Formula rewritten with units on each term | ✅ `07-premium-engine.md` §B |
| **A** | Worked example S0 → S1 to an exact integer | ✅ §F — `100 000` µUSDC |
| **A** | Rounding precise, ties resolved | ✅ floor+carry; no ties exist (both legs floor) |
| **B** | One accounting model chosen + ADR | ✅ range bucket, pro-rata — [ADR-0002](../adr/ADR-0002-premium-accounting.md) |
| **B** | Where premium goes; per-short amounts; unequal split; short-first; long-first; dust | ✅ `08-burn-settle.md` §F case matrix |
| **B** | Pseudocode with **actual collateral movements** | ✅ §C–§E, four flows with token transfers |
| **B** | Invariants: zero-sum, 0 skim, vault conservation | ✅ §Invariants 1–8 |
| **B** | Failures: long can't pay; short owed but bucket empty | ✅ §G and `receivable` / `PendingPremium` |
| **B** | Tests: 1L+1S, 1L+2S unequal, long first, short first, dust | ✅ V2–V5 + 6 more |
| **C** | Real poke reward **or** explicit zero | ✅ **zero**, with rationale |
| **C** | Vague "small fee" language deleted | ✅ 0 occurrences outside the prompt file |
| **D** | Procedure to find/record the pool (7 values) | ✅ `02-factory-allowlisted-market.md` §A |
| **D** | `create_market` reads `tick_spacing` live | ✅ pseudocode + a test that asserts non-64 |
| **D** | `PERMA_WHIRLPOOL=unset` → fill-in checklist | ✅ §A Step 4, 9 items |
| **D** | Formulas spacing-agnostic; $180–$220 marked illustrative | ✅ adapter §C callout |
| **E** | Concrete numeric vectors with all parameters | ✅ V1–V6, verified |
| **E** | `RELEASE-GATE` Q3 points at them | ✅ §4.4 table + Q3 row |
| **E** | X/Y placeholders gone | ✅ only `TODO_ALLOWLIST_ADDRESS` remains, as permitted |

---

## 2. Decisions taken

| # | Decision | Why |
|---|---|---|
| 1 | **Range-scoped premium bucket**, pro-rata by `liquidity_size` | O(1) state per position; shorts enter/exit without rewriting any long. Pairwise matching needs unbounded per-long match sets. |
| 2 | **Entitlement accrues on elapsed time; payment from realized cash**; `receivable` bridges | The realized-cash-only variant makes a short that exits before any long settles silently forfeit earned premium to whoever remains. Not acceptable. |
| 3 | **Permissionless `settle_premium(long)`** | Gives `PRD.md` §A5's `settle_premium()` a real job. Shorts crank longs in their own range to fund their own claims — the incentive is structural, not paid. |
| 4 | **Floor with sub-unit carry** (not ceil) | Security, not style — see §3. |
| 5 | **USDC-only premium** | One pool balance, one rounding rule, one dust accumulator. A two-asset split needs a price, pulling the oracle into premium math for no benefit. |
| 6 | **Poke reward = 0** | The only funding source is `premium_pool`, i.e. money already owed to shorts. Also unnecessary: the index is a pure function of slot count, so a late poke catches up exactly. |
| 7 | `premium_rate` **and** `premium_multiplier` kept separate | Different reasons to change — rate is clock speed, multiplier is price conversion tied to what a liquidity unit is worth in the pool. |

### Parameters now fixed

| Name | Type | Default | Where | Set by |
|---|---|---|---|---|
| `PREMIUM_SCALE` | `u128` const | `1_000_000_000_000` | program constant | compile-time |
| `premium_rate` | `u64` | `1_000_000` | `Market` PDA | admin only |
| `premium_multiplier` | `u64` | `1_000` | `Market` PDA | admin only |

Both defaults are **tuned for demo visibility, not derived from a pricing model** — stated as such in the spec and ADR.

---

## 3. Two flaws found while working the math

### 3.1 Permissionless crank + round-up = a griefing vector

The obvious rounding policy — "round up, debtor pays the extra unit" — is unsafe once `settle_premium` is permissionless. At `L = 1500` the true cost is 1.5 µUSDC/slot, so 100 slots honestly cost **150**:

| Policy | 100 single-slot settles | Error |
|---|---|---|
| **floor + carry** (adopted) | **150** | exact |
| ceil per settle | **200** | **+33%, attacker-chosen** |
| floor per settle, no carry | **100** | −33%, shorts underpaid |

An attacker cranking every slot inflates a long's cost at will. Carrying the sub-unit remainder on the position makes any partition of a slot range sum to the single-shot amount, so settle frequency stops being an attack parameter. **This property is the precondition for the permissionless crank being safe at all**, and it is now pinned by vector **V6**.

### 3.2 `total_short_liquidity` ≠ `available_short_liquidity`

`06-long-mint-inventory.md` decremented one inventory number on long mint and used the same number for premium. Those are two different quantities:

- `total_short_liquidity` — all short liquidity provided. **The pro-rata denominator.**
- `available_short_liquidity` = `total_short − total_long` — **the long-mint gate only**, derived, not stored.

Using the available remainder as the denominator over-pays shorts as longs open — the denominator shrinks while the same shorts remain — breaking zero-sum. Now two explicit fields with a warning against conflating them.

A related ordering rule fell out of the same analysis: **`poke_range` must run before any change to the liquidity weights**, or the elapsed period is attributed at the wrong weights. It is `08-burn-settle.md` invariant 5, and vector **V4** fails if it is violated.

---

## 4. Files touched

| File | Change |
|---|---|
| `02-mvp-components/07-premium-engine.md` | Rewritten — Gap A + C, units, rounding, range accumulator |
| `02-mvp-components/08-burn-settle.md` | Rewritten — Gap B, bucket, four settlement flows, case matrix |
| `02-mvp-components/02-factory-allowlisted-market.md` | Gap D — §A pool procedure, live `tick_spacing`, checklist |
| `06-testing/FIXTURES-AND-VECTORS.md` | Rewritten — Gap E, V1–V6 |
| `adr/ADR-0002-premium-accounting.md` | **New** — six decisions with rejected alternatives |
| `audits/PREMIUM-GAPS-FIX-REPORT.md` | **New** — this file |
| `02-mvp-components/04-position-engine-1leg.md` | Premium checkpoint fields, `PendingPremium`, `settle_premium` |
| `02-mvp-components/06-long-mint-inventory.md` | `total_` vs `available_` split; poke ordering |
| `02-mvp-components/03-collateral-manager.md` | `debit_usdc`/`credit_usdc`, range vault, premium seniority |
| `02-mvp-components/09-risk-solvency.md` | Accrued premium as a long liability |
| `03-api-interfaces/INSTRUCTIONS.md` | `settle_premium`; poke reward zero; burn accounts |
| `03-api-interfaces/ERROR-CATALOG.md` | §6, codes `0x50`–`0x53` |
| `06-testing/RELEASE-GATE.md` | Q3 → vectors; new gate S5; placeholder warning removed |
| `02-mvp-components/01-clmm-adapter-orca.md` | One callout: spacing-64 example illustrative |
| `05-engineering/LOCAL-DEV.md`, `07-ops-presentation/RUNBOOK-DEVNET.md` | Pool-prerequisite pointers |
| `README.md` | ADR-0002 link |

16 files: 2 new, 14 edited. **No Orca CPI section was modified** beyond the single illustrative-example callout.

---

## 5. Verification performed

| # | Check | Result |
|---|---|---|
| 1 | All six vectors recomputed in exact integer arithmetic | **6/6 match the documented integers** |
| 2 | Zero-sum `Σ claims + dust == Σ payments` for V2, V3, V4 | **PASS** |
| 3 | Anti-grief: 100 × 1-slot settles == one 100-slot settle | **PASS** (150 == 150); ceil yields 200, floor-no-carry 100 |
| 4 | `grep MARKET_MULTIPLIER` / `"small fee"` | 0 hits outside ADR-0002, the premium spec's retirement note, and the prompt file |
| 5 | Placeholder sweep in fixtures | Clean; only `TODO_ALLOWLIST_ADDRESS` / `TODO_READ_FROM_POOL`, both permitted |
| 6 | Link sweep across all markdown files | **0 broken**; ADR-0002 reachable from `docs/README.md` |
| 7 | Banner check on edited files | No regression — see §6 item 6 |
| 8 | Scope guard `utilization` / `demand-based` | Only the two "out of scope" declarations; no pricing logic added |
| 9 | `premium_rate` / `premium_multiplier` / `PREMIUM_SCALE` consistent | Identical across premium spec, factory, fixtures, ADR |

No builds or tests were run: there is still no program code in the repository.

---

## 6. Residual risks

1. **No liquidation, so the solvency check is the only protection.** Fair MVP omits liquidation (`PRD.md` §A2 stretch). If price moves faster than a check runs, a long can owe more premium than it holds; the position stays `Open`, the debt stands, and shorts hold `receivable`. Accepted for devnet — **not acceptable for real size**, where liquidation or premium pre-funding must land first. (ADR-0002 § Consequences.)
2. **`premium_rate` / `premium_multiplier` are demo-tuned, not calibrated.** They make premium visible in ~40 s at demo sizes; they are not a fair-value claim. Recalibrate against pool notional and record in a follow-up ADR before any real size.
3. **Pool still unselected.** Gap D delivers the procedure and a 9-item checklist, not the address. `PERMA_WHIRLPOOL` remains unset. Premium vectors V1–V6 are pool-independent and pass regardless; only `FIXTURES-AND-VECTORS.md` §6 is blocked.
4. **One PDA + one token account per distinct tick range.** Unbounded if users pick many ranges. Fine at demo scale; a cap on distinct ranges per market is worth adding before real size.
5. **`PendingPremium` holds rent.** A short's account can outlive its liquidity while waiting on an unfunded claim. Rent is refunded on final close, but the account cannot be swept — by design, since sweeping would destroy the claim.
6. **8 of 11 component specs lack the `🚩 STATUS` banner footer** — `02`, `03`, `04`, `05`, `06`, `09`, `10`, `11`. This is **pre-existing and unrelated to A–E**; all edits here were targeted, so nothing was removed. Worth a one-line consistency pass, not done here to avoid widening scope.
7. **Flat rate means no demand signal** — a long pays the same whether 1% or 99% of inventory is used. Deliberate; Part B.
8. **Dust is unavoidable** and reaches the protocol only on full range unwind. At demo scale it is single-digit µUSDC per period, but it is the one place the protocol receives premium, so it should be surfaced in the UI rather than left silent.

---

## 7. Scope compliance

| Non-goal | Held |
|---|---|
| No utilization/demand premium | ✅ flat admin rate only; verified by grep |
| No program/app implementation | ✅ docs only |
| No Orca CPI rewrites | ✅ one illustrative-example callout, no account tables touched |
| No name or banner change | ✅ unchanged |
| No Part B expansion | ✅ no multi-leg, Raydium, DAO, or token |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
