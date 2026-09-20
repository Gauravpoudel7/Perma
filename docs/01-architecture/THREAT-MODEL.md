# THREAT MODEL: PERMA

This document analyzes the potential attack vectors of the PERMA protocol and the corresponding mitigations implemented in the MVP.

## 1. Account & Ownership Attacks

### Spoofed Position Lists
- **Threat**: A user submits a list of positions they don't own to inflate their solvency.
- **Mitigation**: **Explicit PDA Ownership**. The program derives the `Position` PDA using the owner's pubkey: `PDA(["perma_position", market, owner, nonce.to_le_bytes()])`. It is mathematically impossible to reference a position owned by someone else.

### Duplicate Position Inflation
- **Threat**: A user references the same position multiple times in a batch call to artificially increase their balance.
- **Mitigation**: **One position per instruction.** No instruction accepts a list of positions to credit; each `burn_position` / `settle_premium` touches exactly one PDA, and uniqueness is enforced by PDA `init` on `(market, owner, nonce)`. The one place a position *list* is accepted — the open-long set on `withdraw_collateral` / long mint (component 09) — is key-deduplicated and must match `UserCollateral.open_longs` exactly, and it can only *tighten* the gate, never loosen it.

## 2. Market & Price Attacks

### Tick Manipulation
- **Threat**: An attacker uses a flash loan to spike the price of the underlying pool, triggering a mass liquidation of Longs.
- **Mitigation**: **No price-dependent settlement exists in Fair MVP, so the flash-tick vector has no target.** Solvency is computed from token balances and premium liability with no price input ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)); there is no liquidation to trigger; spot `tick_current_index` is read only for tick-range alignment in the adapter. Note that Orca Whirlpool exposes **no observation array or TWAP** — the `Oracle` PDA is adaptive-fee state — so a TWAP gate is not available even in principle without an external source. That is a Part B requirement, gated on a real data source.

### "Free Long" Attack
- **Threat**: A user attempts to open a Long position without any corresponding Short liquidity.
- **Mitigation**: **Inventory Hard-Cap**. `RangePremiumState` tracks `total_short_liquidity` and `total_long_liquidity` per range; `available_short_liquidity()` is derived (never stored). Longs are strictly rejected with `NoShortInventory` if `requested > available`.

## 3. Protocol & Logic Attacks

### Re-entrancy
- **Threat**: Using a CPI call to re-enter the PERMA program and withdraw collateral before the position is marked as `Closed`.
- **Mitigation**: **Checks-Effects-Interactions Pattern**. All internal state updates (e.g., marking a position as `Closed`) happen before any external asset transfers or CPI calls.

### Rounding Attacks
- **Threat**: Creating thousands of tiny positions to profit from rounding errors in premium calculation.
- **Mitigation**: **Floor-with-carry, not per-settle rounding.** A long's payable is floored and the remainder *carried* (`payable_from`), so settle frequency cannot change the total owed — the property that makes the permissionless crank safe (ADR-0002). Short claims floor; the residue stays in the range pool, unclaimable by anyone. Tiny positions gain nothing from rounding because nothing is rounded in their favour. No minimum position size is enforced (only `liquidity > 0`); component 09 adds a flat 1 USDC margin buffer on longs, which makes dust-sized longs uneconomic without making them illegal.

## 4. Operational Risks

### Admin Key Compromise
- **Threat**: An attacker steals the admin key and pauses the market or changes risk parameters.
- **Mitigation**: **Multisig Authority**. The admin key must be a Squads multisig. All critical config changes require M-of-N approval.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
