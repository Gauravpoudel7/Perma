# RUNBOOK: Devnet Operations

## Deployment Process

### 1. Program Deployment
```bash
anchor deploy --provider.cluster devnet
```

### 2. Market Initialization
Run the seed script to setup the global config and the SOL/USDC market:
```bash
yarn scripts:init-market
```

### 3. Seeding Liquidity (For Demo)
To ensure Longs can be opened, seed the market with initial short liquidity:
```bash
yarn scripts:seed-shorts --amount 10000 --range 180-220
```

## Monitoring & Maintenance

### Checking Market Status
Use the CLI tool to check current liquidity inventory:
```bash
yarn perma-cli get-market-status
```

### Emergency Pause
If an anomaly is detected, immediately pause the market:
```bash
yarn perma-cli pause-market
```

## Common Issues
- **RPC Timeouts**: Switch to a high-performance RPC (Helius/Triton) if `mint_options` times out.
- **Account-not-found**: Ensure the `GlobalConfig` has been initialized for the current cluster.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
