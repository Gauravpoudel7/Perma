# SECURITY BASELINE: PERMA

## Mandatory Security Checks

### 1. PDA Validation
- Every PDA must be derived using a unique seed set.
- All account inputs must be verified against the expected PDA using `seeds` constraints.

### 2. Asset Protection
- **Vault Isolation**: User assets are held in protocol-controlled vaults.
- **Atomic Transfers**: Asset transfers must happen as the final step of a transaction to prevent re-entrancy.

### 3. Oracle Safety
- **Fair MVP: no price-dependent risk operation exists.** Solvency is computed from token balances and premium liability with no price input ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)); there is no liquidation. Spot `tick_current_index` is read only for tick-range alignment. A flash-tick therefore has nothing to trigger.
- **Orca has no TWAP.** `orca_whirlpools_client` 8.0.0 exposes no observation window; the `Oracle` PDA is adaptive-fee state. Any future price-dependent operation (Part B: liquidation, force-exercise, intrinsic-value settlement) **must first obtain a manipulation-resistant price from an external source** — it cannot be built from the pool alone. That is a Part B requirement, not an enforced baseline today.

### 4. Access Control
- **Admin Authority**: All `GlobalConfig` and `Market` updates must be signed by the admin.
- **Owner Proof**: Position accounts must be signed by the `owner` pubkey.

## Audit Checklist (MVP)
- [ ] No `unwrap()` calls in the `perma` program.
- [x] `burn_position` settles premium **in cash** before closing on both legs; `settle_premium` is also available standalone. No liability is ever cleared without a transfer (08).
- [x] Solvency is checked *before* mutation on every risk-increasing path: withdraw and long mint both count open-long premium liability (index projected to now) plus a horizon margin (component 09, ADR-0003).
- [ ] All CPI calls to Orca are wrapped in slippage checks.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
