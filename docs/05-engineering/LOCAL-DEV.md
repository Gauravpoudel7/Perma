# LOCAL DEV: Setup Guide

## Prerequisites
- **Rust**: Latest stable version.
- **Solana CLI**: v1.17+
- **Anchor**: v0.29+
- **Node.js**: v18+
- **PostgreSQL**: Local instance for indexer.

## Step 1: On-Chain Setup
1. Clone the repo.
2. Build the program:
   ```bash
   anchor build
   ```
3. Start the local validator:
   ```bash
   solana-test-validator
   ```
4. Run initial tests to verify the environment:
   ```bash
   anchor test
   ```

## Step 2: Indexer Setup
1. Configure `.env` with your RPC URL and DB credentials.
2. Run database migrations:
   ```bash
   cd indexer && npx prisma migrate dev
   ```
3. Start the indexer:
   ```bash
   npm run start
   ```

## Step 3: Frontend Setup
1. Install dependencies:
   ```bash
   cd app && npm install
   ```
2. Start the dev server:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:3000` and connect using a local Solana wallet.

## Troubleshooting
- **Port Conflicts**: Ensure 8899 (RPC) and 5432 (DB) are free.
- **Account Errors**: If you see "Account not initialized", run the `initialize_global_config` instruction via the CLI or a seed script.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
