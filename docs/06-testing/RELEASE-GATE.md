# RELEASE GATE: MVP Demo Readiness

This document defines the hard blocking criteria that must be met before the PERMA MVP is declared "Ready to Present". 

## 🛑 Blocking Criteria (MUST PASS)

### 1. Core Functional Tests (Anchor)
- [ ] **S1. Short-to-Orca**: `mint_options(SHORT)` actually adds liquidity to the target Whirlpool.
- [ ] **S2. Long-Inventory**: `mint_options(LONG)` rejects if no short liquidity exists; succeeds if it does.
- [ ] **S3. Settlement**: `burn_options` correctly calculates P&L + Premium and updates collateral.
- [ ] **S4. Solvency**: `withdraw_collateral` is blocked if it would leave an open position insolvent.

### 2. End-to-End (E2E) Validation
- [ ] **E2E Script**: The `E2E-DEMO-SCRIPT.md` can be executed from start to finish without errors on Devnet.
- [ ] **UI sync**: The frontend correctly displays the current P&L and premium for a live position.

### 3. Quality & Compliance
- [ ] **Disclaimers**: "Prototype. Not audited. Single pool." banner is visible on every page.
- [ ] **Design QA**: All screens pass the `UI-QA-CHECKLIST.md` anti-slop review.

## 🛠️ Verification Commands

### Run All Integration Tests
```bash
anchor test
```

### Run Math Vector Validation
```bash
npm run test:math-vectors
```

### Verify Devnet Deployment
```bash
solana program show <PROGRAM_ID>
```

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
