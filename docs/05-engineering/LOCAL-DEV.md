# LOCAL DEV: Setup Guide

## Prerequisites

Pinned versions — [`RELEASE-GATE.md`](../06-testing/RELEASE-GATE.md) §1 is the authority; keep this table in sync with it.

| Tool | Pinned |
|---|---|
| Rust | `1.79.0` stable |
| Solana CLI | `1.18.17` |
| Anchor | `0.30.1` (`avm use 0.30.1`) |
| Node.js | `20.11.0` LTS |
| Yarn | `1.22.x` — the package manager for this repo |
| PostgreSQL | Local instance, for the indexer only |

## Step 1: On-Chain Setup
1. Clone the repo.
2. Build the program:
   ```bash
   anchor build
   ```
3. Start the local validator **with the Orca Whirlpool program cloned in** — PERMA's tests CPI into Orca and fail against a bare validator. Use the full command in [`RELEASE-GATE.md`](../06-testing/RELEASE-GATE.md) §3:
   ```bash
   solana-test-validator --reset --url https://api.devnet.solana.com \
     --clone-upgradeable-program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc \
     --clone FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
   ```
4. Run initial tests to verify the environment (the validator from step 3 is already running):
   ```bash
   anchor test --skip-local-validator
   ```

## Step 2: Indexer Setup
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
1. Install dependencies:
   ```bash
   cd app && yarn install
   ```
2. Start the dev server:
   ```bash
   yarn dev
   ```
3. Open `http://localhost:3000` and connect using a local Solana wallet.

## Troubleshooting
- **Port Conflicts**: Ensure 8899 (RPC) and 5432 (DB) are free.
- **Account Errors**: If you see "Account not initialized", run the `initialize_global_config` instruction via the CLI or a seed script.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
