# Component Index — Fair MVP

The eleven on-chain modules that make up the PERMA Fair MVP. Scope for all of them is fixed by **Part A** of [`PRD.md`](../../PRD.md): Solana devnet, Orca Whirlpool only, one allowlisted SOL/USDC pool, 1-leg positions.

Build order is defined in `PRD.md` §A11 and is **not** the same as the numbering below — start with the CLMM Adapter.

| # | Component | Responsibility | Status |
|---|---|---|---|
| 01 | [CLMM Adapter (Orca Whirlpool)](01-clmm-adapter-orca.md) | The only module permitted to CPI into Orca. Translates range + size into Whirlpool accounts and instructions; validates every account before the CPI. | ✅ shipped |
| 02 | [Factory (Allowlisted Market)](02-factory-allowlisted-market.md) | Market lifecycle. MVP restricts creation to a single allowlisted SOL/USDC Whirlpool. | ✅ shipped |
| 03 | [Collateral Manager](03-collateral-manager.md) | Deposit, withdraw, and lock SOL/USDC backing option positions; owns the withdraw seam. | ✅ shipped |
| 04 | [Position Engine (1-Leg)](04-position-engine-1leg.md) | Core state machine for option legs. Sole caller of the CLMM Adapter. | ✅ shipped |
| 05 | [Short Mint](05-short-mint.md) | Converts collateral into a short position by adding real Whirlpool liquidity. | ✅ shipped |
| 06 | [Long Mint (Inventory-Capped)](06-long-mint-inventory.md) | Buys an option against existing PERMA short liquidity; rejects when inventory is absent. | ✅ shipped (solvency stub) |
| 07 | [Premium Engine](07-premium-engine.md) | Accumulator-based streaming premium from long to short, with no per-position ticking. | ✅ shipped |
| 08 | [Burn & Settle](08-burn-settle.md) | Closes a position and settles premium in cash. Short LP result realized via Orca returns; long P&L = 0 (ADR-0003). | ✅ shipped |
| 09 | [Risk & Solvency](09-risk-solvency.md) | Long-premium liability + horizon margin on withdraw and long mint. No price input. | ✅ shipped (ADR-0003) |
| 10 | [Pause Admin](10-pause-admin.md) | Emergency halt for new risk; exits always open. | ✅ shipped ([`IMPL-10-PAUSE-ADMIN-REPORT.md`](../audits/IMPL-10-PAUSE-ADMIN-REPORT.md)); `pause_global` deferred |
| 11 | [Events Indexing](11-events-indexing.md) | Complete on-chain events + a thin post-tx consumer in the web app. | ✅ shipped Fair-thin ([`IMPL-11-EVENTS-INDEXING-REPORT.md`](../audits/IMPL-11-EVENTS-INDEXING-REPORT.md)); DB indexer + APIs → P2 |

## The MVP loop

```text
deposit collateral
  → open SHORT   (Short Mint → CLMM Adapter → Orca increase_liquidity_v2)
  → open LONG    (Long Mint, only if PERMA short inventory exists)
  → streaming premium accrues (Premium Engine accumulator)
  → close / burn (Burn & Settle: premium → collateral in cash; short LP result via Orca returns)
  → solvency gates every withdraw and every long mint (Risk & Solvency: accrued premium + margin, projected index)
```

## Cross-cutting references

- [`ERROR-CATALOG.md`](../03-api-interfaces/ERROR-CATALOG.md) — every error these components raise
- [`INSTRUCTIONS.md`](../03-api-interfaces/INSTRUCTIONS.md) — the public instruction surface
- [`ADR-0001`](../adr/ADR-0001-orca-cpi-instruction-surface.md) — Orca instruction names, v2 choice, position ownership model
- [`COMPONENT-SPEC-TEMPLATE.md`](../templates/COMPONENT-SPEC-TEMPLATE.md) — the section order every spec above follows

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
