# E2E DEMO SCRIPT: The "Fair" Walkthrough

## Goal
Demonstrate the full perpetual option lifecycle in under 3 minutes.

## Scenario: The SOL Volatility Trade

### Step 1: Setup (The Operator)
- **Action**: Call `create_market` for SOL/USDC.
- **Action**: Open a Short position for range [$180, $220] with 10,000 units.
- **Result**: Market now has "Short Inventory".

### Step 2: The Buyer (Alice)
- **Action**: Connect wallet $\rightarrow$ Deposit 10 USDC.
- **Action**: Open a Long position for range [$180, $220] with 5,000 units.
- **Result**: Long position created; Alice begins accruing streaming premium.

### Step 3: Time + Price Move
- **Action**: Wait for 100 slots (or advance clock in tests).
- **Action**: Simulate price move to $210.
- **Result**: UI shows premium rising and P&L shifting.

### Step 4: The Close (Settlement)
- **Action**: Alice burns her Long position.
- **Result**: Premium + P&L settled into her collateral.
- **Action**: Operator burns the Short position.
- **Result**: Assets returned to operator.

### Step 5: Verification
- **Action**: Show explorer links for all 4 transactions.
- **Action**: Verify final collateral balances.
