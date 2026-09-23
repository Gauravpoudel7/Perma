# IMPL-P3 Feasibility — Oracle + price-aware risk

> Prototype. Not audited. Single pool. Not production mainnet risk capital.

**Verdict: GO WITH BLOCKERS.** [ADR-0004](../adr/ADR-0004-oracle-and-price-aware-risk.md) is **Accepted**. Localnet is fully unblocked. **Blocker (devnet only):** the devnet pool's price does not track SOL/USD, so the deviation gate refuses every devnet mint until the pool is rebalanced (ticket below). Per the ROADMAP, V1 DoD is devnet at P6, so this must close before P6 — it does not block P3 localnet exit.

Checkout: `master` @ `a679c97` (P1 `dd8875e`, P2 + UI V2 in `a679c97`), plus an uncommitted UI V2 U9 settle-dust working tree that P3 builds on and does not touch.

## Q0 — Live inventory

| # | Item | Finding (file:line) |
|---|---|---|
| 1 | ADR-0004 | Absent before this session (`docs/adr/` held 0001–0003). Written and Accepted now. |
| 2 | Solvency call sites | `risk.rs:137` `required_free_usdc`, `:165` `check_withdraw_allowed`, `:195` `check_long_mint_allowed`, `:51/:65` `required_margin(_with)`. Inputs: `UserCollateral`, `PermaPosition`s, projected premium index, `Market`. **No price.** Callers: `lib.rs` `withdraw_collateral` (~`:485`), `mint_long_inner`. |
| 3 | Spot reads | `adapter.rs:89` `get_sqrt_price_x64`, `:95` `get_current_tick` (doc: range-gate/display only). `lib.rs:391` echoes `sqrt_price_x64` in `validate_short_range`. UI `useSpotPrice` / `MarketHeader` "Spot". |
| 4 | Orca Oracle PDA | Zero reads of `volatility_accumulator`, `oracle`, `observation`, `twap` in `programs/perma/src` (comments only, `risk.rs:13-14`). |
| 5 | Errors | Last variants `InvalidAdmin` (6035), `RangeNotEmpty` (6036), `errors.rs:173-185`. `OracleDeviationTooHigh` listed as deferred in `ERROR-CATALOG.md` §7. |
| 6 | Cargo deps | `programs/perma/Cargo.toml`: `anchor-lang 1.2.0`, `orca_whirlpools_client 8.0.0` only. No Pyth or Switchboard. |
| 7 | Tx headroom | ADR-0003 measured: short mint **1156 B** (76 B left), long mint 612 / 843 B, withdraw 524 / 755 B. Re-measured after Slice 2 in the report. |
| 8 | Indexer | `indexer/src/chain.ts:43` defaults `PERMA_INDEXER_PORT` to **8787**, the same port as Headroom. Run with `PERMA_INDEXER_PORT=8799`. P3 does not change the default: it is an env knob, and changing it would silently move the web client. `RELEASE-GATE.md` §4.5 expects **20/20**. |
| 9 | Feed for this pool | Pyth `SOL/USD` `0xef0d…b56d`. Pool `2WUg…ym9G` is WSOL/devUSDC and trades near **$20/SOL** (demo range ticks −40176…−38168 ⇒ ~$18–22). A real feed fails deviation on devnet. Localnet has no Pyth receiver at all. |
| 10 | Stubs | No `observations` module, no `calculate_pnl`, no TWAP helper. |

Gate counts on disk: `RELEASE-GATE.md:9` **114** integration, `:219` **67** unit, `:256` indexer **20**, `:268` web **50**.

## Q1 — In / out

As in the prompt's matrix, with the product owner's scope decisions:

- **Gate only.** Oracle health + spot deviation on `mint_position`. Premium-horizon margin untouched. No WSOL credit, no haircut.
- **Exits stay oracle-free.** Withdraw, burn, settle, and unlock never read the oracle.
- **Option A only.** B and C are deferred. D and E are rejected in writing.
- **Out:** P4 force/liquidation ix and numerics, liquidation-distance UI, fake TWAP, mark PnL, P5, P6, premium math, Orca metas, and event/error reordering.

## Q2 — ADR checklist

All 12 items are in ADR-0004: decision, feed identity + pair policy, staleness + confidence, deviation + meaning of spot, conservative rule, fail-closed, migration map, not-shipped list, Orca PDA rejection, fixture IDs, byte/CU budget, and Accepted status with a date and a decider.

## Q3 — Migration map

See ADR-0004 §Migration map. Only `mint_position` (both legs) is **AUGMENTED**. Every other path is **UNCHANGED** and is proven by the existing suites staying green without edits to their assertions.

## Q4 — Fixtures

Frozen in ADR-0004. `tests/oracle-risk.ts` implements them. `ORACLE_RING_GAP_FAIL` is N/A. `ORACLE_UNAVAILABLE_FAIL` is added (wrong feed / Partial / wrong owner), because account authenticity is its own failure class.

## Q5 — Localnet strategy

The chosen strategy is **mock receiver at the real receiver address** (option 1 in the prompt).

- `tests/mock-pyth-receiver/` is a standalone Anchor 1.2.0 program. It has its own `[workspace]`, so `anchor keys sync` in `RELEASE-GATE.md` §4.1 cannot rewrite its `declare_id!`.
- It is built with `cargo build-sbf --arch v0 --manifest-path tests/mock-pyth-receiver/Cargo.toml --sbf-out-dir target/deploy`.
- `scripts/local-validator.sh` loads it with `--bpf-program rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ target/deploy/mock_pyth_receiver.so`. `Anchor.toml` `[[test.genesis]]` mirrors that.
- The script refuses to start if the `.so` is missing. The alternative is worse: every mint would fail `OracleUnavailable`, and the negative tests would pass for the wrong reason.
- The healthy reference is computed in the test helper from the cloned pool's live `sqrt_price`, using the same formula as the program.

Rejected alternatives:

- **Cloning devnet price accounts.** They cannot be written, so stale, conf, and deviation fixtures are impossible. Their price is also ~$20 away from the pool.
- **Pre-baked `--account` fixtures.** Their `publish_time` goes stale by the time a suite runs.

## Q6 — Tests

- Unit tests in `oracle.rs` cover parse and each check at its boundary.
- `tests/oracle-risk.ts` covers the fixture vectors.
- The seven existing suites that mint are updated to pass `priceUpdate`. Each one refreshes the mock price before minting, so it stays fresh across long suites. Their assertions are unchanged.
- The 114 count is not reduced. The P3 suite is additive.

## Q7 — Docs

The following are updated surgically:

- `ORACLE-AND-RISK-POLICY.md` (now points at the Accepted ADR)
- `ROADMAP.md` P3 status
- `ERROR-CATALOG.md`
- `INSTRUCTIONS.md`
- `09-risk-solvency.md`
- `SECURITY-BASELINE.md` §Oracle
- `RISK-DISCLOSURES.md` §3
- `RELEASE-GATE.md`
- `FIXTURES-AND-VECTORS.md`

## Blocker ticket — P3-DEVNET-POOL-PRICE

- **Problem:** devnet `2WUg…ym9G` trades near $20/SOL in devUSDC. Pyth SOL/USD is the real price. ADR-0004 refuses mints beyond a 2 % deviation.
- **Fix options, for ops:**
  - (a) Swap the devnet pool toward the reference. This needs devUSDC inventory, and devnet arbitrage can drift it back.
  - (b) Create a fresh devnet pool initialized at the reference price, and re-allowlist it. The allowlist has no setter, so this means a new `GlobalConfig` and a redeploy.
- **Owner:** ops, before P6 devnet exit. P3 does not add a devnet bypass flag. A bypass would be exactly the "available-but-wrong" path this ADR refuses.
