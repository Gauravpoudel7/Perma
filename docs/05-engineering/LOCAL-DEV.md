# LOCAL DEV: Setup Guide

## Prerequisites

Pinned versions — [`RELEASE-GATE.md`](../06-testing/RELEASE-GATE.md) §1 is the authority; keep this table in sync with it.

| Tool | Pinned |
|---|---|
| Rust | `1.98.1` stable |
| Solana CLI (Agave) | `3.0.0`+ |
| Anchor | `1.2.0` (`avm use 1.2.0`) |
| Node.js | `24.11.1` |
| Yarn | `1.22.x` — the package manager for this repo |
| PostgreSQL | *(planned — no indexer in the repo yet)* |

## Step 1: On-Chain Setup
1. Clone the repo.
2. Build the program:
   ```bash
   anchor build --arch v0   # v3 (the default) is rejected by the local loader
   ```
3. Generate the token fixtures (keyed to your wallet — devUSDC cannot be minted locally), then start the local validator **with Orca, the allowlisted pool, its TickArrays and the fixtures loaded**. PERMA's tests CPI into Orca and fail against a bare validator; the two-clone command in earlier drafts is not enough.
   ```bash
   node scripts/make-fixtures.mjs
   ./scripts/local-validator.sh --detach      # single source of truth for the clone set; mirrors Anchor.toml
   ```
4. Deploy and run the suites (the validator from step 3 is running). Do **not** use bare `anchor test`: it picks up `tests/factory-rewards.ts`, which allowlists a different pool and makes every other suite fail `PoolNotAllowlisted`.
   ```bash
   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json
   anchor deploy --provider.cluster localnet
   npx ts-mocha -p ./tsconfig.json -t 1000000 \
     tests/adapter.ts tests/adapter-liquidity.ts tests/collateral.ts tests/factory.ts \
     tests/position-short.ts tests/position-long.ts tests/settle-premium.ts     # expect 66 passing
   node scripts/reconcile.mjs                                                    # both money identities
   ```

> The allowlisted pool is fixed: **`2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G`** (SOL/devUSDC, `tick_spacing = 8`). It is hard-coded in the tests and fixtures — there is no `PERMA_WHIRLPOOL` environment variable. See [`FIXTURES-AND-VECTORS.md`](../06-testing/FIXTURES-AND-VECTORS.md) §6.

## Step 2: Indexer Setup — **not yet in the repo** (component 11)
1. Configure `.env` with your RPC URL and DB credentials.
2. Run database migrations:
   ```bash
   cd indexer && yarn prisma migrate dev
   ```
3. Start the indexer:
   ```bash
   yarn start
   ```

## Step 3: Frontend Setup

Lives at `apps/web/` — a standalone Next.js package with its own
`package.json`/lockfile, not `app/` (an earlier draft of this doc used that
path before the UI existed; it never shipped there). Full instructions,
including running against the local validator, are in
[`apps/web/README.md`](../../apps/web/README.md):

```bash
cd apps/web
yarn install
cp .env.example .env.local   # point at the local validator; see the README
yarn dev
```

Open `http://localhost:3000` and connect using a Wallet Standard-compliant
browser wallet (Phantom, Solflare, etc.).

## Troubleshooting
- **Port Conflicts**: Ensure 8899 (RPC) is free; `scripts/local-validator.sh` kills any running `solana-test-validator` first.
- **Account Errors**: "Account not initialized" — every suite's `before()` hook creates `GlobalConfig` and the `Market` if absent; run `tests/factory.ts` first on a fresh ledger.
- **Validator degrades after many runs** (a pass takes minutes, `TransactionExpiredTimeoutError`): restart it. `IMPL-08` residual #11.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
