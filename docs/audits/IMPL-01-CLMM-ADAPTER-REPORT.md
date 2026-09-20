# Component 01 — CLMM Adapter (Orca Whirlpool) — Implementation Report

**Date**: 2026-09-19
**Phase 0 gate**: [`IMPL-01-FEASIBILITY.md`](IMPL-01-FEASIBILITY.md) — verdict **GO**
**Spec**: [`01-clmm-adapter-orca.md`](../02-mvp-components/01-clmm-adapter-orca.md) · [ADR-0001 + addendum](../adr/ADR-0001-orca-cpi-instruction-surface.md)

## Status: **shipped, with one gap**

The adapter compiles, deploys, and runs against a **real Orca Whirlpool cloned from devnet**. All pre-CPI validation is implemented and tested. **Liquidity-moving CPI is implemented but not yet executed end-to-end** — it needs funded PERMA vaults, which is a fixture problem, not a code problem. See §5.

| Suite | Result |
|---|---|
| Rust unit tests (`cargo test -p perma --lib`) | **8 / 8 passing** |
| TS integration (`tests/adapter.ts`, cloned pool) | **12 / 12 passing** |
| `anchor build --arch v0` | ✅ `perma.so`, SBPF v0 |
| Deploy to local validator | ✅ `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt` |

---

## 1. What shipped

### Scaffold

```
Anchor.toml                 # incl. [test.validator] clone set
Cargo.toml                  # workspace, overflow-checks = true
rust-toolchain.toml         # 1.98.1
.nvmrc                      # 24.11.1
package.json / tsconfig.json
programs/perma/src/{lib,adapter,errors,state}.rs
tests/adapter.ts
```

### `adapter.rs`

| Item | Notes |
|---|---|
| `start_tick_index` | `i32::div_euclid`, not truncation |
| `derive_tick_array` | delegates to `get_tick_array_address` — Orca's own `to_string()` seeds |
| `is_usable_tick` | spacing + `±443636` bounds |
| `load_whirlpool` / `get_sqrt_price_x64` / `get_current_tick` | live reads; gating and display only |
| `validate_before_cpi` | all 7 checks from spec §C.8 |
| `add_liquidity_for_short` | `increase_liquidity_v2`, `remaining_accounts_info: None` |
| `decrease_liquidity_for_short` | `decrease_liquidity_v2` |
| `collect_fees_for_short` | `collect_fees_v2`, **its own account struct** |
| `remove_liquidity_for_short` | orchestrates the 3-step close |

`ModifyLiquidityAccounts` (15) and `CollectFeesAccounts` (13) are **separate types**. The collect ordering (`owner_a, vault_a, owner_b, vault_b`, programs last) is deliberately not derived from the modify struct — building it by analogy is the documented failure mode.

### Program instructions

| Instruction | Accounts | Purpose |
|---|---|---|
| `create_market` | 8 | Reads `tick_spacing`, mints, vaults **from the live pool**; rejects pools with active rewards |
| `validate_short_range` | 6 | Full §C.8 preamble with no CPI — lets a client discover missing TickArrays before building the mint tx |
| `adapter_add_liquidity` | 19 | Validate → snapshot vaults → `increase_liquidity_v2` → record **observed** deltas |
| `adapter_remove_liquidity` | 19 | Validate → `decrease_liquidity_v2` (+ `collect_fees_v2` when `close_after`) |

Events: `MarketCreated`, `RangeValidated`, `LiquidityAdded`, `LiquidityRemoved`. Errors `0x40`–`0x48` per [`ERROR-CATALOG.md`](../03-api-interfaces/ERROR-CATALOG.md) §5, plus four adapter-local codes.

---

## 2. Pool used

| Field | Value |
|---|---|
| Whirlpool | `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` |
| Pair | WSOL (9 dp) / Orca devUSDC (6 dp) |
| **`tick_spacing`** | **8** → `ticks_in_array = 704` |
| Liquidity | `4 762 722 691 665` |
| Active rewards | none (asserted on-chain at `create_market`) |
| Live tick / price | `-39140` ≈ $19.97/SOL |

Demo range **$18–$22** → ticks `[-40176, -38168]`, TickArrays `-40832` / `-38720`. Narrow case `[-39184, -39104]` → shared array `-39424`.

**The pool's `tick_spacing` is 8, not the 64 in the spec's illustrative example.** The first real pool contradicted the example — which is exactly why `create_market` reads it live. Spec §C.3a now carries the real numbers.

---

## 3. Test results

### Unit — 8/8

| Test | Asserts |
|---|---|
| `ticks_in_array_matches_pool` | 704 for spacing 8; 5632 for 64 |
| `start_tick_index_live_pool_values` | `-40176→-40832`, `-38168→-38720`, `-39140→-39424` |
| **`div_euclid_not_truncation`** | truncation differs at every realistic tick |
| `start_tick_index_is_always_a_valid_array_start` | `start % 704 == 0` across the range |
| `usable_tick_rules` | spacing + bounds, incl. spacing-relative alignment |
| **`tick_array_seeds_are_decimal_ascii_not_le_bytes`** | `to_string()` matches Orca; `to_le_bytes()` does **not** |
| `narrow_range_shares_one_tick_array` | both bounds → `-39424` |
| `wide_range_spans_distinct_tick_arrays` | demo range spans two arrays |

### Integration — 12/12, against the cloned pool

| # | Test | Spec case |
|---|---|---|
| 1 | Pool cloned; `tick_spacing = 8` read from raw account | — |
| 2 | `create_market` records live geometry; `has_active_rewards == false` | — |
| 3 | Valid range accepted; both TickArrays derived | happy path |
| 4 | Unaligned tick → `TickNotAlignedToSpacing` | ✅ required |
| 5 | Inverted range → `InvalidRange` | ✅ |
| 6 | Out-of-bounds tick → `TickOutOfBounds` | ✅ |
| 7 | Wrong TickArray (valid PDA, wrong start) → `TickArrayNotInitialized` | ✅ missing TickArray |
| 8 | `to_le_bytes()` seeds → `TickArrayNotInitialized` | ✅ |
| 9 | Different real Orca pool → `WhirlpoolNotAllowlisted` | ✅ wrong whirlpool |
| 10 | Non-Whirlpool program → `WrongWhirlpoolProgram` | ✅ wrong program |
| 11 | Injected remaining accounts → `UnexpectedRemainingAccounts` | ✅ |
| 12 | Narrow range, same array passed twice → accepted | ✅ same-array |

Test 7 is stronger than "missing account": it passes a **real, correctly-formed** TickArray PDA for the wrong start index, so it catches derivation drift, not just absence.

---

## 4. Build and CU notes

- **`anchor build --arch v0` is mandatory.** Anchor 1.x defaults to `--arch v3`; that ELF is rejected by the local validator's loader with `ELF error: Failed to parse ELF file: invalid file header`. Verify `e_flags == 0`.
- `perma.so` ≈ 237 KB.
- Transaction-size sketch (feasibility §6): `open_position` + `increase_liquidity_v2` ≈ 25 unique accounts, ~1152 bytes against the 1232 limit — **~80 bytes headroom**. TickArray init therefore stays a **separate prior transaction**; merging is not safe on this estimate alone and must be measured against a real serialized tx.
- CU is not binding: ~30k + ~90k + ~10k/init ≈ 140k, far under 1.4 M.

---

## 5. The gap: liquidity-moving CPI not yet executed — **CLOSED by 01B**

> **Resolved 2026-09-19.** Vaults funded by account injection; `increase_liquidity_v2`,
> the 3-step close, and both regression guards all executed against the cloned pool.
> 8/8 liquidity tests pass. See [`IMPL-01B-LIQUIDITY-CPI-REPORT.md`](IMPL-01B-LIQUIDITY-CPI-REPORT.md).
> The original text is kept below for the record.


`adapter_add_liquidity` and `adapter_remove_liquidity` are implemented and type-check against the generated CPI structs, but **no test has actually moved liquidity**. They need:

1. PERMA vault ATAs owned by `market_authority`, funded with WSOL and devUSDC.
2. An Orca position opened for the demo range, its NFT in an ATA owned by `market_authority`.

devUSDC cannot be minted locally — we do not hold its mint authority. The workable route is to **inject pre-funded token accounts into the validator** with `solana-test-validator --account <pubkey> <file.json>`; every address involved is a deterministic PDA/ATA, so they can all be precomputed. That is a fixture task, deliberately out of this session's scope.

**Consequently the two mandatory regression guards are written in the spec but not yet executed:**

- `ClosePositionNotEmpty` `0x1775` — skip `collect_fees_v2`, expect close to fail
- `LiquidityZero` `0x177c` — `update_fees_and_rewards` on a drained position

Both are pinned in the spec's Test Cases and both are blocked on the same fixture. **No mock Whirlpool was written to fake them.**

---

## 6. Residual risks

1. ~~**Liquidity CPI unexercised**~~ — **closed by 01B**. The account wiring is compile-checked and the account lists come from the generated client, but CPI is not *proven* until a transaction lands. Highest-priority follow-up.
2. **`anchor-lang 1.2.0`** is a major jump from the 0.30.1 the docs assumed. Zero migration cost, but most online Anchor material targets 0.2x/0.3x.
3. **Two `solana-pubkey` versions (3.0.0, 4.3.0)** remain in the graph. They do not cross the CPI type boundary, but `cargo tree -d` belongs in CI.
4. **`FixedTickArray::from(DynamicTickArray)` in the Orca client exceeds the 4 KB BPF stack frame (~10.7 KB)**, emitting a build warning. PERMA never calls it — TickArrays are validated by PDA and ownership, never deserialized — but it is linked in. If a future change deserializes a TickArray on-chain, this becomes a real failure.
5. **`--arch v0` is a workaround**, not a considered choice. Revisit when the local validator accepts SBPF v3.
6. **devUSDC at ~$19.97/SOL** is a test price. The demo narrative must not imply real SOL pricing.
7. **`create_market` currently accepts the Orca vaults as PERMA vault placeholders** in the integration test. Real PERMA vaults arrive with component 03 (Collateral Manager).
8. **Public devnet RPC rate-limits** heavy `getProgramAccounts`; use Helius/Triton for repeat runs.

---

## 7. Docs updated

| File | Change |
|---|---|
| `01-clmm-adapter-orca.md` | **"4-step" → "3-step"** (the stale line); §A CPI crate + toolchain; **new §C.3a** with real spacing-8 numbers; spacing-64 example marked illustrative |
| `ADR-0001-…md` | **Addendum**: CPI via generated client, resolved pins, `--arch v0`, risks |
| `FIXTURES-AND-VECTORS.md` §6 | `TODO_ALLOWLIST_ADDRESS` → real pool; TickArray addresses; **0 TODOs left** |
| `RELEASE-GATE.md` | §1 pins + expected output; §3 full clone set + zsh word-splitting warning; §4.1 `--arch v0` |
| `LOCAL-DEV.md` | Pins; `--arch v0` |
| `README.md` | "Running the CLMM adapter tests" |

---

## 8. Scope compliance

| Boundary | Held |
|---|---|
| Components 02–11 | ✅ only minimal `Market` / `PermaPosition` state |
| Next.js / indexer | ✅ none |
| Real Orca names only | ✅ no invented instructions |
| v2 liquidity + collect | ✅ |
| 3-step close | ✅ enforced in code and documented |
| No mock Orca program | ✅ real cloned pool; gaps reported as gaps |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
