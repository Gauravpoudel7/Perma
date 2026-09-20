# Component 01B — Liquidity CPI Execution Report

**Date**: 2026-09-19
**Phase 0 gate**: [`IMPL-01B-FEASIBILITY.md`](IMPL-01B-FEASIBILITY.md) — **GO**
**Closes**: [`IMPL-01-CLMM-ADAPTER-REPORT.md`](IMPL-01-CLMM-ADAPTER-REPORT.md) §5

## Status: **gap closed**

Real tokens now move through Orca. `increase_liquidity_v2` lands, the 3-step close completes, the Orca position is burned and its rent reclaimed, and both regression guards were **executed** against the cloned pool.

| Suite | Result |
|---|---|
| Rust unit (`cargo test -p perma --lib`) | **8 / 8** |
| Validation (`tests/adapter.ts`) | **12 / 12** |
| **Liquidity (`tests/adapter-liquidity.ts`)** | **8 / 8** |
| Re-runnable without validator reset | ✅ verified twice |

**The strongest single signal:** observed on-chain token deltas match the Whirlpool math computed independently in Python, to the unit.

| | Observed | Predicted |
|---|---|---|
| WSOL | `33 539 757` | `33 539 757` |
| devUSDC | `713 885` | `713 885` |

---

## 1. It was never only a fixture problem

Phase 0 found three defects that made the liquidity path unreachable:

1. **`close_position` was never implemented.** It existed only in comments — no `ClosePositionCpi` import, no instruction. The 01 report's claim that "the caller issues `close_position` last" is **wrong**: `position_authority` is a PDA, so only the program can sign it. The 3-step close could not have completed.
2. **Nothing initialised `PermaPosition`.** `adapter_add_liquidity` required it to pre-exist; no instruction created it.
3. **`create_market` never validated the vaults.** `vault_a`/`vault_b` were bare `UncheckedAccount`s recorded verbatim — which is why the old test passed *Orca's own vaults* as placeholders and nobody noticed.

All three are fixed here.

## 2. Funding method

devUSDC cannot be minted locally — we do not hold its mint authority. Every address involved is deterministic, so the vaults are **hand-crafted SPL token accounts injected at the exact ATA addresses** the program derives:

```bash
node scripts/make-fixtures.mjs        # writes tests/fixtures/vault-{a,b}.json
solana-test-validator … \
  --account 3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY tests/fixtures/vault-a.json \
  --account HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR tests/fixtures/vault-b.json
```

| Account | Address | Funded |
|---|---|---|
| `market` (bump 255) | `BmfJqNtZkAVdF4QatqRWutQPkmkY1WY82PAG6zgdS2cy` | — |
| `market_authority` (bump 255) | `3AZgtdzChALF3ArkiUd489xtn7Hp2pKbCKBEtwfnvwtN` | — |
| `vault_a` WSOL ATA | `3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY` | 10 WSOL |
| `vault_b` devUSDC ATA | `HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR` | 1 000 devUSDC |

Layout verified against Orca's live vault `63GvSv…DT5C`: 165 bytes, `mint[0..32] · owner[32..64] · amount[64..72] · state[108]=1`, rent `2 039 280`. WSOL additionally sets the `is_native` COption with lamports = rent + wrapped amount.

**What was *not* done:** no mock Whirlpool, no forged mint authority. The devUSDC **mint is byte-identical to devnet** — only the two PERMA-owned vaults are synthetic. Funding is ~300× the requirement so slippage caps never bind by accident.

## 3. Program changes

| Item | Change |
|---|---|
| `adapter.rs` | `open_position_for_short` + `close_position_for_short` wrappers; `OpenPositionAccounts` (10) and `ClosePositionAccounts` (6) as their own structs |
| `adapter_open_position` | CPIs Orca `open_position` (owner = `market_authority`), derives and verifies the position PDA, inits `PermaPosition` |
| `adapter_close_position` | CPIs `close_position`, PDA-signed; closes the PERMA record, rent → `receiver` |
| `create_market` | validates both vaults are SPL token accounts with the pool's mints and `owner == market_authority` |
| `remove_liquidity_for_short` | **skips the decrease CPI when `liquidity_amount == 0`** — see below |
| Events | `PositionOpened`, `PositionClosed` |

### Why zero-amount decrease is skipped

Orca's `_calculate_modify_liquidity` rejects `liquidity_delta == 0 && position.liquidity == 0` with `LiquidityZero` (`0x177c`). A legitimate "collect fees and close" call passes zero liquidity, so issuing the decrease anyway would make the supported cleanup path fail with the very error the spec treats as a bug signal. The guard keeps `0x177c` meaningful.

## 4. Test table

| # | Test | Proves |
|---|---|---|
| 1 | `open_position creates the Orca position owned by market_authority` | Orca `Position` exists with the right ticks; NFT ATA owner is the **PDA**, amount 1; `PermaPosition` linked |
| 2 | `add increases orca position and decreases perma vaults` | `Position.liquidity` rises by **exactly** `L`; both vaults debited; recorded amounts equal **observed** deltas, not the quote |
| 3 | `partial remove halves the position and returns tokens` | liquidity halves, tokens return, position stays open |
| 4 | `full close runs the 3-step sequence and reclaims rent` | decrease → collect → close; Orca **and** PERMA accounts gone, rent returned |
| 5 | **`close on a non-empty position → 0x1775`** | `close_position` refuses while liquidity remains; the same close then succeeds after decrease+collect |
| 6 | `skipping collect_fees leaves fees owed (fee-driven 0x1775)` | conditional — see §5 |
| 7 | **`update_fees_and_rewards after full decrease → 0x177c`** | raw Orca ix (4 accounts, no signer) returns `LiquidityZero` |
| 8 | `slippage cap rejects an under-budgeted add` | `token_max_a = 1` → slippage failure |

## 5. Honest limitation on the fee-driven `0x1775`

The spec's guard is phrased as *"skip `collect_fees_v2`, expect close to fail"*. On a local validator **no swaps cross the range**, so a freshly opened position accrues **zero fees** — `fee_owed_a/b == 0`. After a full decrease the position is genuinely empty and `close_position` legitimately succeeds.

Test 6 therefore reads `fee_owed_a/b` (offsets 112 / 136) and branches: if fees are zero it logs that the fee-driven form was not exercised and closes cleanly; if fees are ever non-zero it asserts the `0x1775` failure properly. It never fakes a pass.

**The `ClosePositionNotEmpty` guard itself is fully proven by test 5**, via the liquidity-present form — the same Orca check (`Position::is_position_empty`), the same error code, reached through the other half of the emptiness condition. Forcing the fee-driven variant would require generating swap volume through the range (an Orca `swap_v2` with wallet-held token accounts and the oracle PDA); that is worth adding when a swap fixture exists, and is listed as a residual.

## 6. Measured CU and transaction size

Real serialized transactions, `scripts/measure.mjs`:

| Instruction | Bytes / 1232 | Unique accounts | CU |
|---|---|---|---|
| `adapter_open_position` | **654** | 14 | **81 964** |
| `adapter_add_liquidity` | **820** | 20 | **54 957** |
| `adapter_remove_liquidity` (decrease + collect) | **821** | 20 | **86 500** |
| `adapter_close_position` | **442** | 10 | **29 562** |

Full lifecycle ≈ **253 k CU**, far under the 1.4 M cap.

**This corrects the 01 estimate.** Feasibility §6 predicted ~1152 bytes and "~80 bytes headroom" for open + increase. The real figures are 654 and 820 bytes **as separate transactions**, with ~400 bytes spare each. The static estimate was pessimistic; measurement replaces it. Keeping `open_position` as a prior transaction remains the right call, but not because of size pressure.

## 7. Residual risks

1. **Fee-driven `0x1775` not exercised** (§5). Needs a swap fixture to generate volume through the range. The emptiness guard is proven; the fee-specific path is not.
2. **Vaults are synthetic.** Balances were injected, not acquired by trading. The *mint* is untouched and Orca's accounting is fully real, but the funding step has no devnet equivalent yet.
3. **`create_market` vault validation is minimal** — mint and owner only. It does not verify the account is a canonical ATA. Sufficient for component 01; the Collateral Manager (component 03) owns the real thing.
4. **Solana CLI drifted to `3.0.0`** (docs said 4.1.2; avm swapped it). Docs re-pinned to `3.0.0+`. Worth adding a version file.
5. **`--arch v0` remains a workaround** for the local loader rejecting SBPF v3.
6. **Test isolation is nonce-based**, not state-reset: the suite derives a run-scoped `NONCE_BASE` from the clock so re-runs do not collide with leftover `PermaPosition` PDAs. Positions from tests 1–3 are intentionally left open.
7. **Single-threaded happy path only.** No concurrency, no partial-failure/rollback testing across the multi-instruction close.

## 8. Scope compliance

| Boundary | Held |
|---|---|
| Components 02–11 | ✅ only the minimal state the adapter needs |
| Next.js / indexer | ✅ none |
| Mock Whirlpool | ✅ none — real program, real cloned pool |
| Forged mint authority | ✅ none — devUSDC mint untouched |
| `--arch v0`, `anchor-lang 1.2.0`, no client `anchor` feature | ✅ |
| 3-step close, `CollectFeesV2` order separate, `to_string()` seeds | ✅ |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
