# SECURITY BASELINE: PERMA

## Mandatory Security Checks

### 1. PDA Validation
- Every PDA must be derived using a unique seed set.
- All account inputs must be verified against the expected PDA using `seeds` constraints.

### 2. Asset Protection
- **Vault Isolation**: User assets are held in protocol-controlled vaults.
- **Atomic Transfers**: Asset transfers must happen as the final step of a transaction to prevent re-entrancy.

### 3. Oracle Safety
- **Anti-Flash-Loan**: No risk-critical operation can rely on a single-slot price.
- **TWAP Requirement**: All solvency checks must use the Orca Whirlpool observation window.

### 4. Access Control
- **Admin Authority**: All `GlobalConfig` and `Market` updates must be signed by the admin.
- **Owner Proof**: Position accounts must be signed by the `owner` pubkey.

## Audit Checklist (MVP)
- [ ] No `unwrap()` calls in the `perma` program.
- [ ] All `burn_options` calls settle premium before closing.
- [ ] Solvency is checked *after* every risk-increasing transaction.
- [ ] All CPI calls to Orca are wrapped in slippage checks.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
