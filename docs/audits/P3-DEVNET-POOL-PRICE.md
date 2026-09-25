# P3-DEVNET-POOL-PRICE — Ops ticket

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

| Field | Value |
|---|---|
| Opened | 2026-09-23 |
| Status | **Closed (2026-09-25).** The pool is back within 2% of Pyth, the Solana-devnet program runs P3 (ELF 604,992 B, slot 502908043), and `smoke-devnet-p3 --smoke` is green. |
| ADR | [ADR-0004](../adr/ADR-0004-oracle-and-price-aware-risk.md) |
| Report | [IMPL-P3-ORACLE-RISK-REPORT.md](IMPL-P3-ORACLE-RISK-REPORT.md) §4.1 |
| Feasibility | [IMPL-P3-DEVNET-POOL-PRICE-FEASIBILITY.md](IMPL-P3-DEVNET-POOL-PRICE-FEASIBILITY.md) — GO WITH BLOCKERS |
| Tooling | `scripts/rebalance-devnet-pool.mjs` (`--measure` / `--plan` / `--step` / `--until-within-bps`), `scripts/fund-devusdc-faucet.mjs` (`--once` / `--until`), [RUNBOOK-DEVNET.md](../07-ops-presentation/RUNBOOK-DEVNET.md) §4 |
| Phase A report | [IMPL-P3-DEVNET-POOL-PRICE-REPORT.md](IMPL-P3-DEVNET-POOL-PRICE-REPORT.md) |
| Upgrade follow-on | [IMPL-P3-DEVNET-UPGRADE.md](IMPL-P3-DEVNET-UPGRADE.md). The upgrade was run from the operator Mac. The live ELF is 604,992 B at slot 502908043. |
| Side effect (open) | A **fresh** localnet ledger clones the pool at ~$117, so the 18–22 fixture range is below spot. The result is 117 passing / 5 failing (WSOL assertions). See [`RELEASE-GATE.md`](../06-testing/RELEASE-GATE.md) §3 "Known regression". |

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
5. [x] Upgrade the Solana-devnet program to P3 with `scripts/upgrade-devnet-p3.mjs --deploy` on the Mac that holds the admin key. Done: `solana program show` reports 604,992 B, last deployed in slot 502908043.
6. [x] Client `post_update` (Hermes → Wormhole verify → receiver `post_update`) runs in transactions before the mint. `post_update_atomic` is not used, because PERMA requires Full. Short-mint headroom stays 43 bytes. **Fixed 2026-09-25:** Next 14 cached the server-side Hermes `fetch`, so every post carried the same update (publish 1790161410, 6–27 min old) and each mint failed the 60 s staleness gate after 4 Pyth prompts. Both Hermes fetches are now `cache: "no-store"`. `resolveMintPriceUpdate` refuses an update older than 30 s before any wallet prompt. The web app signs the Pyth post transactions with one `signAllTransactions` approval.
7. [x] `NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE=1`, `NEXT_PUBLIC_PRICE_UPDATE=7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` and `PYTH_API_KEY` are set in `apps/web/.env.local`, which is not committed. The localnet mock is not used.
8. [x] Smoke, 2026-09-25, admin wallet:
   - The pool had drifted to 113.14, 338 bps. One capped swap (`33GSxTX1…`, 37.00 devUSDC in) brought it back to 0 bps.
   - `yarn smoke-devnet-p3 --smoke`: Pyth post `616SiEFy…`, mint-short `54dC4YDT…`, mint-long `39tkrgtZ…`, close-pyth `4kHuaaha…`.
   - Then, with no `price_update`, settle-long `q7DPWTze…`, close-long `4Dwh2UxL…`, close-short `5ddMWm5e…`.
   - The Phantom practice wallet also opened a long from the UI after the fetch fix (2026-09-23 11:47 UTC).

## Option B — new pool + new market (fallback)

Only if A cannot move price practically: find/create another Orca WSOL/devUSDC pool (tick_spacing 8) near real SOL/USD, update factory allowlist, `create_market`, retarget the app. Breaks continuity with the current market and open positions.

## Out of scope

- **C** — Fake/mock Pyth on Solana-devnet (ADR: mock is localnet-only).
- **D** — Widen `MAX_DEVIATION_BPS` for ops convenience.
- Any P4 liquidation / force-exercise work before this ticket closes.

## Localnet (unaffected)

P3 is exercised on localnet with `node scripts/mock-price.mjs --loop` and the mock receiver loaded by `scripts/local-validator.sh`.
