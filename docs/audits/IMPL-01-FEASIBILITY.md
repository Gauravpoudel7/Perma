# Component 01 (Orca CLMM Adapter) — Phase 0 Feasibility Gate

**Date**: 2026-09-19
**Scope**: Prove the CLMM Adapter can be implemented as specified **before** writing production code.
**Authority**: `PRD.md` Part A · [`01-clmm-adapter-orca.md`](../02-mvp-components/01-clmm-adapter-orca.md) · [ADR-0001](../adr/ADR-0001-orca-cpi-instruction-surface.md)

## Verdict: **GO**

The CPI dependency compiles against a real Anchor program, the account layouts re-verified clean against the pinned Orca commit, and a live devnet pool meeting every MVP criterion has been selected and recorded.

**One blocker was found and resolved: the toolchain pins in the docs were mutually impossible.** Details in §3. The fix changes documented versions, so it is recorded as an ADR-0001 addendum.

---

## 1. Repo inspection (0.1)

| Check | Finding |
|---|---|
| Remote | `github.com/Gauravpoudel7/Perma.git`, 2 commits |
| Tree | Docs-only — `docs/`, `PRD.md`, `README.md`, `CONTRIBUTING.md`, `.github/` |
| `Anchor.toml` / `programs/` / `package.json` | **Absent**, as expected |
| `PRD.md` location | **Repo root**, not `docs/PRD.md` ✅ |
| Working tree | 15 modified + 3 untracked docs files from prior sessions — **preserved, not discarded** |

Against `REPO-STRUCTURE.md`, everything under `programs/`, `app/`, `indexer/`, and `tests/` is still to be created. This session creates only `programs/perma` and `tests/`.

## 2. Toolchain reality check (0.2)

**Every Rust/Solana tool was missing at session start.**

| Tool | Doc pin | Found | Action |
|---|---|---|---|
| rustc | 1.79.0 | **missing** | installed 1.86.0, then stable **1.98.1** (see §3) |
| cargo | — | **missing** | 1.86.0 → stable |
| solana | 1.18.17 | **missing** | Agave 2.2.20, then **4.1.2** (pulled by Anchor 1.2.0) |
| anchor | 0.30.1 | **missing** | installed 0.32.1, then **1.2.0** (see §3) |
| avm | — | **missing** | installed from git |
| node | 20.11.0 | **v24.11.1** | drift accepted — TS tests only, not consensus-critical |
| yarn | 1.22.x | **missing** | **1.22.22** via Homebrew (npm global needed sudo) |

Host: Darwin arm64, 111 GB free, Homebrew 6.0.5. Platform-tools v1.48 pulled by Anchor.

Version files (`rust-toolchain.toml`, `.nvmrc`) are created in Phase 1, as `RELEASE-GATE.md` §1 requires.

## 3. 🚨 The blocker: documented pins were impossible (0.3)

The Orca program at pinned commit `408c945` declares:

```toml
anchor-lang    = "=0.32.1"    # EXACT
solana-program = "=2.2.1"
# rust-toolchain.toml -> channel 1.86.0
```

The docs pinned **Anchor 0.30.1 / Rust 1.79.0 / Solana 1.18.17**. A program on `anchor-lang 0.30.1` cannot CPI into a crate exact-pinned to `0.32.1` — two `anchor-lang` majors in one graph means `Context` / `CpiContext` / `AccountInfo` are distinct types. Rust 1.79 also cannot build a crate demanding 1.86.0.

**Root cause:** in a previous session the Orca commit and the toolchain were pinned independently and never checked against each other. Source wins; the docs change.

### What was actually tried

| # | Configuration | Result |
|---|---|---|
| 1 | Rust 1.86 · `anchor-lang 0.32.1` · `orca_whirlpools_client` **with `anchor` feature** | ❌ `rustc 1.86 is not supported`; and the client's `anchor-lang = ">=0.31"` is an **open range** that resolved to `1.2.0` *alongside* my `0.32.2` — the exact duplicate-anchor problem |
| 2 | Rust stable 1.98 · `anchor-lang 0.32.2` · client **without** `anchor` feature | ⚠️ Duplicate resolved, but **3 versions of `solana-pubkey`** (2.4.0 / 3.0.0 / 4.3.0). `Pubkey` vs `Address` mismatch — anchor 0.32.x is on solana **2.x**, client v8 is on **3.x/4.x** |
| 3 | Rust stable 1.98 · **`anchor-lang 1.2.0`** · `orca_whirlpools_client 8.0.0`, no `anchor` feature | ✅ **Compiles and tests pass** |

Dropping the client's optional `anchor` feature is essential — that feature's open `>=0.31` range is what pulls a second `anchor-lang`.

### Compatibility matrix (from crates.io metadata)

| Crate | solana crate family |
|---|---|
| `orca_whirlpools_client` 8.0.0 / 7.2.0 | `^3` |
| `orca_whirlpools_client` 6.0.0 | `^2` |
| `anchor-lang` 0.32.x | `2.x` |
| `anchor-lang` 1.2.0 | `^3` |

Two coherent pairings exist: **(0.32.x + client 6.0.0)** or **(1.2.0 + client 8.0.0)**.

**Chosen: `anchor-lang 1.2.0` + `orca_whirlpools_client 8.0.0`.** Client v8 is generated from the current program and its `IncreaseLiquidityV2` account list matches commit `408c945` field-for-field (§4). Client 6.0.0 predates the pinned program and its layouts are not verified against it, so pairing backwards would trade a build problem for a correctness risk.

### Resolved pins

| Tool | New pin |
|---|---|
| Rust | **stable 1.98.1** (`solana-*` v4 crates require ≥1.89) |
| Anchor CLI / `anchor-lang` | **1.2.0** |
| Agave / Solana CLI | **4.1.2** |
| Node / Yarn | 24.11.1 / 1.22.22 |
| `orca_whirlpools_client` | **8.0.0**, `default-features = false` |

### The probe

A minimal Anchor program in the scratchpad that imports the generated client and calls the real CPI path:

```rust
use anchor_lang::prelude::*;
use orca_whirlpools_client::{
    get_tick_array_address, get_position_address,
    IncreaseLiquidityV2Cpi, IncreaseLiquidityV2CpiAccounts,
    IncreaseLiquidityV2InstructionArgs, WHIRLPOOL_ID,
};

let cpi = IncreaseLiquidityV2Cpi::new(program, accounts, args);
cpi.invoke_signed(seeds)?;            // Anchor AccountInfo accepted
```

`cargo check` clean; `cargo test` green. The decisive point is that **Anchor's `AccountInfo` type-checks against the generated `…Cpi` structs** — that is what makes this a real CPI and not a mock.

> **This supersedes ADR-0001's "whirlpool program crate with `features = [\"cpi\"]\"".** The generated client is used instead. Discriminators, account order, and PDA seeds still come from the pinned program — the client is code-generated from it. Recorded as an ADR-0001 addendum.

### Bonus: the client validates our spec

`orca_whirlpools_client::get_tick_array_address` builds seeds as:

```rust
let start_tick_index_str = start_tick_index.to_string();
let seeds = &[b"tick_array", whirlpool.as_ref(), start_tick_index_str.as_bytes()];
```

Decimal ASCII, exactly as `01-clmm-adapter-orca.md` §C.4 warns. Orca's own library confirms the rule.

## 4. Account tables re-verified against `408c945` (0.4)

Re-fetched from source, not memory. **All match the spec.**

| Check | Result |
|---|---|
| `ModifyLiquidityV2` order | 15 accounts — matches §B.2 field-for-field ✅ |
| `CollectFeesV2` order | 13 accounts, `owner_a, vault_a, owner_b, vault_b` interleaved with programs **last** — differs from ModifyLiquidityV2 as §B.4 warns ✅ |
| TickArray seeds | `[b"tick_array", whirlpool, start_tick_index.to_string().as_bytes()]` ✅ |
| `TICK_ARRAY_SIZE` | `88` ✅ |
| `MIN/MAX_TICK_INDEX` | `∓443636` ✅ |
| 3-step close | `_calculate_modify_liquidity` returns `LiquidityZero` when `liquidity_delta == 0 && position.liquidity == 0` — confirms `update_fees_and_rewards` must **not** sit between decrease and collect ✅ |

**One stale line found:** `01-clmm-adapter-orca.md:578` still said *"Full close runs the 4-step sequence"* while §D.2 and the test cases correctly say 3-step. Fixed in Phase 1. This is exactly the discrepancy the prompt flagged.

## 5. Whirlpool selection — **Path A** (0.5)

Queried devnet directly: **9 753** Whirlpools under config `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR`, **4 232** containing WSOL, **29** paired with a recognised USDC mint.

### Selected pool

| Field | Value |
|---|---|
| **Whirlpool** | `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` |
| `whirlpools_config` | `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR` ✅ devnet |
| `token_mint_a` | `So11111111111111111111111111111111111111112` (WSOL, 9 dec) |
| `token_mint_b` | `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k` (Orca devUSDC, 6 dec) |
| `token_vault_a` | `3uyTv2Pi3pb6Gc2emKiYU8gW845M1HeMMyFr2MTrDGh4` |
| `token_vault_b` | `63GvSvGYTsfesX1kmesdtfxHbBQBsFpZT1wVNhNADT5C` |
| **`tick_spacing`** | **8** |
| `liquidity` | `4 762 722 691 665` — highest of all devnet SOL/USDC pools |
| `tick_current_index` | `-39140` |
| `sqrt_price` | `2 606 559 578 699 896 130` |
| **Active rewards** | **NONE** ✅ required, since the close sequence omits `collect_reward_v2` |
| Program ID | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |

Fallback: `3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt` (`tick_spacing = 64`, liquidity `40 967 063 863`).

### Two consequences for the docs

**`tick_spacing` is 8, not 64.** So `ticks_in_array = 88 × 8 = 704`, not 5 632. This is direct vindication of the "read `tick_spacing` from the live Whirlpool, never hardcode" rule in `02-factory-allowlisted-market.md` §A — the first real pool we touched disagrees with the illustrative example.

**Live price is ~$19.97/SOL, not ~$180.** The devUSDC pool is test-priced, so the `$180–$220` demo range is meaningless here. Recomputed around the live tick:

| | Requested | Exact tick | Aligned | Realized price | TickArray start | Seed |
|---|---|---|---|---|---|---|
| lower | $18.00 | `-40175.8439` | **`-40176`** | 17.9997 | **`-40832`** | `"-40832"` |
| upper | $22.00 | `-38169.0366` | **`-38168`** | 22.0023 | **`-38720`** | `"-38720"` |

Distinct arrays ✅ · current tick `-39140` is in range ✅ · `lo % 8 == 0`, `hi % 8 == 0`, both starts `% 704 == 0` ✅

Same-array case for the narrow-range test: `[-39184, -39104]` → both in array `-39424`.

### `div_euclid` is not optional

| tick | `div_euclid` | truncating `/` | differ? |
|---|---|---|---|
| `-40176` | **`-40832`** | `-40128` | ✅ |
| `-38168` | **`-38720`** | `-38016` | ✅ |
| `-39140` | **`-39424`** | `-38720` | ✅ |
| `-1` | **`-704`** | `0` | ✅ |
| `-39424` | `-39424` | `-39424` | — (exact multiple) |

Every realistic tick for this pool is negative and every one lands on a **different array** under truncation. This is now a unit test.

## 6. Transaction / CU feasibility (0.6)

| Bundle | Unique accounts | Est. tx bytes | Limit | Headroom |
|---|---|---|---|---|
| `open_position` + `increase_liquidity_v2` | 25 | ~1 152 | 1 232 | **~80** |
| … + 2 × `initialize_tick_array` | 25 | ~1 152 | 1 232 | ~80 |

CU is *not* the binding constraint: `open_position` ~30k + `increase_liquidity_v2` ~90k + ~10k per TickArray init ≈ **140k**, far under the 1.4 M cap. A 400 k request is ample.

**Transaction size is the constraint, at ~80 bytes of headroom** — inside the error bars of a static estimate.

**Split plan:** `initialize_tick_array` runs as a **separate, prior transaction** by default. TickArray accounts are already in the open+increase account list, so init adds no new keys — but the margin is too thin to rely on. Phase 1 measures the real serialized size and may merge them if the measurement allows. Address lookup tables are the escalation path and are **out of Fair MVP scope**.

## 7. Verdict

**GO.**

| Gate | Status |
|---|---|
| Toolchain installed and coherent | ✅ (pins changed — §3) |
| CPI dependency compiles against real Anchor | ✅ probe checks and tests clean |
| Account tables verified against pinned source | ✅ all match; 1 stale doc line found |
| Pool path chosen | ✅ Path A, pool selected and validated |

### Carried into Phase 1

1. **Doc pin updates** — `RELEASE-GATE.md` §1, `LOCAL-DEV.md`, adapter §A, plus an **ADR-0001 addendum** for the CPI-path change.
2. **Fix `01-clmm-adapter-orca.md:578`** 4-step → 3-step.
3. **Re-label the spacing-64 worked example** illustrative; add the spacing-8 numbers from §5.
4. **Fill `PERMA_WHIRLPOOL`** and the 7 values into `FIXTURES-AND-VECTORS.md` §6.
5. **Measure real tx size** before deciding whether TickArray init can share a transaction.

### Residual risks

- **`anchor-lang 1.2.0` is a major-version jump** from the 0.30.1 the docs assumed. Zero migration cost (no code existed), but the 1.x API differs from most online Anchor material.
- **Two `solana-pubkey` versions (3.0.0, 4.3.0) remain in the graph.** They do not cross the CPI type boundary — the probe compiles — but a future bump could surface this. `cargo tree -d` belongs in CI.
- **Public devnet RPC rate-limits** heavy `getProgramAccounts` calls (hit during selection). Integration tests should use Helius/Triton per `TECH-STACK.md`.
- **Pool is devUSDC, not Circle USDC**, and priced ~$19.97/SOL. Fine for a devnet prototype; the demo narrative must not imply real SOL pricing.
- **Node 24.11.1 vs the documented 20.11.0.** TS tests only; not consensus-critical.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
