# Component Index — Fair MVP

The eleven on-chain modules that make up the PERMA Fair MVP. Scope for all of them is fixed by **Part A** of [`PRD.md`](../../PRD.md): Solana devnet, Orca Whirlpool only, one allowlisted SOL/USDC pool, 1-leg positions.

Build order is defined in `PRD.md` §A11 and is **not** the same as the numbering below — start with the CLMM Adapter.

| # | Component | Responsibility |
|---|---|---|
| 01 | [CLMM Adapter (Orca Whirlpool)](01-clmm-adapter-orca.md) | The only module permitted to CPI into Orca. Translates range + size into Whirlpool accounts and instructions; validates every account before the CPI. |
| 02 | [Factory (Allowlisted Market)](02-factory-allowlisted-market.md) | Market lifecycle. MVP restricts creation to a single allowlisted SOL/USDC Whirlpool. |
| 03 | [Collateral Manager](03-collateral-manager.md) | Deposit, withdraw, and lock SOL/USDC backing option positions; blocks insolvent withdrawals. |
| 04 | [Position Engine (1-Leg)](04-position-engine-1leg.md) | Core state machine for option legs. Sole caller of the CLMM Adapter. |
| 05 | [Short Mint](05-short-mint.md) | Converts collateral into a short position by adding real Whirlpool liquidity. |
| 06 | [Long Mint (Inventory-Capped)](06-long-mint-inventory.md) | Buys an option against existing PERMA short liquidity; rejects when inventory is absent. |
| 07 | [Premium Engine](07-premium-engine.md) | Accumulator-based streaming premium from long to short, with no per-position ticking. |
| 08 | [Burn & Settle](08-burn-settle.md) | Closes a position and settles P&L + premium back into collateral. |
| 09 | [Risk & Solvency](09-risk-solvency.md) | Solvency gate on mint and withdraw; prevents protocol bad debt. |
| 10 | [Pause Admin](10-pause-admin.md) | Emergency halt for trading and minting. |
| 11 | [Events Indexing](11-events-indexing.md) | On-chain events feeding the off-chain cache the UI reads. |

## The MVP loop

```text
deposit collateral
  → open SHORT   (Short Mint → CLMM Adapter → Orca increase_liquidity_v2)
  → open LONG    (Long Mint, only if PERMA short inventory exists)
  → streaming premium accrues (Premium Engine accumulator)
  → close / burn (Burn & Settle: premium + P&L → collateral)
  → solvency gates every withdraw and every mint (Risk & Solvency)
```

## Cross-cutting references

- [`ERROR-CATALOG.md`](../03-api-interfaces/ERROR-CATALOG.md) — every error these components raise
- [`INSTRUCTIONS.md`](../03-api-interfaces/INSTRUCTIONS.md) — the public instruction surface
- [`ADR-0001`](../adr/ADR-0001-orca-cpi-instruction-surface.md) — Orca instruction names, v2 choice, position ownership model
- [`COMPONENT-SPEC-TEMPLATE.md`](../templates/COMPONENT-SPEC-TEMPLATE.md) — the section order every spec above follows

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
