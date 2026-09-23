# IMPL P3-DEVNET-POOL-PRICE Report — Option A, Phase A (pool rebalanced)

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

**Result:** the allowlisted Solana-devnet Whirlpool `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` now trades at Pyth SOL/USD. The final spot is **117.3700 USDC/SOL** against Pyth **117.3700**, a deviation of **0.0 bps** (limit 200). It took 11 stepped devUSDC→WSOL swaps on 2026-09-23.

What did **not** happen:
- **The Solana-devnet PERMA program is unchanged and still pre-P3.**
- `MAX_DEVIATION_BPS` is still 200.
- No mock Pyth is on Solana-devnet.
- Nothing in the web env changed.

Ticket: [P3-DEVNET-POOL-PRICE.md](P3-DEVNET-POOL-PRICE.md). Feasibility: [IMPL-P3-DEVNET-POOL-PRICE-FEASIBILITY.md](IMPL-P3-DEVNET-POOL-PRICE-FEASIBILITY.md). ADR: [ADR-0004](../adr/ADR-0004-oracle-and-price-aware-risk.md).

## 1. Before / after

| | Before (Phase 0 / pre-swap) | After step 11 |
|---|---|---|
| `tick_current_index` | -39141 | **-21426** |
| `sqrt_price` (Q64.64) | 2606325007577643957 | 6319726371094760448 |
| Spot (USDC/SOL) | 19.9626 | **117.3700** |
| In-range `liquidity` | 4762722691665 | 6349241908 (only the full-range tail) |
| Pyth SOL/USD | 117.3227 (conf 0.0114) | 117.3700 (conf 0.0175, publish 1790156889, age 160 s) |
| Deviation | 8298.5 bps | **0.0 bps** |

Pyth is read from the Solana-devnet sponsored `PriceUpdateV2` account `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`. It is the push-oracle PDA `[shard 0, feed_id]` under `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`, owned by the receiver `rec5EKM…`, and its feed id equals ADR-0004's. The script checks the owner, the feed id and VerificationLevel Full. Public Hermes answered HTTP 401 from the ops Mac, so it was not used.

## 2. Swap steps

Every step is an Orca `swap` (v1). It was simulated first, then sent by the admin/CLI wallet `7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY`. Each step's `sqrt_price_limit` was min(edge of its three tick arrays, Pyth), so the last step stopped exactly on Pyth. The Pyth column in the log reads 117.3227 for steps 1–2 and 117.37 from step 3 on.

| # | Signature | devUSDC in | WSOL out | Spot after | Tick after | Deviation after (bps) |
|---|---|---|---|---|---|---|
| 1 | `3vhUL8eTJpKd7d55miQmqzJrXNcTyhapjan9zZmckRLakSUNC99drKoRJ8PtkwgsbEfbsCcw8QuFQXvbzK5xbfZx` | 614.735024 | 30.324134710 | 23.9494 | -37321 | 7958.7 |
| 2 | `5uWqWdsDNpe8Yy7m3oPasoCb8pUZfkaLMbzjYsGagkDGAByEVMiuZQijsrn3K8S7ncFUDJV4EbbjL634xn45Ti2K` | 631.723941 | 24.405459850 | 27.5702 | -35913 | 7650.1 |
| 3 | `2X3r4yJzJhLfJvrmVFYH3aogm6JQoGKq9tmeaPPypyCerbt5zydJbu1nT2B6xBpFrBduKAdMixNyreaPucRQU1f9` | 106.270593 | 3.595307181 | 31.7384 | -34505 | 7295.9 |
| 4 | `3XTQ8qWS3r8ePXKWdcpJfwuJ8zPaMVWEPT9FUCUWfJyB6hiHu7KieEtqVh8eqAA8tLXcLinu6VE83Tiae8RFgpAe` | 83.850833 | 2.461116288 | 36.5368 | -33096 | 6887.0 |
| 5 | `4swjDgZvMshV8Aip2NT7yC1wZbyEx38948rSkHjpERVUfvwgyirjPq3xxXQM3Z5Kjcu2LJxYbNFFyjxqvMSwsJUv` | 137.381012 | 3.381578384 | 45.1283 | -30984 | 6155.0 |
| 6 | `z839eotgVExTog9BiV8Zq7nivBjn4AmDj22t8Xs6CDBUNDbta1cDzECza4zWUpwZ2hYTykA5Q75vacK8hcViNCF` | 160.628043 | 3.192441471 | 55.7401 | -28873 | 5250.9 |
| 7 | `5EShbkT2NQzHTYtoLJipctan98SErW8Gj8b48hF1CszhVER4tCPXtMGpxVjPhoVFjdxq8FJwuq5CeQ6ZHqS7isRb` | 916.764539 | 15.094493246 | 64.1672 | -27465 | 4532.9 |
| 8 | `5txSAGYSgr5QCwpxBhmYEGu8A7xRBVLsmUHu44MkLyiXBk78rhZMBacyCUu3PAqhiMwxwGpZ1kuwmEJBkGUDfS8c` | 188.211850 | 2.793652331 | 73.8684 | -26057 | 3706.4 |
| 9 | `3xQ95ByJ8BBitK29BKy1EqMtqACUtAdJMtCkpzWuArEkbY1Drk6iUdUoCzH9bDP5VSdUmpLw3Sn6WZ9wr1wmVUg7` | 127.921694 | 1.613226411 | 85.0363 | -24648 | 2754.9 |
| 10 | `2vHaSfVCFGeprNu6Qs7w6utzM8GDg9Hq1JFJh48zUW5ZNUkaVR4VdoXCrRUNTWSUTy7kPqA3QDct26ModBYs4aNp` | 207.362443 | 2.193866916 | 105.0323 | -22537 | 1051.2 |
| 11 | `5N1hdEfaFde9UqUrxHumvdpDVWLeJTjk5w9eSEYoxahZcz3ms5V1sPuQ9u5AQ7YZuV8B3baxttD9Lqt7SdBtg5Zu` | 117.558979 | 1.058275165 | 117.3700 | -21426 | 0.0 |
| **Σ** | 11 swaps | **3292.408951** | **90.113551953** | | | |

The total matches the Phase 0 tick-walk estimate (3,292 devUSDC to Pyth, 90.11 WSOL out). The plan listed 9 steps and the live run took 11, for this reason:
- After a swap stops at a tick-array edge, the pool sits one tick below that edge (e.g. -37321, not -37320).
- So the next swap's three-array window starts one array earlier.
- Steps 2 and 3 therefore each covered less range. The capital was unchanged.

**Tick arrays created: none.** Steps 9–11 crossed the uninitialized arrays -26048, -25344, -23936, -22528 and -21824. Orca's `swap` accepted them as uninitialized PDAs, and both simulation and execution passed. `--init-tick-arrays` was not needed and was not added.

## 3. Capital

**Faucet** (Orca devToken distributor `Bu2AaWnVoveQT47wP4obpmmZUwK9bN9ah4w6Vaoa93Y9`, the one behind the Nebula UI):
- 240 `Distribute` calls in 25 txs: one `--once` probe, then batches of 10.
- Each call pays 0.1 SOL to `3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo` and credits 15 devUSDC. That rate was measured on the first call.
- Total: **24.000125 SOL spent, 3,600 devUSDC received.**
- Faucet vault `Ga8wFj5LAiwxDN13ywmr4iA2i4zC71n5awUuiz4zpXQQ` held ~692k devUSDC beforehand.

**Admin wallet `7eDWS2L8…ELnY`:**

| | Start of session | After faucet | After rebalance |
|---|---|---|---|
| SOL | 27.566146972 | 3.566021972 | 3.564478532 (−0.00154 swap fees + WSOL ATA rent) |
| WSOL | no ATA | no ATA | **90.113551953** |
| devUSDC | 0 | 3600 | **307.591049** |

The admin now holds ~90 WSOL, plus 307.59 devUSDC for re-tightening (§6). The WSOL can be unwrapped to SOL later with `spl-token unwrap`. It was left wrapped because it is also the inventory for stepping the price back down.

The Phantom practice wallet `EUqg…vL38` was not used and not drained.

## 4. PERMA book / inventory impact

At Phase 0 the Phantom practice wallet had a Short (`Gif4Vcx3kHvicFa7rHfyr8My2bbPhjiwbfrJqHCpmy5N`, L=100000) and a Long (`FDtJhVcRWdz962GrJD1QKDgM9MmZor78dRqVxAFX2dge`, L=10000), both at -40176/-38168 (~18–22). The human chose to keep them.

Before the first live swap, a read-only check found **both already closed by the human**:
- The Phantom wallet signed two `BurnPosition` txs at 2026-09-23 14:39 NPT, one including `CollectFeesV2` + `ClosePosition`.
- The UserCollateral now shows `openPositions 0`, `openLongs 0`.
- The in-range pool liquidity was 100,000 lower, the short's size.

This session never signed with the Phantom wallet.

Impact now:
- No PERMA position or short inventory remains on the market.
- Every existing RangePremiumState (18–22 and nearby ranges) sits far below the new spot (tick -21426).
- New longs need new shorts minted near tick ≈ -21426 (~$117). That only works after the P3 upgrade follow-on.
- Burn and settle stay oracle-free (ADR-0004).

## 5. Program still pre-P3

`solana program show 4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt -u devnet`, after the swaps:
- Data Length **594752 (0x91340)**
- Last Deployed In Slot **502540621**

Both are identical to Phase 0; the local P3 build is 604,872 B. No upgrade, no `NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE`, no `NEXT_PUBLIC_PRICE_UPDATE` change. Ticket items 5–8 remain the follow-on:
- P3 upgrade
- Hermes → `post_update` client
- a real posted price-update account
- smoke test

## 6. Residual risks

- **Thin liquidity at the new spot.** Only the full-range tail (L = 6.35e9) is in range, so **~11 devUSDC (or ~0.09 WSOL) moves the price about 1%**. That makes re-tightening cheap, and the leftover admin inventory covers either direction. It also means any stray devnet swap pushes the pool out of the 2% band. Minting P3 shorts near spot after the upgrade adds depth there.
- **Arbitrage drift.** Every other devnet WSOL/devUSDC pool (e.g. `Bz7wxD47…`, `966HQTB3…`) still trades at ~$20–22. Anyone can buy SOL there and sell it into `2WUg…`.
- **Pyth drift.** The 2% band moves with SOL.
- **Rule:** re-run `--measure`, and `--until-within-bps 200 --max-step 50` if needed, **immediately before** the P3 upgrade and before any smoke mint. The step input switches to WSOL automatically when spot is above Pyth.

## 7. Option A vs B decision record

Option A was chosen and completed. Phase 0 measured 3,277–3,292 devUSDC, which the public devToken faucet can supply (24 SOL). The swaps were mechanically clean, and no tick arrays had to be created. Option B (new pool + new market + allowlist change) was not needed. The market `BmfJqNtZkAVdF4QatqRWutQPkmkY1WY82PAG6zgdS2cy`, the allowlist and the tick spacing are unchanged.

## 8. Script usage

```bash
# Part 1 — practice devUSDC for the admin wallet (0.1 SOL → 15 devUSDC per call, keeps ≥ 1 SOL)
node scripts/fund-devusdc-faucet.mjs --once
node scripts/fund-devusdc-faucet.mjs --until 3600 --per-tx 10

# Part 2 — rebalance
node scripts/rebalance-devnet-pool.mjs --measure
node scripts/rebalance-devnet-pool.mjs --plan
node scripts/rebalance-devnet-pool.mjs --step 1100 --dry-run
node scripts/rebalance-devnet-pool.mjs --step 1100          # price limit caps the real input
node scripts/rebalance-devnet-pool.mjs --until-within-bps 200 --max-step 50 --max-steps 12
```

Both scripts refuse any cluster whose genesis hash is not Solana-devnet's. The faucet script also refuses any wallet other than the admin.

Each step prints one JSON line with ts, sig, direction, token deltas, spot before/after, tick after, Pyth, and deviation. This session's lines are reproduced in §2 and §3; the raw logs were kept in the session scratchpad, not in git.

One fix during the run: the faucet's retry filter now treats a simulation `BlockhashNotFound` (RPC lag) as transient. Nothing had been sent when it tripped, so no funds were affected.

## 9. Gates

- `node scripts/rebalance-devnet-pool.mjs --measure`: **0.0 bps, WITHIN 200 bps**.
- `solana cluster-version -u devnet`: 4.3.0-rc.0.
- Re-measure ~5 min after step 11: still **0.0 bps**. The sponsored Pyth account had not published again (age 312 s).
- `solana program show … -u devnet` after the swaps: 594752 B, slot 502540621, so **no upgrade**.
- `PATH=$HOME/.cargo/bin:$PATH yarn test:unit`: 75/75 passed. Only scripts and docs changed this session.
