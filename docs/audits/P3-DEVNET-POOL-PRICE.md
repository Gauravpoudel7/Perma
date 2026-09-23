# P3-DEVNET-POOL-PRICE — Ops ticket

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

| Field | Value |
|---|---|
| Opened | 2026-09-23 |
| Status | **Phase A complete (pool was at 0 bps on 2026-09-23; re-measure before any upgrade). Phase B (client + operator scripts) is in the repo. The live Solana-devnet program is still pre-P3 until the Mac runs `--deploy`.** |
| ADR | [ADR-0004](../adr/ADR-0004-oracle-and-price-aware-risk.md) |
| Report | [IMPL-P3-ORACLE-RISK-REPORT.md](IMPL-P3-ORACLE-RISK-REPORT.md) §4.1 |
| Feasibility | [IMPL-P3-DEVNET-POOL-PRICE-FEASIBILITY.md](IMPL-P3-DEVNET-POOL-PRICE-FEASIBILITY.md) — GO WITH BLOCKERS |
| Tooling | `scripts/rebalance-devnet-pool.mjs` (`--measure` / `--plan` / `--step` / `--until-within-bps`), `scripts/fund-devusdc-faucet.mjs` (`--once` / `--until`), [RUNBOOK-DEVNET.md](../07-ops-presentation/RUNBOOK-DEVNET.md) §4 |
| Phase A report | [IMPL-P3-DEVNET-POOL-PRICE-REPORT.md](IMPL-P3-DEVNET-POOL-PRICE-REPORT.md) |
| Upgrade follow-on | [IMPL-P3-DEVNET-UPGRADE.md](IMPL-P3-DEVNET-UPGRADE.md) — scripts only; live ELF was still 594,752 on 2026-09-23 |

## Problem

Allowlisted pool `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (WSOL/devUSDC, tick_spacing 8) trades near **~$20** practice SOL on Solana-devnet. Real Pyth **SOL/USD** is ~mainnet dollars. After a P3 upgrade, every `mint_position` fails `OracleDeviationTooHigh` (2% band). ADR forbids relaxing the band. The localnet mock receiver must **never** be deployed to Solana-devnet.

Until this ticket closes, keep the **live Solana-devnet program on the pre-P3 build**.

## Chosen path (recommended): Option A — rebalance current pool

Swap on `2WUg…` until pool spot is within **2%** of live Hermes/Pyth SOL/USD (feed id in ADR-0004). Keep the same tokens and tick spacing. Existing market stays valid. No factory allowlist change.

### Checklist

1. [x] Measure current `sqrt_price` → USDC/SOL spot vs live Pyth SOL/USD (devUSDC treated as USD 1:1 per ADR demo assumption). 2026-09-23: Spot 19.963 (tick -39141) vs Pyth 118.05, 8309 bps. The tick walk needs ~3.3k devUSDC in 9 swaps.
2. [x] Fund admin/CLI wallet with enough WSOL + devUSDC for stepped swaps. 2026-09-23: admin `7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY` bought 3,600 devUSDC from the Orca devToken faucet, for 24.0 SOL over 240 calls in 25 txs.
3. [x] Swap in steps; re-measure after each step until `|spot − pyth| / pyth ≤ 2%`. 2026-09-23: 11 swaps took 3,292.41 devUSDC in and 90.11 WSOL out, moving tick -39141 → -21426 and Spot 19.96 → 117.37. Pyth was 117.37, so **0.0 bps**. No tick arrays had to be created.
4. [x] Note impact on existing short inventory ranges (they will sit away from the new spot until new shorts are minted near it). The human closed both 18–22 practice positions before the swaps, so the market has no open positions. Every existing range now sits far below spot. New shorts near tick ≈ -21426 need the P3 upgrade (report §4).
5. [prepared, not executed] Upgrade the Solana-devnet program to P3 with `scripts/upgrade-devnet-p3.mjs --deploy` on the Mac that holds the admin key. Re-measure first. This repo does not have that key. The live ELF was still 594,752 after this change.
6. [done in-repo] Client `post_update` (Hermes → Wormhole verify → receiver `post_update`) runs in a transaction before the mint. `post_update_atomic` is not used (PERMA requires Full). Short-mint headroom stays 43 bytes.
7. [documented, not flipped in git] After the ELF changes, set `NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE=1` and `NEXT_PUBLIC_PRICE_UPDATE=7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` in `apps/web/.env.local`. Unset, a devnet build already defaults to that sponsored account. Do not use the localnet mock.
8. [scripted, not executed here] `yarn smoke-devnet-p3 -- --smoke` mints Short and Long near spot, then Settle and Close with the ephemeral Pyth accounts already closed. Exits do not take `price_update`.

## Option B — new pool + new market (fallback)

Only if A cannot move price practically: find/create another Orca WSOL/devUSDC pool (tick_spacing 8) near real SOL/USD, update factory allowlist, `create_market`, retarget the app. Breaks continuity with the current market and open positions.

## Out of scope

- **C** — Fake/mock Pyth on Solana-devnet (ADR: mock is localnet-only).
- **D** — Widen `MAX_DEVIATION_BPS` for ops convenience.
- Any P4 liquidation / force-exercise work before this ticket closes.

## Localnet (unaffected)

P3 is exercised on localnet with `node scripts/mock-price.mjs --loop` and the mock receiver loaded by `scripts/local-validator.sh`.
