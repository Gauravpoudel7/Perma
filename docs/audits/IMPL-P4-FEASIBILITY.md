# IMPL-P4 Feasibility — Force exercise + liquidation

> Prototype. Not audited. Single pool. Not production mainnet risk capital.

**Verdict: GO.** [ADR-0005](../adr/ADR-0005-force-exercise-and-liquidation.md) is **Accepted** (2026-09-26). Q1–Q6 were decided from the engineering recommendations after a Panoptic behaviour review (ADR §Panoptic reference). Liquidation is premium-only and reads no price. Force exercise uses a 300-tick band plus the P3 oracle check at 30 s. The numbers are in ADR §3 and `FIXTURES-AND-VECTORS.md` §8. The program already has most of what P4 needs: the validated open-long list, a permissionless settle, the ADR-0001 close order, the P3 oracle read, and pause flags.

Checkout: `master` @ `e3e5a91`, plus the uncommitted Hermes fix (P3 devnet closeout). P3 is shipped on localnet (2026-09-23) and Solana-devnet (2026-09-25).

Spec inputs: [`LIQUIDATION-AND-FORCE-EXERCISE.md`](../09-post-mvp/LIQUIDATION-AND-FORCE-EXERCISE.md), [`ROADMAP.md`](../09-post-mvp/ROADMAP.md) P4, `PRD.md` B20 (`:447`), B21 (`:453`), B30 (`:548`), [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md), [ADR-0004](../adr/ADR-0004-oracle-and-price-aware-risk.md) §Forward.

## Q0 — Live inventory

| # | Item | Finding (file:line) |
|---|---|---|
| 1 | What "insolvent" means today | `risk.rs:137` `required_free_usdc` = legacy `premium_owed_usdc` + Σ per open long (`payable_if_settled_now` + `required_margin`). `risk.rs:51/:65` margin = `ceil(horizon × rate × L × mult / 1e12) + buffer`. **No price anywhere** (`risk.rs:12-17`). Only longs owe; a short owes nothing and its collateral is its own locked tokens. |
| 2 | Where solvency is enforced | Only at entry and exit of free USDC: `risk.rs:165` `check_withdraw_allowed` (from `lib.rs:463` `withdraw_collateral`, list at `lib.rs:477`) and `risk.rs:195` `check_long_mint_allowed` (from `lib.rs:1999` `mint_long_inner`). Nothing reacts when time makes an open long unpayable. |
| 3 | The stuck long | `lib.rs:1916` `pay_long_premium_cash` → `collateral::debit_usdc` fails the whole burn when free USDC is short (comment at `lib.rs:1925-1926`), so an unpayable long stays `Open`. `lib.rs:1449` `settle_long_cash` fails the same way (`InsufficientCollateralForLoss`). This is the Fair limitation P4 removes. |
| 4 | Who may close | `BurnPosition` requires `owner: Signer` with `has_one = owner` (`lib.rs:2464-2480`). No third-party close path exists. `settle_premium` is already permissionless for LONG (`lib.rs:821-824`), and its floor-with-carry rule (`lib.rs:1461-1463`) is what makes a stranger's call safe. P4 reuses that argument. |
| 5 | What a long is | Accounting only: `mint_long_inner` (`lib.rs:1999`) makes no Orca CPI; it adds `size` to `range.total_long_liquidity` and never touches `total_short_liquidity`. `state.rs:268` `available_short_liquidity` is derived. |
| 6 | Why force exercise matters | A short cannot burn below the longs relying on it: `lib.rs:990-993` `remaining >= total_long_liquidity` else `InventoryInvariantViolated`. A long that never closes pins that short's Orca liquidity forever. Force exercise is the only way out for the seller. |
| 7 | Open-long list validation | `risk.rs:230` `collect_open_longs`: `Account::try_from` (discriminator + owner), PDA re-derive, market/owner/leg/status match, no duplicates, `count == open_longs` in both directions. This already defeats `SPOOF_POSITION_LIST` for the whole-account case. `MAX_OPEN_LONGS = 8` (`risk.rs:42`) bounds the list. |
| 8 | Oracle read | `oracle.rs:67` `load_price_update` (owner = receiver, Full verification, SOL/USD feed); `oracle.rs:111` `check_price` staleness → confidence → deviation; constants `oracle.rs:47-49` (60 s / 100 bps / 200 bps). Called only from `lib.rs:632` (mint). `oracle.rs:17-18`: **not on any exit path**, so an outage cannot trap funds. ADR-0004 `:71` defines the conservative rule `min(spot, price − conf)` / `max(spot, price + conf)`, consumed by P4. |
| 9 | Oracle weakness P4 must not inherit | ADR-0004 §Consequences: a caller may pass any verified update younger than 60 s ("cherry-picking"). P4 eligibility needs a tighter window and/or `posted_slot` monotonicity. The receiver's `posted_slot` is at the end of the 133 B layout (`oracle.rs:42-43`) but is not parsed today. |
| 10 | Pause | `lib.rs:152/:168` pause/unpause. `is_paused` is checked by deposit `:407`, lock `:545`, mint `:615`, and the harness `:1047/:1189`. **Not** by withdraw, settle or burn: exits stay open while paused. |
| 11 | Orca close order | `lib.rs:953-976`: `decrease_liquidity_v2` → `collect_fees_v2` → `close_position`, never `update_fees_and_rewards` in between (ADR-0001). A liquidation that closes a short must reuse `remove_liquidity_for_short` + `close_position_for_short` as-is. |
| 12 | Errors / events | 41 `PermaError` variants, last `OracleDeviationTooHigh` 6040 (`errors.rs:200`). Events `ShortMinted`, `LongMinted`, `PremiumSettled`, `LongBurned`, `ShortBurned` (`lib.rs:3156-3213`). The indexer's `/liquidations` is hard-wired to `[]` (`RELEASE-GATE.md` §4.5). |
| 13 | Long P&L | 0 at burn (`risk.rs:16`, ADR-0004 `:85`). There is no counterparty that could pay intrinsic value. Any "exercise" payout beyond premium would be new money and needs its own funding decision. |

## Q1 — Solana limits

- **Accounts per tx.** A liquidation that closes every long of one user carries `UserCollateral` + market + premium index + up to 8 longs + one `RangePremiumState` + range vault per distinct range. Longs in different ranges multiply the range accounts. **Design for one long per instruction.** Liquidation is then a sequence of `liquidate_long` calls, each re-checking insolvency, as the spec already prefers ("one distressed account per tx", "batched closes, not one mega-ix").
- **Whole-account check vs one-long close.** Eligibility is a whole-account fact (`required_free_usdc` over *all* longs), so each call must still carry the full open-long list (item 7). At 32 B per key and ≤ 8 longs this fits: ADR-0003 measured withdraw at 524 / 755 B.
- **Shorts are not liquidated.** A short owes nothing (item 1). Closing a short would need the 11+ Orca accounts at ~1156 B (short-mint measurement, `IMPL-P3-FEASIBILITY.md` Q0 #7) and would buy nothing for solvency. P4 v1 liquidates longs only. If ADR-0005 Q1 later brings short P&L into account value, the Orca close is per-position and gets its own transaction.
- **CU.** No new heavy math: `collect_open_longs` + `payable_if_settled_now` × 8 + one oracle parse. The measurement comes in Phase 1 against the existing 200k default.

## Q2 — What P4 must add (ADR-0005 Accepted)

1. `liquidate_long` (permissionless or keeper, per Q5): whole-account insolvency check → pay what free USDC covers into the range vault → the unpaid rest is bad debt (per ADR-0005: pause, never socialize) → bonus (Q2) → `close_long` bookkeeping → `LongLiquidated` event.
2. `force_exercise` (the exercisor signs and pays the fee): OOR eligibility against a checked reference, never a single tick → settle the long's premium → fee to the exercisee (Q3) → `close_long` → `LongForceExercised` event.
3. Oracle: force exercise calls `load_price_update` + `check_price` with a 30 s window (ADR-0005 §6). No new wrapper and no `posted_slot` check: the 300-tick band makes the reference unambiguous. The mint gate does not change.
4. Errors appended after 6040. The indexer `/liquidations` and the client refusal of a non-empty array (`RELEASE-GATE.md` §4.5) change in a later web slice.
5. Named vectors: see ADR-0005 §Test vectors.

Still out of scope: the liquidation-distance UI (the `perma-fair-surface` skill blocks it), P5 multi-leg, P6 Raydium.

## Q3 — Risks

| Risk | Mitigation |
|---|---|
| Cherry-picked oracle update (item 9) | Liquidation reads no price. Force exercise uses 30 s, and the 300-tick band exceeds deviation + confidence. |
| Spot manipulation to force-exercise a long | OOR is judged against the reference, and spot must agree with it (the existing 200 bps deviation check). Never a single tick. |
| Griefing liquidator splits a close to farm bonus | Bonus ≤ the maintenance margin the close releases, and eligibility is re-checked every call (ADR-0005 §1). |
| Oracle outage traps an insolvent long | By design, an outage **refuses** liquidation (fail closed) but never blocks the owner's own burn/withdraw, which have no oracle (item 8). |
| Bad debt | PRD B30: halt the market (`pause_market`), never silent socialization. The short keeps its unpaid claim as `premium_receivable` (existing carry). |

## Verdict

**GO**: ADR-0005 is Accepted, so Phase 1 code may start.
