# CLIENT SDK: Integration Guide

The PERMA Client SDK is a TypeScript wrapper around the Anchor program, providing a high-level API for frontend integration.

## Installation
```bash
npm install @perma-protocol/sdk
```

## Basic Usage

### Initialize Client
```typescript
import { PermaClient } from '@perma-protocol/sdk';
import { Connection, PublicKey } from '@solana/web3.js';

const client = new PermaClient({
  connection: new Connection("https://api.devnet.solana.com"),
  wallet: myWalletAdapter,
  programId: new PublicKey("PERMA_PROGRAM_ID"),
});
```

### Deposit Collateral
```typescript
await client.deposit({
  solAmount: 1.5,
  usdcAmount: 100,
});
```

### Open a Short Position
```typescript
const tx = await client.mintShort({
  range: { lower: -200, upper: 200 },
  size: 1000, // in liquidity units
});
await tx.confirm();
```

### Close a Position
```typescript
const tx = await client.burnPosition(positionAddress);
await tx.confirm();
```

## SDK Helper Methods

### `calculatePotentialPnL(position, currentTick)`
Returns a projected P&L based on the current pool price.

### `getSolvencyStatus(user)`
Returns the distance to liquidation and the current margin ratio.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
