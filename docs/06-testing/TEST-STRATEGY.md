# TEST STRATEGY: PERMA

## Testing Pyramid

### 1. Unit Tests (Rust)
- **Focus**: Individual math functions (Premium, P&L, Solvency).
- **Goal**: 100% coverage of calculation edge cases (rounding, overflow).

### 2. Integration Tests (Anchor/TypeScript)
- **Focus**: Instruction flows (e.g., `deposit` $\rightarrow$ `mint_short` $\rightarrow$ `burn`).
- **Environment**: Local validator.
- **Goal**: Verify that PDAs are created and assets move correctly.

### 3. Invariant Tests (Adversarial)
- **Focus**: Breaking the protocol.
- **Scenarios**:
    - Attempt to withdraw while insolvent.
    - Attempt to mint a Long without Short inventory.
    - Manipulate price to trigger false liquidations.

### 4. E2E Tests (Playwright/Frontend)
- **Focus**: User journeys.
- **Goal**: Ensure the UI correctly reflects the on-chain state and handles transaction failures.

## Test Vectors
The team must maintain a set of "frozen vectors" (Input $\rightarrow$ Expected Output) for all economic calculations to ensure consistency between Rust and TypeScript.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
