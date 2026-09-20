# E2E DEMO SCRIPT: The "Fair" Walkthrough

## Goal
Demonstrate the full perpetual option lifecycle in under 3 minutes.

## Scenario: The SOL Volatility Trade

### Step 1: Setup (The Operator)
- **Action**: Call `create_market` for SOL/USDC.
- **Action**: Open a Short position for range **[$18, $22]** (the pool trades ~20 USDC/SOL; ticks −40176 / −38168) with 100,000,000 liquidity units.
- **Result**: Market now has "Short Inventory".

### Step 2: The Buyer (Alice)
- **Action**: Connect wallet $\rightarrow$ Deposit 10 USDC.
- **Action**: Open a Long position for range [$18, $22] with 50,000,000 liquidity units. *(Needs ≥ 51 USDC free — the component-09 margin, `L µUSDC + 1 USDC`.)*
- **Result**: Long position created; Alice begins accruing streaming premium.

### Step 3: Time + Price Move
- **Action**: Wait for 100 slots (or advance clock in tests).
- **Action**: (optional) Simulate a price move to $21 — it changes nothing on chain; Fair MVP values nothing against a price.
- **Result**: Explorer / `scripts/reconcile.mjs` shows premium accruing (`GlobalPremiumIndex`) and the range escrow filling on each settle.

### Step 4: The Close (Settlement)
- **Action**: Alice burns her Long position.
- **Result**: Accrued premium paid **in cash** into the range vault; position closed with P&L = 0 ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)).
- **Action**: Operator burns the Short position.
- **Result**: Premium claimed from the escrow; Orca liquidity withdrawn; what Orca returned is credited (the realized LP result).

### Step 5: Verification
- **Action**: Show explorer links for all 4 transactions.
- **Action**: Verify final collateral balances.
