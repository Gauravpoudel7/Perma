# RUNBOOK: Devnet Operations

> **Status (2026-09-20):** the program is verified on a **local validator** with Orca cloned in (`scripts/local-validator.sh`). A devnet deployment has not been performed yet; the steps below are the intended procedure, and the ones marked **TODO** name tooling that does not exist in the repo.

## Deployment Process

### 1. Program Deployment
```bash
anchor build --arch v0            # --arch v0 is mandatory (RELEASE-GATE.md §4.1)
anchor deploy --provider.cluster devnet
```

### 2. Market Initialization

The allowlisted Whirlpool is resolved and fixed: **`2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G`** (SOL/devUSDC, `tick_spacing = 8`, ~20 USDC/SOL). It is hard-coded in the tests and fixtures — there is no `PERMA_WHIRLPOOL` environment variable. See [`FIXTURES-AND-VECTORS.md`](../06-testing/FIXTURES-AND-VECTORS.md) §6.

`initialize_global_config(pool)` then `create_market()` — both admin-signed, both idempotent-guarded (`init`). **TODO:** no `yarn scripts:init-market` exists; the two calls are made by every test suite's `before()` hook (`tests/factory.ts` is the reference).

### 3. Seeding Liquidity (For Demo)
To ensure longs can be opened, the market needs short liquidity in the demo range **18–22 USDC** (ticks `-40176` / `-38168`). **TODO:** no `yarn scripts:seed-shorts` exists; `tests/position-short.ts`'s `mintShort` helper is the working pattern.

## Monitoring & Maintenance

### Checking Market Status
**TODO:** no `perma-cli`. Today: `node scripts/reconcile.mjs` prints every range's inventory, escrow balance and both conservation identities; `solana account <pda> -u <cluster>` for raw state.

### Emergency Pause — **not available in Fair MVP**
**There is no on-chain pause instruction.** `Market.is_paused` exists and every user instruction checks it, but nothing writes it (component 10 unbuilt). If an anomaly is detected the only mitigations are off-chain: stop the demo, do not publish the program ID, and — on a local validator — reset the ledger. Do **not** plan an incident response around a pause that does not exist.

## Common Issues
- **RPC Timeouts**: Switch to a high-performance RPC (Helius/Triton) if `mint_position` times out. On a local validator, a run that suddenly takes minutes and fails `TransactionExpiredTimeoutError` means the validator has degraded — restart it (`IMPL-08` residual #11).
- **Account-not-found**: Ensure `GlobalConfig` has been initialized for the current cluster.
- **`ELF error: invalid file header`**: the program was built without `--arch v0`.
- **`PoolNotAllowlisted` everywhere**: `tests/factory-rewards.ts` was run against the shared ledger; it needs its own.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
