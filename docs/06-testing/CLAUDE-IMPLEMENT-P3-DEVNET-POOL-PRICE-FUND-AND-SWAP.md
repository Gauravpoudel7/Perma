# PERMA — Claude Code Prompt: P3-DEVNET-POOL-PRICE Phase A (fund + swap)

**How to use:** New Claude Code chat in `/Users/maxcell/perma/Perma`. Paste everything between `PROMPT` and `END PROMPT`, then the one-liner at the bottom.

**Plugins / wrap:** Ponytail / caveman **OFF**. If indexer is on **8787**, use `headroom wrap claude --port 8788`. Never combine Headroom with a caveman proxy wrap.

**Context:** Phase 0 already finished (**GO WITH BLOCKERS**). Script `scripts/rebalance-devnet-pool.mjs` exists. Feasibility: `docs/audits/IMPL-P3-DEVNET-POOL-PRICE-FEASIBILITY.md`. Human just funded admin with SOL from Phantom. **This session = fund practice USDC via Orca distributor faucet + run the 9 stepped swaps + write the report. No program upgrade.**

---

````text
PROMPT
=====

# Role

You are a senior Solana ops engineer finishing **PERMA ticket P3-DEVNET-POOL-PRICE — Option A Phase A** on public Solana-devnet.

Work in `/Users/maxcell/perma/Perma` on current `main`. Prefer scripts + docs. Do **not** upgrade the live Solana-devnet PERMA program. Do **not** widen `MAX_DEVIATION_BPS`. Do **not** mock Pyth on Solana-devnet. Do **not** close the human’s practice Short/Long.

# Live facts (re-verify; do not trust blindly)

| Fact | Value |
|---|---|
| Pool | `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (WSOL / devUSDC `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k`) |
| Admin / swapper | `7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY` — must equal `ANCHOR_WALLET` / `~/.config/solana/id.json` pubkey |
| Phantom (do not drain) | `EUqgmpDpC1vSMXjHxzhL7AzaS5qKaWFsMVtw7JrXvL38` — leave alone except optional ~52 USDC transfer *to* admin if you want a tiny head start |
| As of fund handoff | Admin ~**27.57 SOL**, **0** devUSDC. Phantom ~**1.15 SOL** left (keep it) |
| Need | Admin **≥ 3,600** practice USDC before live rebalance steps (Phase 0: ~3,277 in + ~10% buffer) |
| Rebalance script | `scripts/rebalance-devnet-pool.mjs` (`--measure`, `--plan`, `--step N`, `--until-within-bps`, genesis-gated) |
| Pyth for gate | On-chain PriceUpdateV2 `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` (Hermes often 401). Env `PYTH_PRICE_ACCOUNT` ok |
| Missing tick arrays on path | `-26048, -25344, -23936, -22528, -21824` — create with Orca `initialize_tick_array` if a step sim fails (~0.07 SOL each, permissionless) |
| Program | Still **pre-P3** on Solana-devnet — **do not upgrade** |

Honesty banner in every written artifact:
`Prototype. Not audited. Single pool. Not production mainnet risk capital.`

# Hard constraints

- Solana-devnet only (refuse mainnet).
- Never upgrade PERMA on Solana-devnet in this session.
- Never mock Pyth / never widen 2% band.
- Never close human practice positions.
- Do not commit `.env.local`, keypairs, or RPC secrets.
- Keep ≥ **1.0 SOL** on admin after funding for fees + possible tick-array rent.
- If faucet math shows you cannot reach 3,600 USDC with remaining SOL, **STOP** and report exact shortfall — do not start live pool swaps.

# Part 1 — Fund admin with practice USDC (Orca / Nebula distributor)

Nebula UI swaps are the same as the Orca tutorial distributor (not a Whirlpool swap on `2WUg…`).

Reference (port into a **new** repo script; do not vendor the whole tutorial kit):

- Program: `Bu2AaWnVoveQT47wP4obpmmZUwK9bN9ah4w6Vaoa93Y9`
- PDA: `3pgfe1L6jcq59uy3LZmmeSCk9mwVvHXjn21nSvNr8D6x`
- Admin account in keys: `3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo`
- Mint: `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k`
- Instruction data (distribute): `BF 2C DF CF A4 EC 7E 3D`
- Account metas (exact order from Orca tutorial `convert_sol_to_dev_token.ts`):
  mint, vault(ATA of PDA), PDA, user(signer writable), userVault(ATA), DEVTOKEN_ADMIN, token program, SystemProgram, AssociatedTokenProgram
- Each call transfers a fixed SOL amount from the user into the distributor and credits a fixed practice-USDC amount (tutorial docs say ~0.1–0.2 SOL → ~10–15 USDC — **measure the first call**; do not assume).

Create `scripts/fund-devusdc-faucet.mjs` that:

1. Refuses non–Solana-devnet (same genesis check style as rebalance script).
2. Loads `ANCHOR_WALLET` / `~/.config/solana/id.json` and asserts pubkey == admin `7eDWS2L8…`.
3. Supports `--once` and `--until 3600` (ui amount), leaves ≥ 1 SOL, prints JSON lines: `{solBefore, solAfter, usdcBefore, usdcAfter, sig}`.
4. Creates user ATA idempotently if missing.
5. Retries transient RPC failures with backoff; aborts on program errors.

Run `--once` first → measure SOL cost and USDC gained → compute remaining calls needed → run `--until 3600` (or loop until target).

Optional: if Phantom still holds ~52 practice USDC, you may skip transferring it (small); do not touch Phantom SOL.

# Part 2 — Rebalance pool (only after admin USDC ≥ 3600)

1. `node scripts/rebalance-devnet-pool.mjs --measure` — record spot, Pyth, bps.
2. `node scripts/rebalance-devnet-pool.mjs --plan` — refresh step list; confirm capital ≤ wallet.
3. Prefer explicit stepped live swaps (`--step N` one at a time) over blind `--until-within-bps`, unless plan is still ~9 steps and each sim is clean. After each live step, re-`--measure`.
4. If sim fails on missing tick array: create the five missing starts listed above (or whichever sim names), then retry that step.
5. Stop when `|spot − pyth| / pyth ≤ 0.02` (≤ 200 bps). Do **not** push past Pyth (script already caps `sqrt_price_limit`).

# Part 3 — Report + ticket checkboxes

Write `docs/audits/IMPL-P3-DEVNET-POOL-PRICE-REPORT.md` with:

- Banner
- Final spot, tick, Pyth, deviation bps
- Total practice USDC in / WSOL out / number of swaps / sig list (or path to JSON logs)
- Tick arrays created (if any)
- Faucet summary (SOL spent, USDC received, call count)
- Confirmation: program still pre-P3; practice positions untouched
- Residual risks (arb drift from other ~$20 pools; re-measure before any upgrade)

Update `docs/audits/P3-DEVNET-POOL-PRICE.md` checklist items 2–4 as done if green.

Update `docs/07-ops-presentation/RUNBOOK-DEVNET.md` §4 only if commands changed.

# Gates

- Prefer existing repo test commands; `yarn test:unit` may need `PATH` to include `~/.cargo/bin`.
- Web typecheck / unit tests if you touch TS; this session should be scripts+docs only.

# Exit

Print a short operator summary:

1. Admin USDC final
2. Pool spot vs Pyth and bps
3. Report path
4. Explicit: **no upgrade performed**
5. Next human step: Solana-devnet **P3 upgrade + Hermes post_update + smoke** (separate session)

If blocked (faucet empty, SOL short, swap sim fails hard), stop with exact balances and the failing step — do not improvise Option B without human GO.

END PROMPT
=====
````

**One-liner to paste after the prompt:**

```text
Start Part 1: verify admin pubkey + balances, add scripts/fund-devusdc-faucet.mjs from the Orca distributor pattern, --once then --until 3600, then Part 2 rebalance, then Part 3 report. No program upgrade.
```
