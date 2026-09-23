# ADR 0004: Oracle + price-aware risk (Protocol V1 P3)

**Date**: 2026-09-23
**Status**: Accepted
**Decider(s)**: PERMA engineering (scope confirmed by the product owner 2026-09-23: gate-only, localnet now, devnet as ticket)
**Supersedes (scoped)**: [ADR-0003](ADR-0003-fair-mvp-risk-model.md) §Decision sentence "Spot `tick_current_index` remains display / range-gating only" — **for `mint_position` only**, which now also compares spot against an external reference. Every other ADR-0003 decision stands unchanged (see the migration map).
**Problem statement**: [`ORACLE-AND-RISK-POLICY.md`](../09-post-mvp/ORACLE-AND-RISK-POLICY.md). Feasibility: [`IMPL-P3-FEASIBILITY.md`](../audits/IMPL-P3-FEASIBILITY.md).

### Context

ADR-0003 made solvency a token-and-time computation: no price is read anywhere in `risk.rs`, and Orca spot (`sqrt_price`, `tick_current_index`) is used for range gating only. That was right for Fair MVP and remains right for everything the protocol can currently *do* with a price: a long burns at P&L = 0 (no funded counterparty until P4), there is no liquidation, and margin is premium over a horizon, which is price-independent.

What the protocol *does* do at spot is deposit into Orca. `mint_position(SHORT)` adds liquidity at whatever the Whirlpool price is inside the transaction, and `mint_position(LONG)` removes it. Nothing today checks that the pool price is sane. A sandwich (or a thin devnet pool drifting) mints PERMA positions against a manipulated price, and P4 cannot build force-exercise or liquidation on top of a spot the protocol has never compared to anything.

P3 therefore adds one thing: a **fail-closed external reference price**, checked on the risk-increasing mint path, packaged so P4 can consume the same checked value.

### Options considered

**1. Source** (the option table in `ORACLE-AND-RISK-POLICY.md`):

- **A — Pyth pull (`PriceUpdateV2`).** Confidence interval is on-chain and usable for fail-closed; Solana-native; verified-by-Wormhole updates anyone can post. *Chosen.*
- **B — Switchboard.** Same failure class (staleness, confidence), second integration cost, no gain for one market. *Deferred* (vendor diversity is a post-V1 concern).
- **C — PERMA observation ring.** Would need a writable account on short mint (76 B headroom, ADR-0003 measured), is only as dense as PERMA's own traffic, and is derived from the same manipulable spot. *Deferred.* Nothing in P3 needs it; `ORACLE_RING_GAP_FAIL` is N/A.
- **D — Whirlpool `Oracle` PDA as TWAP.** *Rejected.* In `orca_whirlpools_client` 8.0.0 that account is adaptive-fee state (`volatility_accumulator`, `tick_group_index_reference`, timestamps), not a price ring. PERMA never reads it.
- **E — Spot only.** *Rejected* (`PRD.md` B5.5). Spot is never a risk input on its own; it is the thing being checked.

**2. How to read Pyth.**

- **2a — `pyth-solana-receiver-sdk` 2.0.0.** Compatible with `anchor-lang ^1.0.2` (no second anchor), but pulls `pythnet-sdk` 3.0.0 and its tree (`bincode`, `serde`, `sha3`, `slow_primes`, `fast-math`, `pyth-sdk`) into the on-chain binary for what is a fixed 134-byte account.
- **2b — Hand-parse the account** with an owner check, the 8-byte discriminator, a verification-level byte, and fixed offsets. ~40 lines, unit-tested against a byte-built fixture. *Chosen*, the same zero-new-dependency reasoning as ADR-0001 / `IMPL-01-FEASIBILITY.md` §3.

**3. What does "price-aware" change in P3?**

- **3a — Gate only.** Premium-horizon margin untouched; mints must pass oracle health + spot deviation. *Chosen.*
- **3b — Count free WSOL toward long margin at a conservative price with a haircut.** *Rejected for P3*: loosens a rule that is currently conservative, and needs an invented haircut number.
- **3c — Also gate `withdraw_collateral` when the user has open longs.** *Rejected*: an oracle outage would lock user funds on a path whose solvency math reads no price. Exit must never depend on a third party.

**4. On failure: reject or pause?**

- **4a — Reject the instruction.** *Chosen.* A failed transaction cannot write a pause flag anyway, and a mint that is refused has created no exposure.
- **4b — Auto-pause the market.** *Rejected*: needs a successful write on a failure path, and `is_paused` would then also be flipped by anyone who can post a stale update. Manual `pause_market` (component 10) remains the admin tool.

### Decision

**Source.** Pyth pull oracle, `PriceUpdateV2` accounts owned by the Pyth Solana Receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`.

**Feed identity.** `SOL/USD` = `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` (same id on every cluster). **Pair policy:** the allowlisted pool is WSOL / devUSDC; devUSDC is treated as **USD 1:1**. That is a demo assumption for a devnet test token, not a claim about USDC; a mainnet market would compose with a `USDC/USD` feed under a new ADR.

**Account validation** (all failures → `OracleUnavailable`):

1. owner == receiver program id;
2. data length ≥ 133 and discriminator == `[34, 241, 35, 99, 157, 126, 244, 205]` (`sha256("account:PriceUpdateV2")[..8]`);
3. `verification_level` == `Full` (borsh variant byte `1`); `Partial` is refused;
4. `feed_id` == the SOL/USD id above;
5. `price > 0` and `-12 ≤ exponent ≤ 0`.

Which account is passed is the caller's choice — Pyth's pull model lets anyone post a verified update. Authenticity comes from (1)–(4); freshness from the staleness rule. A caller can therefore pick *any* verified update inside the staleness window; see Consequences.

**Numeric policy** (named constants in `programs/perma/src/oracle.rs`; demo values, changed only by amending this ADR):

| Constant | Value | Rule | Error |
|---|---|---|---|
| `MAX_STALENESS_SECS` | **60** | `Clock.unix_timestamp − publish_time > 60` fails. A `publish_time` ahead of the clock is accepted (validator clocks lag; same as the Pyth SDK). | `OracleStale` |
| `MAX_CONF_BPS` | **100** (1 %) | `conf × 10_000 > 100 × price` fails. | `OracleConfidenceTooWide` |
| `MAX_DEVIATION_BPS` | **200** (2 %) | `|spot − price| × 10_000 > 200 × price` fails. | `OracleDeviationTooHigh` |

**What "spot" means.** `Whirlpool.sqrt_price` of `market.whirlpool`, read from the same account the short path already loads, converted to Pyth units: `spot = (sqrt_price >> 32)² × 10^(dec_a − dec_b) × 10^(−exponent) / 2^64`, with `dec_a − dec_b = 9 − 6 = 3` (WSOL / devUSDC; a named constant — P6 moves it onto `Market`). Checked arithmetic; overflow fails `MathOverflow`. The `>> 32` keeps ~32 bits of sqrt precision, several orders of magnitude finer than 1 bp. **Spot is compared, never used as the price.**

**Checks run in this order**: validate account → staleness → confidence → deviation. The first failure is the error returned.

**Conservative price selection** (defined now, *consumed by P4*, not implemented in P3 because nothing in P3 values anything): when valuing what a user *has*, use `min(spot, price − conf)`; when valuing what a user *owes*, use `max(spot, price + conf)`; both only after the deviation check above passed in the same instruction.

**Fail-closed.** Every failure rejects the instruction. No auto-pause, no fallback source, no "last good price". Exit paths never read the oracle, so an outage cannot block a burn, settle, unlock or withdraw.

### Migration map from ADR-0003

| Path | ADR-0003 today | After ADR-0004 |
|---|---|---|
| `mint_position(SHORT)` | pause → range gate at spot → locked-spend collateral | **AUGMENTED**: oracle gate runs after the pause and leg checks, before the premium prefix and any CPI. New required account `price_update`. Everything after is byte-for-byte the same logic. |
| `mint_position(LONG)` | pause → inventory → `TooManyOpenLongs` → `InsolventMint` (premium-horizon) | **AUGMENTED**: same oracle gate, same position. A long now passes `whirlpool` (was `null`) so spot is readable. `required_margin` / `check_long_mint_allowed` **UNCHANGED**. |
| `withdraw_collateral` | `check_withdraw_allowed` (premium-horizon) | **UNCHANGED** — no oracle account, no price. |
| `required_margin*`, `required_free_usdc`, `validate_risk_params` | premium × horizon + buffer | **UNCHANGED** — premium-horizon remains the floor on long debt. |
| `deposit_collateral`, `lock_collateral`, `unlock_collateral` | balances only | **UNCHANGED** |
| `burn_position` (both legs), `settle_premium` | Exit Guaranteed under pause | **UNCHANGED** — never reads the oracle. |
| Long burn P&L | 0 | **0** (intrinsic needs the P4 counterparty) |
| Short burn LP result | `returned − locked`, once | **UNCHANGED** |
| `adapter_open_position` / `adapter_add_liquidity` | harness paths, spot deposit, refused on ranges with longs | **UNCHANGED** — no PERMA position or solvency figure depends on them. Revisit if P4 routes through them. |
| Liquidation / force exercise | absent | **absent** |
| UI spot | display-only, labeled "Spot" | **UNCHANGED**. No reference-price display is required by this ADR. Never "TWAP", never "Orca oracle". |

### Localnet strategy

The allowlisted pool is cloned from devnet, so its spot cannot be moved cheaply, and real Pyth accounts cannot be written. A **mock receiver** (`tests/mock-pyth-receiver/`, a standalone Anchor program outside the workspace so `anchor keys sync` never rewrites its id) is loaded at the real receiver address with `solana-test-validator --bpf-program rec5EK… …`. It writes a `PriceUpdateV2`-layout account (same struct name ⇒ same discriminator) at PDA `["price_feed", feed_id]` with a setter for price, conf, exponent, age (seconds before the validator clock), verification level and feed id. Spike and deviation fixtures move the **reference** against the fixed cloned spot; the check is symmetric in `|spot − price|`, and the fixture doc says so. The mock is **never** deployed to devnet.

### Fixture vectors (frozen before numbers were hardcoded)

| ID | Intent | Expected |
|---|---|---|
| `ORACLE_HEALTHY_OK` | fresh, Full, tight conf, reference == spot | short and long mint succeed |
| `ORACLE_STALE_FAIL` | age 61 s | `OracleStale` |
| `ORACLE_CONF_WIDE_FAIL` | conf = 1.01 % of price | `OracleConfidenceTooWide` |
| `ORACLE_SPOT_SPIKE_FAIL` | spot 5 % away from a healthy reference (driven from the reference side) | `OracleDeviationTooHigh` |
| `ORACLE_DEVIATION_FAIL` | 2.01 % off — one step past the limit; 1.99 % passes | `OracleDeviationTooHigh` |
| `ORACLE_UNAVAILABLE_FAIL` | wrong feed id / `Partial` / non-receiver owner | `OracleUnavailable` |
| `ORACLE_RING_GAP_FAIL` | — | **N/A** (option C deferred) |
| `ORACLE_PAUSE_INTERACTION` | stale oracle + paused market | mint `MarketPaused`; burn and withdraw succeed |
| `ORACLE_FAIR_HORIZON_REGRESSION` | existing `risk-solvency.ts` + `risk.rs` unit vectors | unchanged, green |
| `ORACLE_NO_ORCA_PDA_TWAP` | static: no `volatility_accumulator` / Orca `oracle` seed read in `programs/perma/src` | zero hits |

### Account / CU budget

`price_update` is one read-only account: +33 B (32 B key + 1 B index) on short mint, whose ADR-0003 baseline is 1156 B of 1232 B. A long mint adds `price_update` and `whirlpool`: +66 B on 612 B (no longs) / 843 B (seven). Parsing is a fixed-offset read plus ~10 checked u128 ops — negligible against the mint's CPI cost. Measured (`scripts/measure-position.mjs`, localnet): short mint **1189 B** (43 B headroom, 157,992 CU), long mint **677 B / 908 B**. Full table in [`IMPL-P3-ORACLE-RISK-REPORT.md`](../audits/IMPL-P3-ORACLE-RISK-REPORT.md).

### Errors

Appended to `PermaError` after `RangeNotEmpty` (6036), so no existing code shifts: `OracleUnavailable` 6037, `OracleStale` 6038, `OracleConfidenceTooWide` 6039, `OracleDeviationTooHigh` 6040. No new events: a refused mint emits nothing today and the error name is in the transaction log.

### Consequences

- **Positive**: every new PERMA exposure is opened only at a pool price within 2 % of a fresh, confident, externally verified reference. P4 gets a single checked read to build on. No Fair behaviour outside `mint_position` moved.
- **Negative, accepted**:
  - **Mints now depend on Pyth.** An outage or a wide-confidence period refuses mints. That is the fail-closed choice; exits are unaffected.
  - **Cherry-picking inside the window.** A caller may pass any verified update younger than 60 s, i.e. the most favourable price of the last minute. For a ±2 % sanity gate this is immaterial; **P4 must not inherit it** for liquidation eligibility (tighter window or `posted_slot` monotonicity there).
  - **Devnet is blocked.** The devnet pool trades near $20/SOL in devUSDC, far from real SOL/USD, so every devnet mint fails `OracleDeviationTooHigh` until the pool is rebalanced toward the reference (ops ticket in the feasibility doc). Protocol V1 DoD is devnet at P6; this must be closed before then.
  - **Account list grew.** Every `mint_position` client must pass `price_update`, and a long must pass `whirlpool`. The web app and all mint-building tests are updated.

### Still not shipped

Force exercise, liquidation, liquidation bonus / force fee, long intrinsic credit, marking positions to a price, WSOL-as-margin, multi-leg portfolio margin, a reference-price UI, Switchboard, a PERMA ring.

### Forward (P4 — interfaces only, no code in P3)

P4 reads the same account through `oracle::load_price_update` + the same checks, then applies the conservative selection rule above. P4 decides its own staleness (likely tighter), and its bonus / fee numbers belong to its own ADR.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
