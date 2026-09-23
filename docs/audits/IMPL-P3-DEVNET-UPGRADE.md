# IMPL P3-DEVNET-UPGRADE — client and operator path (no live upgrade)

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

**Result of this change:** the repo can post a real Pyth SOL/USD `price_update` into a P3 mint, and the operator has a checklist to upgrade Solana-devnet. **The live program was not upgraded.** `node scripts/upgrade-devnet-p3.mjs` from this workspace on 2026-09-23 printed ELF **594,752 bytes**, slot **502540621**, upgrade authority `7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY`, and did not send a transaction. That is the pre-P3 build. The local P3 build in the pool-price report is 604,872 bytes. The same check measured pool spot **117.3700** USDC/SOL against Pyth **117.2000** (**14.5 bps**, within 200) with the sponsored account **71 seconds** old, which is already past the 60 second mint limit. Re-measure before upgrading. `MAX_DEVIATION_BPS` is still 200. No mock receiver was deployed.

This VM does not have the operator key, so `--deploy` and `--smoke` were not run. Those commands are for the Mac that holds the admin key.

Ticket: [P3-DEVNET-POOL-PRICE.md](P3-DEVNET-POOL-PRICE.md). Pool rebalance: [IMPL-P3-DEVNET-POOL-PRICE-REPORT.md](IMPL-P3-DEVNET-POOL-PRICE-REPORT.md). ADR: [ADR-0004](../adr/ADR-0004-oracle-and-price-aware-risk.md).

## Operator checklist

Run from the repo root on the Mac, with `ANCHOR_WALLET` pointing at the admin key `7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY` (the upgrade authority). Phantom practice `EUqgmpDpC1vSMXjHxzhL7AzaS5qKaWFsMVtw7JrXvL38` is not the authority.

1. **Measure.** The pool drifts. Other devnet WSOL/devUSDC pools still trade near $20.

   ```bash
   node scripts/rebalance-devnet-pool.mjs --measure
   # if the line says OUTSIDE 200 bps:
   node scripts/rebalance-devnet-pool.mjs --until-within-bps 200 --max-step 50
   ```

2. **Confirm the program is still pre-P3, then build.**

   ```bash
   node scripts/upgrade-devnet-p3.mjs
   anchor build --arch v0
   node scripts/upgrade-devnet-p3.mjs
   ```

   The second check prints whether `target/deploy/perma.so` matches the on-chain ELF. It does not deploy.

3. **Upgrade.** Only after step 1 is `WITHIN 200 bps` and step 2 shows a local `.so`.

   ```bash
   node scripts/upgrade-devnet-p3.mjs --deploy
   node scripts/upgrade-devnet-p3.mjs
   ```

   `--deploy` refuses a mainnet URL, a non-devnet genesis, a missing `.so`, and a wallet that is not the on-chain upgrade authority. After it exits 0, the check must show an ELF length other than 594752.

4. **Flip the web env** in `apps/web/.env.local` (gitignored). Do not commit it.

   ```
   NEXT_PUBLIC_CLUSTER=devnet
   NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
   NEXT_PUBLIC_PERMA_PROGRAM_ID=4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt
   NEXT_PUBLIC_WHIRLPOOL=2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G
   NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE=1
   NEXT_PUBLIC_PRICE_UPDATE=7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE
   PYTH_API_KEY=<Hermes bearer token>
   ```

   Leave the flag unset until step 3 has changed the ELF. Restart Next. `PYTH_API_KEY` is read by the Next server and by the smoke script. It is not a `NEXT_PUBLIC_` variable.

5. **Smoke, then use the app.**

   ```bash
   cd apps/web && yarn smoke-devnet-p3 -- --check
   cd apps/web && yarn smoke-devnet-p3 -- --smoke
   ```

   `--smoke` mints a small Short and Long near the current spot, closes the ephemeral Pyth accounts, then Settle and Close. Settle/Close do not pass `price_update`. `--smoke` refuses the pre-P3 ELF and a pool outside 200 bps.

   In the browser, Open Short and Open Long near spot. If the sponsored account is older than 60 seconds the wallet signs the Pyth transactions first, then the mint. Close and Settle do not ask for a new price.

## What the client does

| Cluster | `NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE` | Mint account |
|---|---|---|
| localnet | unset | mock feed `2SicEEr…`, kept fresh by `scripts/mock-price.mjs` |
| devnet | unset or `0` | `price_update` omitted (live program is pre-P3) |
| devnet | `1` | sponsored feed if it is Full, SOL/USD, and ≤ 60 s old; otherwise Hermes → Wormhole verify → receiver `post_update`, then that new account |

`post_update_atomic` is not used. It records a partial verification level, and `oracle.rs` rejects anything except Full (`data[40] == 1`).

The post is not packed into the mint. A short mint is 1189 of 1232 bytes (43 bytes left). The VAA is larger than that, so it is a prior transaction. A missing tick array is also created in a prior transaction.

Hermes hosts tried, in order: `PYTH_HERMES_URL` if set, then `https://pyth.dourolabs.app/hermes`, then `https://hermes.pyth.network`. Both public hosts returned **HTTP 401** from this workspace on 2026-09-23 without a key. The browser calls `GET /api/pyth/sol-usd`, which attaches `PYTH_API_KEY` on the server.

If the sponsored account is stale and Hermes fails, the mint is not sent.

## Out of scope

- Widening `MAX_DEVIATION_BPS`.
- Deploying `tests/mock-pyth-receiver` to Solana-devnet.
- Mainnet, a second pool, or a P4 liquidation path.
- Claiming the on-chain upgrade already happened.

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
