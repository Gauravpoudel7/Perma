# IMPL P3-DEVNET-POOL-PRICE Feasibility — Option A (rebalance current pool)

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

**Verdict: GO WITH BLOCKERS.** Option A can move the pool mechanically, and it needs far less capital than the ~9–11k devUSDC first estimated. **Blocker:** the admin/CLI wallet holds **0 devUSDC** and needs about **3.6k devUSDC** (3,277 simulated + ~10% buffer for drift). The human funds this from the Orca devnet devToken faucet or a similar source. Nothing on-chain sells devUSDC below ~$19–22/SOL, so buying it with SOL would take ~165+ devnet SOL. Option B is **not** needed.

Ticket: [P3-DEVNET-POOL-PRICE.md](P3-DEVNET-POOL-PRICE.md). ADR: [ADR-0004](../adr/ADR-0004-oracle-and-price-aware-risk.md). Measured 2026-09-23 against public Solana-devnet (`https://api.devnet.solana.com`), read-only.

## Q0 — Live inventory

### 1. Pool spot

| Field | Value |
|---|---|
| Pool | `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (WSOL 9 dp / devUSDC `BRjp…Hok1k` 6 dp) |
| tick_spacing / fee_rate | 8 / 500 (0.05%) |
| `sqrt_price` (Q64.64) | `2606325007577643957` |
| `tick_current_index` | **-39141** |
| Spot | **19.963 USDC/SOL** (decoded with the `whirlpool.ts` offsets; Spot, not a TWAP) |
| `liquidity` | `4762722791665` |
| Orca vaults | 108.719 WSOL (`3uyTv2Pi3pb6Gc2emKiYU8gW845M1HeMMyFr2MTrDGh4`), 3984.09 devUSDC (`63GvSvGYTsfesX1kmesdtfxHbBQBsFpZT1wVNhNADT5C`) |

### 2. Pyth SOL/USD

| Field | Value |
|---|---|
| Source | Solana-devnet sponsored `PriceUpdateV2` account `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`. Owner is the Pyth receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`. |
| Feed id | `ef0d8b6f…b56d`, the same as ADR-0004 |
| Verification | Full |
| Price / conf | **118.054** / 0.0103 |
| Age at read | ~197 s |
| Deviation | `|19.963 − 118.054| / 118.054` = **8309 bps** (limit 200) |

Public Hermes (`hermes.pyth.network`, `hermes-beta.pyth.network`, `benchmarks.pyth.network`) answered **HTTP 401 unauthorized** from this Mac. So the gate reads the price from Pyth's own on-chain push account above. That value is still Pyth's SOL/USD for the ADR feed id, not a CEX quote. The rebalance script accepts `PYTH_PRICE_ACCOUNT` to override the account.

The sponsored account updates slowly: 197 s old here, against `MAX_STALENESS_SECS = 60` in `programs/perma/src/oracle.rs:47`. That is fine for this ops gate, which only needs the price level. It does **not** make the account usable for P3 mints. The mint path still needs the follow-on client `post_update` (ticket items 6–7).

Target band: **115.69 – 120.41 USDC/SOL**, i.e. ticks ≈ **-21569 … -21169** (Pyth ≈ -21367).

### 3. Wallet balances

| Wallet | SOL | WSOL | devUSDC |
|---|---|---|---|
| Admin/CLI `7eDWS2L8…ELnY` (swapper) | 3.566 | no ATA | 0 (ATA `A728HNbbk6AjiqTsqNt5FbD7cz7xNpeXrx35qetgLcmX`) |
| Phantom practice `EUqgmpDp…vL38` (not used) | 17.145 | 0 (ATA `Cseyj75ic9Cy75XezvMxCemBTd6tBzrxanHek9JuyYYX`) | 51.79 |

devUSDC mint authority is `3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo`, a system account, i.e. someone else's private key. We cannot mint devUSDC.

### 4. PERMA book on this market

Market `BmfJqNtZkAVdF4QatqRWutQPkmkY1WY82PAG6zgdS2cy`. Two open positions, both owned by the Phantom practice wallet:

| Position | Leg | Range (ticks) | Liquidity | Notes |
|---|---|---|---|---|
| `Gif4Vcx3kHvicFa7rHfyr8My2bbPhjiwbfrJqHCpmy5N` | Short | -40176 / -38168 (~18.0–22.0) | 100000 | locked 33604 lamports + 713 raw devUSDC |
| `FDtJhVcRWdz962GrJD1QKDgM9MmZor78dRqVxAFX2dge` | Long | -40176 / -38168 | 10000 | premium streams from the short above |

RangePremiumState `CXUAxzpjcVxx7S6FBnUBm3VseD911R8MY7skT73PFtqB` holds premiumPool 28650. Eight other RangePremiumStates have zero liquidity.

**Impact of the move.** The new spot will be near tick -21367, far above both ranges. Consequences:
- The short's Orca liquidity becomes 100% devUSDC and earns no swap fees.
- The long sits away from spot.
- Burn and settle stay oracle-free (ADR-0004), so both can still be closed at any time.
- Useful new longs need new shorts minted near the new tick. That only works after the P3 upgrade follow-on.

**Human decision (this session): keep both positions.** No positions are closed by this ticket. *Later on 2026-09-23, before the swaps, the human closed both positions from Phantom themselves; see the report §4.*

### 5. Capital estimate (tick walk, not a guess)

All 44 tick arrays of the pool were read (31 fixed, 13 dynamic; 58 initialized ticks). The script walked the swap math from the current `sqrt_price` up to 115.69, crossing each initialized tick with its `liquidity_net`, 0.05% fee included:

| Spot reached | Cumulative devUSDC in | Cumulative WSOL out |
|---|---|---|
| 20.2 | ~525 | ~26.3 |
| 25.0 | ~637 | ~31.2 |
| 26.4 | ~1,169 | ~51.8 |
| 58.3 | ~2,104 | ~73.7 |
| 64.2 | ~2,652 | ~82.5 |
| 100.0 | ~3,125 | ~88.6 |
| **115.69** | **~3,277** | **~90.0** |

Most of the cost comes from four dense LP clusters, near 19.8–20.2, 25.5–26.4, 58, and 62–64. Above 64 only a thin full-range tail remains. **3,277 devUSDC is feasible with play tokens.** It is less than the 3,984 devUSDC already in the pool.

Tick arrays on the path:
- Present: -39424 … -26752, -24640, -23232.
- **Missing:** -26048, -25344, -23936, -22528, -21824.

The step simulation decides whether the swap accepts these uninitialized PDAs. If it does not, Orca `initialize_tick_array` is permissionless and costs ~0.07 SOL rent each. *Result: the swap accepted them, so none were created.* Each `swap` spans at most three tick arrays (3 × 704 ticks), so at least ~9 swap steps are needed to cover ~17.8k ticks.

### 6. Program is still pre-P3

`solana program show 4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt -u devnet`: data length **594,752 B**, last deployed slot 502540621, authority `7eDW…`. The local P3 build `target/deploy/perma.so` is 604,872 B. The web client omits `price_update` on `devnet` by default (`apps/web/src/lib/constants.ts` `mintExpectsPriceUpdate`), and devnet mints work today. **No upgrade in this session.**

### 7. RPC plan

Public `https://api.devnet.solana.com` served every read above. `getProgramAccounts` for tick arrays is the heaviest call. If it is rate-limited, set `SOLANA_RPC=<Helius Solana-devnet URL>`, which is kept out of git. The script refuses any cluster whose genesis hash is not Solana-devnet's.

## Residual risks

- **Arbitrage drift.** Every other devnet WSOL/devUSDC pool trades at ~$19–22. Anyone can buy SOL there and sell it into `2WUg…` at ~$118. If a devnet bot does this, the price falls back. Re-measure at the end and right before any upgrade.
- **Pyth drift.** A 2% band moves with SOL. Expect to re-run `--until-within-bps 200` before the P3 upgrade session, not only once.
- **Other devnet LPs** will see their positions converted. That is expected on a shared devnet pool with practice tokens.

## Option B note

Not triggered. It is kept on record only: every other devnet WSOL/devUSDC pool is also near ~$20. A new market would therefore need a new pool at the right price, plus a factory allowlist change (there is no setter today).

## Exit

**GO WITH BLOCKERS.** Top-up needed before any live swap:

| Wallet | Need | Have |
|---|---|---|
| Admin `7eDWS2L8…ELnY` | **≥ 3,600 devUSDC** (ATA `A728HNbbk6AjiqTsqNt5FbD7cz7xNpeXrx35qetgLcmX`) | 0 |
| Admin | ≥ 1 SOL for fees, the WSOL ATA, and possible tick-array rent | 3.566 |
