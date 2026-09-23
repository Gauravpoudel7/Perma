# P3-DEVNET-POOL-PRICE — Ops ticket (no program upgrade yet)

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

| Field | Value |
|---|---|
| Opened | 2026-09-23 |
| Status | **Open — blocking Solana-devnet upgrade of P3** |
| ADR | [ADR-0004](../adr/ADR-0004-oracle-and-price-aware-risk.md) |
| Report | [IMPL-P3-ORACLE-RISK-REPORT.md](IMPL-P3-ORACLE-RISK-REPORT.md) §4.1 |

## Problem

Allowlisted pool `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (WSOL/devUSDC, tick_spacing 8) trades near **~$20** practice SOL on Solana-devnet. Real Pyth **SOL/USD** is ~mainnet dollars. After a P3 upgrade, every `mint_position` fails `OracleDeviationTooHigh` (2% band). ADR forbids relaxing the band. The localnet mock receiver must **never** be deployed to Solana-devnet.

Until this ticket closes, keep the **live Solana-devnet program on the pre-P3 build**.

## Chosen path (recommended): Option A — rebalance current pool

Swap on `2WUg…` until pool spot is within **2%** of live Hermes/Pyth SOL/USD (feed id in ADR-0004). Keep the same tokens and tick spacing. Existing market stays valid. No factory allowlist change.

### Checklist

1. Measure current `sqrt_price` → USDC/SOL spot vs live Pyth SOL/USD (devUSDC treated as USD 1:1 per ADR demo assumption).
2. Fund admin/CLI wallet with enough WSOL + devUSDC for stepped swaps.
3. Swap in steps; re-measure after each step until `|spot − pyth| / pyth ≤ 2%`.
4. Note impact on existing short inventory ranges (they will sit away from the new spot until new shorts are minted near it).
5. Only then upgrade the Solana-devnet program to P3.
6. Wire client `post_update` (Hermes → Pyth receiver) before/with mint; prefer a prior tx if short-mint size headroom (~43 B) is tight.
7. Point `NEXT_PUBLIC_PRICE_UPDATE` at the real posted account (not the localnet mock PDA).
8. Smoke: short + long mint; burn/settle with a deliberately stale feed (exits must still work).

## Option B — new pool + new market (fallback)

Only if A cannot move price practically: find/create another Orca WSOL/devUSDC pool (tick_spacing 8) near real SOL/USD, update factory allowlist, `create_market`, retarget the app. Breaks continuity with the current market and open positions.

## Out of scope

- **C** — Fake/mock Pyth on Solana-devnet (ADR: mock is localnet-only).
- **D** — Widen `MAX_DEVIATION_BPS` for ops convenience.
- Any P4 liquidation / force-exercise work before this ticket closes.

## Localnet (unaffected)

P3 is exercised on localnet with `node scripts/mock-price.mjs --loop` and the mock receiver loaded by `scripts/local-validator.sh`.
