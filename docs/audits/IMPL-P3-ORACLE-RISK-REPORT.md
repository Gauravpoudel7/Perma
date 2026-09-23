# IMPL-P3 — Oracle + Price-Aware Risk: Implementation Report

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

| Field | Value |
|---|---|
| Date | 2026-09-23 |
| Decision record | [ADR-0004](../adr/ADR-0004-oracle-and-price-aware-risk.md) — **Accepted** |
| Feasibility | [`IMPL-P3-FEASIBILITY.md`](IMPL-P3-FEASIBILITY.md) — **GO WITH BLOCKERS** |
| Result | **Shipped on localnet.** Devnet blocked on P3-DEVNET-POOL-PRICE. |
| Program id | `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt` (unchanged) |
| Pool | `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G`, `tick_spacing` 8 (unchanged) |

## 1. What shipped

The scope is a gate only, as the user chose in Phase 0. `mint_position` checks the oracle for **both legs** before any state change or CPI. Solvency, premium math and every exit path are unchanged.

| Piece | Where |
|---|---|
| Pyth pull `PriceUpdateV2` hand-parser, policy constants, `check_price` (stale → confidence → deviation) and 8 unit tests | `programs/perma/src/oracle.rs` |
| 4 errors appended, codes 6037–6040 (nothing renumbered) | `programs/perma/src/errors.rs` |
| `price_update` account appended to the end of `MintPosition`. `whirlpool` is now required on LONG too (spot read), enforced at runtime via `InvalidAsset` / `WhirlpoolNotAllowlisted`. | `programs/perma/src/lib.rs` |
| Localnet mock receiver (standalone crate, loaded at `rec5EK…` via `--bpf-program` / `[[test.genesis]]`) | `tests/mock-pyth-receiver/`, `scripts/local-validator.sh`, `Anchor.toml` |
| Test price driver (`setPrice`, `freshPrice` with 20 s re-post cache) | `tests/oracle-mock.ts` |
| Price keeper for scripts and the local UI (`--loop` re-posts every 20 s; refuses non-local RPC) | `scripts/mock-price.mjs` |
| Oracle vector suite (8) | `tests/oracle-risk.ts` |
| Web: `priceUpdate` on both mint builders, `whirlpool` on LONG, `NEXT_PUBLIC_PRICE_UPDATE` (defaults to the localnet mock feed), plain copy for the 4 errors | `apps/web/src/lib/{constants,perma,errors}.ts`, `useOpenPosition.ts`, `.env.example`, `scripts/verify-mint-long.ts` |
| IDL sync | `apps/web/src/idl/perma.{json,ts}` (+28 lines each: one account, four errors) |

Existing suites changed **only their mint builders**. Each `mintAccounts` helper now adds `priceUpdate: await freshPrice(provider)`, and each LONG mint stopped overriding `whirlpool` to `null`. No assertion was edited, skipped or deleted. `apps/web/test/errors.test.ts` gained the 4 new variants (count 35 → 39), because it asserts that every user-facing `PermaError` has copy.

Nothing was added to the UI beyond error copy. There is no reference-price display, TWAP label, liquidation distance or mark PnL.

## 2. Gate evidence

The run used a fresh ledger (`./scripts/local-validator.sh --detach` with the mock built, then `solana program deploy`) and the explicit list from `RELEASE-GATE.md` §4.2, with `tests/oracle-risk.ts` inserted before `pause-admin.ts`.

| Check | Result |
|---|---|
| Integration, forward pass 1 | **122 passing / 0 failing** |
| Integration, forward pass 2 (same ledger) | **122 / 0** |
| Integration, reversed (same ledger) | **122 / 0** |
| `yarn test:unit` | **75 passed** (67 + 8 `oracle::tests`) |
| `yarn indexer:test` (`PERMA_INDEXER_PORT=8799`) | **20 / 20** |
| `apps/web` `yarn test` | **75 / 75** (the gate doc previously said 50; the only P3 test change is the error-count update above) |
| `apps/web` `yarn check-copy` | No banned phrases |
| `apps/web` `tsc --noEmit` | clean |
| `node scripts/reconcile.mjs` / `yarn monitor` | escrow identity holds for every range; exit 0 |
| `anchor build --arch v0` | OK; ELF flags 0 |

### Transaction size / CU (`scripts/measure-position.mjs`, localnet)

| Instruction | Before (ADR-0003) | After P3 | Limit |
|---|---|---|---|
| `mint_position` SHORT | 1156 B, 28 accts, ~146k CU | **1189 B, 29 accts, 157,992 CU** | 1232 B |
| `mint_position` LONG, 0 existing | 612 B, 13 accts | **677 B, 15 accts, 35,569 CU** | 1232 B |
| `mint_position` LONG, 7 existing | 843 B | **908 B, 22 accts, 60,615 CU** | 1232 B |
| burn / settle / withdraw | 960 / 476 / 524–755 B | unchanged | — |

Short mint headroom falls from 76 B to **43 B**. A second oracle account (for example Switchboard, or an observation ring) would still fit once. Anything more needs an address lookup table.

## 3. Hard constraints — how each was held

| Constraint | Evidence |
|---|---|
| No price-consuming code before ADR Accepted | ADR-0004 was written and Accepted in Phase 0, before `oracle.rs` existed |
| No P4 (force exercise / liquidation), no bonus or fee numbers, no liquidation UI | `grep -rn "liquidat\|force_exercise" programs/perma/src` has no new hits; the conservative-price rule is written in the ADR only |
| Orca Oracle PDA never a TWAP; spot never used alone | `ORACLE_NO_ORCA_PDA_TWAP` static scan; spot is only ever compared against a validated reference |
| Exit Guaranteed under pause | `ORACLE_PAUSE_INTERACTION`: paused and stale, yet withdraw and burn succeed. `pause-admin.ts` 17/17 unchanged. |
| Events and errors | no event touched; errors appended at 6037+ |
| Program id, pool, tick spacing, premium formulas, Orca CPI metas | unchanged; the only new account is `price_update`, which the ADR requires |
| Premium-horizon coverage | `risk-solvency.ts` passes with no assertion change (`ORACLE_FAIR_HORIZON_REGRESSION`) |
| Local DoD needs no mainnet Pyth RPC | the mock receiver serves every vector offline |
| Uncommitted UI V2 U9 edits | not touched (`CloseSettleAction`, `PositionDetail`, `PositionRow`, `usePositionSummary`, `lib/solvency.ts`, `test/solvency.test.ts`, `COPY-DECK.md`) |

## 4. Residuals

1. **P3-DEVNET-POOL-PRICE (blocker for devnet).** The devnet pool trades near $20/SOL in devUSDC. A real Pyth SOL/USD update would fail `OracleDeviationTooHigh` on every mint. Two fixes are possible: rebalance the pool to about SOL/USD, or re-point the market at a pool that already trades there. The program should not relax the band. Until then, a devnet deploy of this build makes minting impossible. **Do not upgrade the devnet program without resolving this.**
2. **Posting real updates.** On mainnet or devnet the client must post a Pyth update, via Hermes plus the receiver's `post_update`, in the same transaction or just before it. The web app currently reads only a fixed address (`NEXT_PUBLIC_PRICE_UPDATE`). A real posting flow must fit within the short mint's 43 B headroom, or go in a preceding transaction. **Follow-on (2026-09-23):** Solana-devnet posting is implemented as a prior transaction in [`IMPL-P3-DEVNET-UPGRADE.md`](IMPL-P3-DEVNET-UPGRADE.md). The live program was still pre-P3 when that note was written. `post_update_atomic` is not used, because this program requires VerificationLevel Full.
3. **Cherry-picking inside the window.** A minter may choose any valid update from the last 60 s. The 2 % band limits what that can gain. This is accepted and recorded in the ADR.
4. **Switchboard (option B) and the PERMA observation ring (option C)** are deferred. `ORACLE_RING_GAP_FAIL` is N/A.
5. **Conservative-price helper** (`min(spot, price−conf)` for assets and `max(spot, price+conf)` for debts) is specified in the ADR and **not implemented**. P3 has no consumer for it.
6. **Error catalog gap from P1.** `InvalidAdmin` (6035) and `RangeNotEmpty` (6036) are still missing from `ERROR-CATALOG.md` and from the web copy map, because both are admin-only. This predates P3 and was left alone to keep the diff surgical.
7. **`CHANGELOG.md`** was not updated. Add a P3 entry when this is committed.

## 5. P4 entry checklist (docs only — nothing below is built)

- [ ] ADR-0005 (or an ADR-0004 amendment) that names the P4 consumers: `force_exercise` and `liquidate_account` eligibility.
- [ ] Price-valued account equity that uses the ADR-0004 conservative rule. Assets are valued at `min(spot, price−conf)` and debts at `max(spot, price+conf)`. Say explicitly which side the long's option value falls on.
- [ ] A decision on the pause interaction. P3 rejects and never pauses. P4 must decide whether an oracle outage halts liquidations and pauses the market (PRD B30), and must address bad-debt socialisation.
- [ ] Liquidation bonus and force fee: numbers, rationale, and a proof that the numbers cannot be gamed against the 2 % band and the 60 s window.
- [ ] Transaction budget: liquidation needs a price, the victim's open longs and the ranges. Measure against 1232 B and plan lookup tables.
- [ ] P3-DEVNET-POOL-PRICE resolved, so P4 can be exercised on a real feed.
- [ ] UI: liquidation distance only after P4 is live and backed by the same on-chain price the program uses.
