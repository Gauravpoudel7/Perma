# RUNBOOK: Devnet Operations

> **Status (2026-09-22):** the program is verified on a **local validator** with Orca cloned in (`scripts/local-validator.sh`). **Public Solana-devnet deployment is still outstanding**, blocked on funding: `solana program show 4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt -u https://api.devnet.solana.com` returns "Unable to find the account", the deploy needs **6.05 SOL** of program-data rent (581 KB × 2), and the deploy wallet `7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY` holds 0 SOL — every `solana airdrop` attempt on 2026-09-22 was refused with "rate limit is reached". Fund that wallet, then run §1 and §2 below; the init tooling now exists and has been exercised on a live cluster. See `docs/audits/IMPL-DEVNET-DEPLOY-AND-UI-REPORT.md`.

## Deployment Process

## Status (2026-09-22 NPT)

**DEPLOYED on public Solana-devnet.** Program `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt` live; GlobalConfig + market initialized via `yarn init-market`. Wallet remaining ~6.97 SOL after deploy. IDL upload failed (npm cache perms on `~/.npm`) — on-chain program is fine; fix later with `sudo chown -R $(whoami) ~/.npm` then `anchor idl init` if needed. Seed shorts still deferred.


### 1. Program Deployment
```bash
anchor build --arch v0            # --arch v0 is mandatory (RELEASE-GATE.md §4.1)
anchor deploy --provider.cluster devnet
```

### 2. Market Initialization

The allowlisted Whirlpool is resolved and fixed: **`2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G`** (SOL/devUSDC, `tick_spacing = 8`, ~20 USDC/SOL). It is hard-coded in the tests and fixtures — there is no `PERMA_WHIRLPOOL` environment variable. See [`FIXTURES-AND-VECTORS.md`](../06-testing/FIXTURES-AND-VECTORS.md) §6.

`initialize_global_config(pool)` then `create_market()` — both admin-signed, both idempotent-guarded (`init`). Run them with:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn init-market
```

`scripts/init-devnet-market.mjs` is safe to re-run: it creates the two PERMA vaults (ATAs of the
`market_authority` PDA for the pool's mints, read live from the Whirlpool account — `create_market`
requires them to exist already), calls `initialize_global_config` and `create_market` only where the
account is missing, refuses to run if the program is not deployed on that cluster, warns if an
existing `GlobalConfig` has a different admin or allowlisted pool, and prints the full address table
for this document. Verified against a live validator on 2026-09-22: the vaults it derives are exactly
the fixture vaults `3umaZ…` / `HNR1X…`, and a second run reports every account as already existing.

### 3. Seeding Liquidity (For Demo)
To ensure longs can be opened, the market needs short liquidity in the demo range **18–22 USDC** (ticks `-40176` / `-38168`). **TODO:** no `yarn scripts:seed-shorts` exists; `tests/position-short.ts`'s `mintShort` helper is the working pattern. On Solana-devnet this also needs devUSDC in the admin wallet, which has no faucet — swap a little SOL for it on Orca's devnet app first. Until a short exists, Trade honestly shows "No short liquidity in this range."

### 4. Pool price vs Pyth (P3 prerequisite)

P3's `mint_position` refuses when the pool's Spot is more than **2%** (`MAX_DEVIATION_BPS = 200`) from Pyth SOL/USD, with devUSDC treated as USD 1:1 (ADR-0004). The devnet pool traded near ~$20 while Pyth read ~$118, so the Solana-devnet program stays **pre-P3** until the pool is moved. Ticket: [`P3-DEVNET-POOL-PRICE.md`](../audits/P3-DEVNET-POOL-PRICE.md). The fix is to swap on the pool itself; never widen the band and never point devnet at the localnet mock receiver.

```bash
node scripts/rebalance-devnet-pool.mjs --measure                  # Spot, tick, Pyth, deviation bps. No txs.
node scripts/rebalance-devnet-pool.mjs --plan                     # direction, total input, per-step table. No txs.
node scripts/rebalance-devnet-pool.mjs --step 500 --dry-run       # build + simulate one swap
node scripts/rebalance-devnet-pool.mjs --step 500 | tee -a rebalance.jsonl   # one live swap, JSON log line
node scripts/rebalance-devnet-pool.mjs --until-within-bps 200 --max-step 500 --max-steps 12   # opt-in loop
```

- The swapper is `ANCHOR_WALLET` (default `~/.config/solana/id.json`, the admin/CLI wallet). The RPC comes from `SOLANA_RPC` / `ANCHOR_PROVIDER_URL` (default public devnet; use a Helius devnet URL if rate-limited). The script refuses any cluster whose genesis hash is not Solana-devnet's.
- **Within 2%** means `|spot − pyth| / pyth ≤ 0.02`, where Spot is the pool's `sqrt_price` in USDC/SOL.
- Pyth is read from its on-chain sponsored SOL/USD push account (`7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`; ADR-0004 feed id, VerificationLevel Full). Public Hermes answered HTTP 401 from the ops Mac. Override the account with `PYTH_PRICE_ACCOUNT`. Never use a CEX price as the gate.
- `--step` amounts are in the input token. That is devUSDC while Spot is below Pyth (buys WSOL, raises Spot) and WSOL while Spot is above Pyth.
- Each swap's price limit is Pyth or the edge of its three tick arrays, whichever comes first. A step therefore never overshoots Pyth, and the script sends only what reaching that limit needs.
- **Re-check right before any P3 upgrade.** SOL moves, and other devnet WSOL/devUSDC pools still trade at ~$20, so an arbitrage bot can pull this pool back. Re-run `--measure`, and `--until-within-bps 200` if needed.
- The live run can take more steps than `--plan` predicts. A swap that stops at an array edge leaves the tick one below it, so the next window starts one array earlier. The total input stays the same. Orca accepted the uninitialized tick arrays on the path, so none had to be created.

Practice devUSDC for the swapper comes from Orca's devToken distributor, the one behind the Nebula faucet UI. Each call costs 0.1 SOL and gives 15 devUSDC. The script refuses any wallet except the admin, refuses any cluster except Solana-devnet, and keeps at least 1 SOL:

```bash
node scripts/fund-devusdc-faucet.mjs --once                       # one call; prints SOL/USDC before/after + sig
node scripts/fund-devusdc-faucet.mjs --until 3600 --per-tx 10     # loop until the devUSDC balance reaches the target
```

2026-09-23 run: the pool was moved from 19.96 to 117.37 (0 bps) with 11 swaps and 3,292 devUSDC. Details: [`IMPL-P3-DEVNET-POOL-PRICE-REPORT.md`](../audits/IMPL-P3-DEVNET-POOL-PRICE-REPORT.md).

## Monitoring & Maintenance

### Checking Market Status
**TODO:** no `perma-cli`. Today: `node scripts/reconcile.mjs` prints every range's inventory, escrow balance and both conservation identities; `solana account <pda> -u <cluster>` for raw state.

### Monitoring checklist (P1)

Run from the repo root, with `ANCHOR_PROVIDER_URL` and `ANCHOR_WALLET` exported:

```bash
yarn monitor       # node scripts/reconcile.mjs --monitor
```

Walk the output top to bottom and confirm each line. Every check is a
comparison against what you *expect*; the script cannot know your intent.

1. **Admin custody** — `admin:` is the key you expect to be holding the
   protocol. After a handoff this is the Squads vault, not an EOA. An
   unexpected value here is an incident, not a surprise.
2. **Allowlisted pool** — `allowlisted pool:` is
   `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G`. Anything else means you are
   pointed at the wrong cluster or the wrong deployment.
3. **Pause state** — `is_paused:` matches intent. `true` outside an incident
   means somebody paused and did not say so; `false` during one means the pause
   never landed.
4. **Risk parameters** — `premium_rate` / `premium_multiplier` are unchanged
   (no instruction can set them), and `long_margin_horizon_slots` /
   `long_margin_buffer_usdc` are the values you last set.
5. **Admin event tail** — the decoded `marketPauseSet` / `marketPauseCleared` /
   `marketRiskParamsSet` / `adminTransferred` / `rangeUnwound` events over the
   recent signature window. Every entry should correspond to an action someone
   on the team took. This section is best-effort: an RPC that cannot serve
   history degrades to a `WARN` line and is not a failure.
6. **Escrow identity** — the per-range `vault == pool+dust` lines, then
   `ESCROW IDENTITY HOLDS FOR EVERY RANGE`, then `conservation A/B: 0`. This is
   the part that sets the exit code; the monitor block above never does.

**Exit code**: `0` means both accounting identities hold and every
`open_longs` counter matches. Non-zero means one does not.

**If the identity is broken**: `yarn pause-market` first — that halts
`mint_position`, `deposit_collateral`, `lock_collateral` and the risk-increasing
adapter paths while leaving every exit path open (Exit Guaranteed) — then
investigate with the printed per-range lines. Do not improvise a fix on a live
market; there is no admin path that can move user funds, so there is nothing to
"correct" on-chain by hand.

Known benign case: a non-zero `conservation A/B` on a ledger where
`tests/adapter-liquidity.ts` has run. That harness moves vault tokens directly,
bypassing `UserCollateral` by design. On a ledger that never ran it, non-zero is
a real bug.

### Admin custody / multisig transfer (P1)

`GlobalConfig.admin` is a single pubkey. `transfer_admin` writes that one field
in place, so the admin can become a **Squads vault** and every existing admin
instruction (`pause_market`, `unpause_market`, `set_market_risk_params`,
`unwind_empty_range`, `transfer_admin` itself) then requires a vault-signed
transaction.

**PERMA contains no Squads CPI.** The program does not know what a multisig is;
it checks one signer against one stored pubkey. That is deliberate: making the
pause path depend on another program would put an emergency control behind a
third-party dependency. The cost is that vault creation and proposal routing
happen entirely outside this repo.

Procedure:

1. Create the Squads vault externally (Squads UI or CLI) with the intended
   signer set and threshold. Fund it with SOL for fees.
2. Verify it by executing one harmless transaction from the vault, so you know
   the signer set actually works **before** it holds anything.
3. Read the vault address twice, from two places, and compare character by
   character. A transfer to a key nobody can sign for is unrecoverable: no
   instruction can take the admin back. (`Pubkey::default()` is rejected with
   `InvalidAdmin`, but any other wrong key is accepted.)
4. From `apps/web`, with `.env.local` exported and the **current** admin key in
   `~/.config/solana/id.json`:

   ```bash
   yarn transfer-admin <vault_pubkey>
   ```

   The script prints `admin=` before and after; it is idempotent (transferring
   to the current admin is a no-op that emits nothing).
5. Verify with `yarn monitor`: `admin:` is the vault, and an `adminTransferred`
   entry appears in the event tail.
6. From here on, propose `pause_market` / `unpause_market` /
   `set_market_risk_params` / `unwind_empty_range` as Squads transactions. The
   local scripts above will fail with `Unauthorized` — that is the handoff
   working, not a bug. Rehearse the pause proposal flow in the vault before you
   need it.

**Localnet drill** (run this before doing it for real): `tests/admin-transfer.ts`
performs the whole handoff against a deterministic stand-in keypair — transfer
out, prove the old admin has lost pause / risk-params / transfer, prove the new
admin holds all of them, transfer back. The on-chain contract is identical with
a vault in that role. Run it with the rest of the gate (`RELEASE-GATE.md` §4.2).

### Emergency Pause (component 10)
From `apps/web`, signing with the `GlobalConfig` admin (`~/.config/solana/id.json`), with `.env.local` exported into the shell (`set -a; source .env.local; set +a`):

```bash
yarn pause-market      # Market.is_paused = true  (idempotent; prints before/after)
yarn unpause-market    # Market.is_paused = false
yarn set-risk-params <long_margin_horizon_slots> <long_margin_buffer_usdc>
```

**What a pause does**: blocks `mint_position`, `deposit_collateral`, `lock_collateral`, and the adapter open/add harness (`MarketPaused`). **What it never blocks** (Exit Guaranteed): `burn_position`, `settle_premium`, `withdraw_collateral` (still solvency-gated), `unlock_collateral`, adapter close/remove. Users can always leave. The UI badge reads **Paused**; Deposit and the Trade CTA are disabled; Withdraw / Close / Settle stay live. Full matrix: [`10-pause-admin.md`](../02-mvp-components/10-pause-admin.md).

There is **no global pause** (`pause_global` deferred — one market in Fair MVP, so this is it). The admin key is a **single EOA until a transfer is performed**: P1 ships `transfer_admin` and the procedure below, but no multisig vault holds `GlobalConfig.admin` in this repo's deployments. `set-risk-params` refuses values that would overflow the margin bound (`InvalidRiskParams`) and never touches the premium rate or multiplier.

## Common Issues
- **RPC Timeouts**: Switch to a high-performance RPC (Helius/Triton) if `mint_position` times out. On a local validator, a run that suddenly takes minutes and fails `TransactionExpiredTimeoutError` means the validator has degraded — restart it (`IMPL-08` residual #11).
- **Account-not-found**: Ensure `GlobalConfig` has been initialized for the current cluster.
- **`ELF error: invalid file header`**: the program was built without `--arch v0`.
- **`PoolNotAllowlisted` everywhere**: `tests/factory-rewards.ts` was run against the shared ledger; it needs its own.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
