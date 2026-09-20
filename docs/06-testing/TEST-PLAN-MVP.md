# TEST PLAN: Fair MVP

Live suites (76 integration + 60 unit as of component 09): `tests/adapter.ts` (12), `tests/adapter-liquidity.ts` (8), `tests/collateral.ts` (11), `tests/factory.ts` (9), `tests/factory-rewards.ts` (2, own ledger), `tests/position-short.ts` (7), `tests/position-long.ts` (9), `tests/settle-premium.ts` (10), `tests/risk-solvency.ts` (10). Run recipe: [`RELEASE-GATE.md`](RELEASE-GATE.md) §4.2.

## Core Test Suite

### Suite 0: Adapter & Factory
- [x] **T0.1**: TickArray seeds, alignment, bounds, wrong pool, wrong program, injected remaining accounts — `tests/adapter.ts`.
- [x] **T0.2**: Real Orca CPI round-trip with the `0x1775` / `0x177c` close-sequence regression guards — `tests/adapter-liquidity.ts`.
- [x] **T0.3**: Single-pool allowlist, admin gate, active-rewards rejection (allowlist fires first) — `tests/factory.ts`, `tests/factory-rewards.ts`.

### Suite 1: Collateral Flow — `tests/collateral.ts`
- [x] **T1.1**: Deposit WSOL/devUSDC $\rightarrow$ Verify `UserCollateral` balance.
- [x] **T1.2**: Withdraw valid amount $\rightarrow$ Verify assets returned.
- [x] **T1.3**: Withdraw excessive amount $\rightarrow$ Expect `InsufficientFunds`.
- [x] **T1.4**: Lock / unlock; unlock refused with `PositionsOutstanding` while a short is open.

### Suite 2: Short Position Lifecycle — `tests/position-short.ts`
- [x] **T2.1**: Mint Short $\rightarrow$ Verify `UserCollateral.locked_*` increases by the **observed** spend.
- [x] **T2.2**: Mint Short $\rightarrow$ Verify Orca Whirlpool liquidity increases.
- [x] **T2.3**: Burn Short $\rightarrow$ Orca liquidity removed via the 3-step close $\rightarrow$ locked released, `returned_*` credited (the difference is the realized LP result — no separate P&L step).

### Suite 3: Long Position Lifecycle — `tests/position-long.ts`
- [x] **T3.1**: Mint Long (Short exists) $\rightarrow$ Success.
- [x] **T3.2**: Mint Long (No Short exists) $\rightarrow$ Expect `NoShortInventory`.
- [x] **T3.3**: Mint Long $\rightarrow$ Verify derived `RangePremiumState::available_short_liquidity()` decreases **and `total_short_liquidity` is unchanged**.
- [x] **T3.4**: Short burn blocked by `InventoryInvariantViolated` while longs depend on it.

### Suite 4: Premium & Settlement — `tests/settle-premium.ts`, unit tests in `premium.rs`
- [x] **T4.1**: Wait $N$ slots $\rightarrow$ Verify `GlobalPremiumIndex` increases (unit: `update_index`).
- [x] **T4.2**: Long burn pays premium **in cash** (`vault_b ↓`, `range_vault ↑`, `premium_pool` matches); P&L = 0.
- [x] **T4.3**: Permissionless long crank; settling twice costs exactly what once would (V6 on chain).
- [x] **T4.4**: V5 — a short that exits into an empty pool ends `PendingPremium` and is made whole later; rent refunded.
- [x] **T4.5**: `range_vault.amount == premium_pool + dust` after every settle path; conservation unchanged.

### Suite 5: Risk & Solvency — `tests/risk-solvency.ts` (component 09)
- [x] **R1**: 1 µUSDC free, mint long L=1 $\rightarrow$ `InsolventMint`.
- [x] **R3**: Open long, wait, withdraw below accrued + margin $\rightarrow$ `InsolventWithdrawal`.
- [x] **R4**: Settle, then withdraw the remainder $\rightarrow$ success.
- [x] **R5 / R9**: Remaining-account set incomplete or tampered (omitted, duplicated, another user's, a burned key) $\rightarrow$ `MissingOpenLong`.
- [x] **R7**: No crank between mint and withdraw $\rightarrow$ still `InsolventWithdrawal` (projected index).
- [x] **R8**: Ninth long $\rightarrow$ `TooManyOpenLongs`; a withdraw carrying all eight fits (755 B).
- [x] **R6**: Short burn moves exactly `returned − locked` (+ any premium claimed) — no second P&L step.
- [ ] ~~Market price move $\rightarrow$ solvency status updates~~ — **no price input in Fair MVP** ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)).

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
