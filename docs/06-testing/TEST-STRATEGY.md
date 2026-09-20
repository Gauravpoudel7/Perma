# TEST STRATEGY: PERMA

## Testing Pyramid

### 1. Unit Tests (Rust)
- **Focus**: Individual math functions — premium accrual and split (V1–V6), collateral ledger, position transitions, tick math. *(No P&L math exists; solvency helpers arrive with component 09.)*
- **Goal**: every rounding and overflow edge asserted; 54 tests as of component 08 (`yarn test:unit`).

### 2. Integration Tests (Anchor/TypeScript)
- **Focus**: Instruction flows (`deposit_collateral` $\rightarrow$ `mint_position` $\rightarrow$ `settle_premium` $\rightarrow$ `burn_position`), asserted on SPL balances, not just account fields.
- **Environment**: Local validator with Orca cloned in (`scripts/local-validator.sh`); suites are order-independent and re-runnable on one ledger.
- **Goal**: Verify that PDAs are created and assets move correctly.

### 3. Invariant Tests (Adversarial)
- **Focus**: Breaking the protocol.
- **Scenarios**:
    - Attempt to withdraw more than free balance; unlock under an open short (live). Withdraw against open-long accrual (component 09).
    - Attempt to mint a Long without Short inventory.
    - ~~Manipulate price to trigger false liquidations.~~ No liquidation and no price input in Fair MVP; the flash-tick vector has no target (ADR-0003).

### 4. E2E Tests (Playwright/Frontend)
- **Focus**: User journeys.
- **Goal**: Ensure the UI correctly reflects the on-chain state and handles transaction failures.

## Test Vectors
Frozen vectors (Input $\rightarrow$ Expected Output) live in [`FIXTURES-AND-VECTORS.md`](FIXTURES-AND-VECTORS.md) and are encoded as Rust unit tests in `premium.rs`; V5 and V6 also run on chain in `tests/settle-premium.ts`, and `scripts/reconcile.mjs` checks the money identities over RPC. There is no separate TypeScript vector consumer.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
