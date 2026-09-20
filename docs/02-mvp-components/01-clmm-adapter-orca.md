# Component: CLMM Adapter (Orca Whirlpool)

> **Scope:** Fair MVP (Part A of [`PRD.md`](../../PRD.md)). One allowlisted SOL/USDC Whirlpool, 1-leg positions, Orca Whirlpool only.
> **Naming:** This spec uses the **real** Orca instruction names. Earlier PERMA drafts referenced `increase_position` / `decrease_position`, which do not exist in the Whirlpool program. See [ADR-0001](../adr/ADR-0001-orca-cpi-instruction-surface.md).

## Purpose

The CLMM Adapter is the only module in PERMA permitted to CPI into the Orca Whirlpool program. It converts PERMA's internal short-position intent (`price range + liquidity size`) into the exact Whirlpool account set and instruction arguments, validates every account before the CPI, and maps Orca errors onto PERMA errors.

## User-Facing Behavior

Invisible to the user. When a user opens a SHORT, the adapter creates a real Orca position and deposits real SOL/USDC into the allowlisted Whirlpool; the transaction signature is verifiable on an explorer as a Whirlpool `increaseLiquidityV2` CPI. When the user closes, the adapter withdraws and closes the Orca position. No synthetic or simulated liquidity is ever reported to the UI.

## Dependencies

| Dependency | Why |
|---|---|
| Orca Whirlpool program | CPI destination (liquidity + position lifecycle) |
| SPL Token program | SOL (WSOL) and USDC transfers; position-NFT mint/burn |
| SPL Associated Token Account program | Position token account creation |
| SPL Memo program | Required account on all `*_v2` liquidity instructions |
| [Collateral Manager](03-collateral-manager.md) | Owns the vault ATAs the adapter debits/credits |
| [Position Engine](04-position-engine-1leg.md) | Sole caller of the adapter |
| [Factory / Market](02-factory-allowlisted-market.md) | Supplies the allowlisted Whirlpool address |

---

## A. Program Identity

| Item | Value |
|---|---|
| Whirlpool program ID (devnet **and** mainnet-beta) | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| `WhirlpoolsConfig` — devnet | `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR` |
| `WhirlpoolsConfig` — mainnet-beta | `2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ` |
| Source of truth | [`orca-so/whirlpools`](https://github.com/orca-so/whirlpools) |
| **Pinned commit** | `408c945fef4c49ab70def4303377cfaf8f0f3c99` (2026-09-03) |
| Instruction family targeted | **v2** (`increase_liquidity_v2`, `decrease_liquidity_v2`, `collect_fees_v2`) |
| Crate for CPI | **`orca_whirlpools_client` v8.0.0** (crates.io), `default-features = false` |

> **CPI crate change.** ADR-0001 originally specified the `whirlpool` program crate with `features = ["cpi"]`. That is not buildable: the program crate exact-pins `anchor-lang = "=0.32.1"` and `solana-program = "=2.2.1"`, which cannot coexist with a PERMA program on a different Anchor version. PERMA uses the **code-generated client** instead — same program, same discriminators, same account order, generated from this commit. Do **not** enable the client's optional `anchor` feature: its open `anchor-lang = ">=0.31"` range pulls a second `anchor-lang` into the graph. Full analysis in [`IMPL-01-FEASIBILITY.md`](../audits/IMPL-01-FEASIBILITY.md) §3.

### Toolchain (verified working)

| Tool | Pin |
|---|---|
| Rust | `1.98.1` stable |
| Anchor CLI / `anchor-lang` | `1.2.0` |
| Agave / Solana CLI | `3.0.0`+ |
| SBPF target | **`v0`** — build with `anchor build --arch v0`; the default `v3` is rejected by the local validator's loader |

**Sources for every account table below** (paths relative to the pinned commit):

- `programs/whirlpool/src/lib.rs` — instruction list
- `programs/whirlpool/src/instructions/open_position.rs`
- `programs/whirlpool/src/instructions/v2/increase_liquidity.rs` (`ModifyLiquidityV2`)
- `programs/whirlpool/src/instructions/v2/decrease_liquidity.rs`
- `programs/whirlpool/src/instructions/v2/collect_fees.rs`
- `programs/whirlpool/src/instructions/close_position.rs`
- `programs/whirlpool/src/instructions/initialize_tick_array.rs`
- `programs/whirlpool/src/state/tick.rs`, `state/tick_array.rs`, `state/whirlpool.rs`, `state/position.rs`

**Why v2 and not v1:** v1 `increase_liquidity` hardcodes `address = token::ID`, locking the pool to the legacy SPL Token program. SOL/USDC satisfy that today, but v2 is what the current Orca SDK emits and it keeps a Token-2022 market possible without re-specifying the adapter. Cost: three extra accounts (`token_program_a`, `token_program_b`, `memo_program`) plus two mint accounts. Decision recorded in [ADR-0001](../adr/ADR-0001-orca-cpi-instruction-surface.md).

**Version drift rule:** if the pinned commit is bumped, re-verify every account table in this file against the new source and record the bump in an ADR. Do not bump silently.

---

## B. Accounts & Layouts

### B.0 PERMA-side PDAs referenced by the tables

| PDA | Seeds | Role |
|---|---|---|
| `market` | `[b"market", whirlpool]` | Allowlisted market record; holds `whirlpool`, `tick_spacing`, `token_mint_a/b` |
| `market_authority` | `[b"market_authority", market]` | **The Orca `position_authority` signer.** Owns the position token account and both vault ATAs |
| `vault_a` / `vault_b` | ATA of (`market_authority`, `token_mint_a` / `token_mint_b`) | `token_owner_account_a/b` in the tables below |
| `perma_position` | `[b"perma_position", market, owner, nonce_le]` | PERMA position record; stores `orca_position`, `position_mint`, `tick_lower`, `tick_upper`, `liquidity` |

PERMA uses **one Orca position per PERMA short**. There is no shared or netted Orca position in MVP (see ADR-0001).

### B.1 `open_position` — create the Orca position for a new short

`OpenPosition` accounts, in declaration order. Handler args: `(_bumps: OpenPositionBumps, tick_lower_index: i32, tick_upper_index: i32)`.

| Account | Writable? | Signer? | PDA? | Seeds / derivation | Notes |
|---|---|---|---|---|---|
| `funder` | ✅ | ✅ | ❌ | user wallet | Pays position + mint + ATA rent |
| `owner` | ❌ | ❌ | ✅ | `[b"market_authority", market]` | **Must be `market_authority`**, never the end user |
| `position` | ✅ | ❌ | ✅ (Orca) | `[b"position", position_mint]` | `init` by Orca |
| `position_mint` | ✅ | ✅ | ❌ | fresh keypair, signs `init` | decimals 0; mint authority = `whirlpool` |
| `position_token_account` | ✅ | ❌ | ATA | ATA(`owner` = `market_authority`, `position_mint`) | Receives the single position NFT |
| `whirlpool` | ❌ | ❌ | ✅ (Orca) | `[b"whirlpool", config, mint_a, mint_b, tick_spacing_le]` | **Must equal `market.whirlpool`** |
| `token_program` | ❌ | ❌ | ❌ | `TokenkegQfe…` | Constrained `address = token::ID` |
| `system_program` | ❌ | ❌ | ❌ | `11111111111111111111111111111111` | |
| `rent` | ❌ | ❌ | ❌ | `SysvarRent111…` | Sysvar |
| `associated_token_program` | ❌ | ❌ | ❌ | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | |

`position_mint` is an ephemeral signer. The PERMA instruction must accept it as a signer account and record the resulting pubkey in `perma_position.position_mint` so the position PDA is re-derivable at close.

### B.2 `increase_liquidity_v2` — add liquidity for a short

`ModifyLiquidityV2` accounts, in declaration order. Handler args: `(liquidity_amount: u128, token_max_a: u64, token_max_b: u64, remaining_accounts_info: Option<RemainingAccountsInfo>)`.

| Account | Writable? | Signer? | PDA? | Seeds / derivation | Notes |
|---|---|---|---|---|---|
| `whirlpool` | ✅ | ❌ | ✅ (Orca) | `market.whirlpool` | Allowlist-checked before CPI |
| `token_program_a` | ❌ | ❌ | ❌ | owner of `token_mint_a` | Orca constrains `address = *token_mint_a.owner` |
| `token_program_b` | ❌ | ❌ | ❌ | owner of `token_mint_b` | Same, for B |
| `memo_program` | ❌ | ❌ | ❌ | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | Required even when unused |
| `position_authority` | ❌ | ✅ | ✅ | `[b"market_authority", market]` | **PERMA PDA signs via `invoke_signed`** |
| `position` | ✅ | ❌ | ✅ (Orca) | `[b"position", position_mint]` | `has_one = whirlpool` enforced by Orca |
| `position_token_account` | ❌ | ❌ | ATA | ATA(`market_authority`, `position_mint`) | Orca asserts `amount == 1` |
| `token_mint_a` | ❌ | ❌ | ❌ | `whirlpool.token_mint_a` | `address` constrained |
| `token_mint_b` | ❌ | ❌ | ❌ | `whirlpool.token_mint_b` | `address` constrained |
| `token_owner_account_a` | ✅ | ❌ | ATA | `vault_a` | Source of token A |
| `token_owner_account_b` | ✅ | ❌ | ATA | `vault_b` | Source of token B |
| `token_vault_a` | ✅ | ❌ | ❌ | `whirlpool.token_vault_a` | Orca-owned vault |
| `token_vault_b` | ✅ | ❌ | ❌ | `whirlpool.token_vault_b` | Orca-owned vault |
| `tick_array_lower` | ✅ | ❌ | ✅ (Orca) | `[b"tick_array", whirlpool, start_lower.to_string()]` | See §C |
| `tick_array_upper` | ✅ | ❌ | ✅ (Orca) | `[b"tick_array", whirlpool, start_upper.to_string()]` | May be the **same account** as lower |

**Remaining accounts:** Orca parses `remaining_accounts_info` as `RemainingAccountsInfo` (transfer-hook accounts for mint A / mint B). SOL and USDC have no transfer hooks, so **PERMA MVP always passes `None` and zero remaining accounts.** See §E.

**`token_max_a` / `token_max_b`** are the slippage guard. **The client supplies them** — PERMA does not quote Whirlpool math on-chain and `Market` carries no slippage parameter. Free balance must cover the caps; what gets *locked* is the observed spend. Exceeding a cap yields Orca `TokenMaxExceeded`, surfaced as `SlippageExceeded`.

### B.3 `decrease_liquidity_v2` — remove liquidity for a short

Identical `ModifyLiquidityV2` account list as §B.2 (same order, same constraints). Only the handler args differ:

`(liquidity_amount: u128, token_min_a: u64, token_min_b: u64, remaining_accounts_info: Option<RemainingAccountsInfo>)`

`token_min_a` / `token_min_b` are minimum-received guards; a shortfall yields Orca `TokenMinSubceeded`. Withdrawn tokens land in `vault_a` / `vault_b`, i.e. back under Collateral Manager control.

### B.4 `collect_fees_v2` — drain accrued Whirlpool fees

Required before `close_position` (see §B.6). Handler arg: `(remaining_accounts_info: Option<RemainingAccountsInfo>)`.

> ⚠️ **The account order differs from `ModifyLiquidityV2`.** `CollectFeesV2` interleaves owner/vault per token (`owner_a, vault_a, owner_b, vault_b`) and places the token programs and memo program **last**, whereas `ModifyLiquidityV2` groups them (`owner_a, owner_b, vault_a, vault_b`) and puts the programs first. Also note `whirlpool` is **not** writable here. Build this list from the struct, not by analogy.

| # | Account | Writable? | Signer? | PDA? | Seeds / derivation | Notes |
|---|---|---|---|---|---|---|
| 1 | `whirlpool` | ❌ | ❌ | ✅ (Orca) | `market.whirlpool` | Read-only in this instruction |
| 2 | `position_authority` | ❌ | ✅ | ✅ | `[b"market_authority", market]` | PERMA PDA |
| 3 | `position` | ✅ | ❌ | ✅ (Orca) | `[b"position", position_mint]` | `has_one = whirlpool` |
| 4 | `position_token_account` | ❌ | ❌ | ATA | ATA(`market_authority`, `position_mint`) | `amount == 1` |
| 5 | `token_mint_a` | ❌ | ❌ | ❌ | `whirlpool.token_mint_a` | |
| 6 | `token_mint_b` | ❌ | ❌ | ❌ | `whirlpool.token_mint_b` | |
| 7 | `token_owner_account_a` | ✅ | ❌ | ATA | `vault_a` | Fee destination A |
| 8 | `token_vault_a` | ✅ | ❌ | ❌ | `whirlpool.token_vault_a` | |
| 9 | `token_owner_account_b` | ✅ | ❌ | ATA | `vault_b` | Fee destination B |
| 10 | `token_vault_b` | ✅ | ❌ | ❌ | `whirlpool.token_vault_b` | |
| 11 | `token_program_a` | ❌ | ❌ | ❌ | owner of `token_mint_a` | |
| 12 | `token_program_b` | ❌ | ❌ | ❌ | owner of `token_mint_b` | |
| 13 | `memo_program` | ❌ | ❌ | ❌ | Memo program | |

Whirlpool swap fees earned by a PERMA short are **protocol-side revenue accounting, not the user's streaming premium**. The premium a long pays is computed by the [Premium Engine](07-premium-engine.md) from PERMA's own accumulator. Fees collected here are credited per the Collateral Manager's fee policy — the adapter's only job is to move them into the vaults and report the amounts.

### B.5 `initialize_tick_array` — create a missing TickArray

| Account | Writable? | Signer? | PDA? | Seeds / derivation | Notes |
|---|---|---|---|---|---|
| `whirlpool` | ❌ | ❌ | ✅ (Orca) | `market.whirlpool` | |
| `funder` | ✅ | ✅ | ❌ | user wallet | Pays TickArray rent (~0.07 SOL for `FixedTickArray`) |
| `tick_array` | ✅ | ❌ | ✅ (Orca) | `[b"tick_array", whirlpool, start_tick_index.to_string()]` | `init`, fails if it already exists |
| `system_program` | ❌ | ❌ | ❌ | | |

Handler arg: `(start_tick_index: i32)`.

There is also `initialize_dynamic_tick_array(start_tick_index, idempotent: bool)`, which allocates a variable-size account and — with `idempotent = true` — does **not** fail on an already-initialized array. Orca cannot use `init_if_needed` for it because the space is not constant. **MVP uses `initialize_tick_array` (fixed) and checks existence client-side**; the idempotent dynamic variant is the documented fallback if devnet arrays prove flaky. Either way, this is a **separate top-level instruction, never a CPI from inside PERMA's mint path** (see §C.5).

### B.6 `close_position` — burn the position NFT and reclaim rent

| Account | Writable? | Signer? | PDA? | Seeds / derivation | Notes |
|---|---|---|---|---|---|
| `position_authority` | ❌ | ✅ | ✅ | `[b"market_authority", market]` | PERMA PDA |
| `receiver` | ✅ | ❌ | ❌ | user wallet | Receives reclaimed rent |
| `position` | ✅ | ❌ | ✅ (Orca) | `[b"position", position_mint]` | `close = receiver` |
| `position_mint` | ✅ | ❌ | ❌ | `position.position_mint` | Burned |
| `position_token_account` | ✅ | ❌ | ATA | ATA(`market_authority`, `position_mint`) | `amount == 1` asserted |
| `token_program` | ❌ | ❌ | ❌ | `address = token::ID` | Legacy SPL Token |

> ⚠️ **`close_position` fails unless the position is fully empty.** `Position::is_position_empty` requires `liquidity == 0` **and** `fee_owed_a == 0` **and** `fee_owed_b == 0` **and** every `reward_infos[].amount_owed == 0`. Otherwise Orca returns `ClosePositionNotEmpty`. See the close sequence in §D.2.

### B.7 Read-only accounts — price, tick, and inventory

PERMA reads pool state directly from the deserialized `Whirlpool` account. **No external oracle, no price feed, no off-chain price input.**

| Field | Type | Used for |
|---|---|---|
| `sqrt_price` | `u128` (Q64.64) | Price math; `get_sqrt_price_x64` |
| `tick_current_index` | `i32` | Range/ITM checks, long-mint gating |
| `liquidity` | `u128` | Active in-range liquidity of the whole pool |
| `tick_spacing` | `u16` | **Every** tick alignment check — read, never hardcode |
| `token_mint_a` / `token_mint_b` | `Pubkey` | Account validation |
| `token_vault_a` / `token_vault_b` | `Pubkey` | Account validation |
| `whirlpools_config` | `Pubkey` | Cluster-config sanity check |

Per-position liquidity comes from the Orca `Position` account (`liquidity`, `tick_lower_index`, `tick_upper_index`). PERMA's long-mint inventory gate reads **PERMA's own** aggregated short liquidity per range (maintained by [Long Mint / Inventory](06-long-mint-inventory.md)), not the Whirlpool's global `liquidity`, because the pool contains liquidity from non-PERMA LPs that PERMA must never sell against.

---

## C. TickArray Management

This is the part an engineer cannot guess. Get it wrong and every liquidity CPI fails.

### C.1 What a tick is

A **tick** is one discrete price step. Whirlpool prices are geometric in `1.0001`:

```
price_raw(tick) = 1.0001 ^ tick
sqrt_price_x64(tick) = sqrt(1.0001) ^ tick * 2^64      // Q64.64 fixed point
```

`price_raw` is **token B per token A in raw base units**, not human units.

**`tick_spacing`** is a per-pool constant. A pool with `tick_spacing = 64` only allows positions whose boundaries are multiples of 64. It is stored on the `Whirlpool` account and **must be read at runtime** — SOL/USDC exists at several fee tiers with different spacings (1, 2, 4, 8, 16, 32, 64, 96, 128, 256).

Global bounds (`state/tick.rs`):

| Constant | Value |
|---|---|
| `MIN_TICK_INDEX` | `-443636` |
| `MAX_TICK_INDEX` | `443636` |
| `TICK_ARRAY_SIZE` | `88` |

### C.2 Tick index from a human price

For a pool with token A decimals `dec_a` and token B decimals `dec_b`, and human price `P` (units of B per unit of A):

```
price_raw = P * 10^(dec_b - dec_a)
tick_exact = ln(price_raw) / ln(1.0001)
```

> **Illustrative only.** The example below uses `tick_spacing = 64`. The **allowlisted pool has `tick_spacing = 8`** — see §C.3a for the real numbers. `tick_spacing` is read from the live `Whirlpool` account and stored on the `Market` PDA at `create_market` ([`02-factory-allowlisted-market.md`](02-factory-allowlisted-market.md) §A). The **formulas are spacing-agnostic**; only the integers change.

**Worked example — SOL/USDC, `dec_a = 9` (WSOL), `dec_b = 6` (USDC), so the factor is `10^-3`:**

| Human price `P` | `price_raw` | `tick_exact` |
|---|---|---|
| 180.00 USDC/SOL | 0.180 | `-17148.8417` |
| 200.00 USDC/SOL | 0.200 | `-16095.1838` |
| 220.00 USDC/SOL | 0.220 | `-15142.0344` |

Now snap to the pool's spacing. **PERMA always widens, never narrows** — round the lower bound *down* and the upper bound *up*, so the realized range always contains the range the user asked for:

```
tick_lower = floor(tick_exact_lower / tick_spacing) * tick_spacing
tick_upper = ceil (tick_exact_upper / tick_spacing) * tick_spacing
```

With `tick_spacing = 64`:

| Bound | `tick_exact` | Aligned tick | Realized price | Check |
|---|---|---|---|---|
| lower | `-17148.8417` | **`-17152`** | 179.9432 USDC/SOL | `-17152 % 64 == 0` ✅ |
| upper | `-15142.0344` | **`-15104`** | 220.8383 USDC/SOL | `-15104 % 64 == 0` ✅ |

The realized range `[179.94, 220.84]` strictly contains `[180, 220]`. The UI must display the **realized** ticks and prices, not the requested ones.

### C.3 TickArray start index from a tick index

A TickArray stores exactly `TICK_ARRAY_SIZE = 88` **initializable** ticks, spaced `tick_spacing` apart. So one array spans:

```
ticks_in_array = TICK_ARRAY_SIZE * tick_spacing        // 88 * 64 = 5632
start_tick_index(t) = floor(t / ticks_in_array) * ticks_in_array
```

`floor` here is **mathematical floor toward negative infinity**, not Rust's `/` truncation-toward-zero. For negative ticks — which is the entire SOL/USDC range — `(-17152) / 5632` truncates to `-3` but floors to `-4`. Using truncation produces `-16896`, the wrong array, and the CPI fails. Use `i32::div_euclid`:

```rust
let ticks_in_array = TICK_ARRAY_SIZE * tick_spacing as i32;
let start = tick_index.div_euclid(ticks_in_array) * ticks_in_array;
```

Continuing the example (`tick_spacing = 64`, `ticks_in_array = 5632`):

| Bound | Aligned tick | `start_tick_index` | Array covers ticks |
|---|---|---|---|
| lower | `-17152` | **`-22528`** | `-22528 .. -16897` |
| upper | `-15104` | **`-16896`** | `-16896 .. -11265` |

**These are two different arrays**, so both must be passed and both may need initializing. (At $200 the current tick is `-16096`, which also lives in the `-16896` array — a useful sanity check when reading explorer data.)

Orca validates a start index with `check_is_valid_start_tick`: it must be a multiple of `ticks_in_array`. Both `-22528` and `-16896` satisfy `start % 5632 == 0` ✅.

### C.3a The real allowlisted pool (`tick_spacing = 8`)

These are the **authoritative** numbers — the ones the tests assert against. Pool `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G`, WSOL (9 dp) / devUSDC (6 dp), live price ≈ **$19.97/SOL** at selection. The `$180–$220` figures above belong to a hypothetical spacing-64 pool and do not apply here.

```
ticks_in_array = 88 × 8 = 704          (not 5632)
```

Demo range **$18.00 – $22.00**, straddling the live tick `-39140`:

| Bound | Requested | Exact tick | Aligned | Realized price | TickArray start | PDA seed |
|---|---|---|---|---|---|---|
| lower | $18.00 | `-40175.8439` | **`-40176`** | 17.9997 | **`-40832`** | `"-40832"` |
| upper | $22.00 | `-38169.0366` | **`-38168`** | 22.0023 | **`-38720`** | `"-38720"` |

Distinct arrays, so both must be passed. Checks: `-40176 % 8 == 0`, `-38168 % 8 == 0`, `-40832 % 704 == 0`, `-38720 % 704 == 0`, and `-40176 < -39140 < -38168` (in range).

Narrow same-array case: `[-39184, -39104]` → both in array **`-39424`**; pass the same pubkey twice.

Resolved TickArray addresses (all initialized on devnet):

| Start | Address |
|---|---|
| `-40832` | `86pYzhWoHDwaKbYMbM4gNC7EQTQgbv8WTG5rRjVNH571` |
| `-38720` | `49ixSQnGC2AEzgwQAeHkDnLYJYKtB2c9rSgpb7PncFPv` |
| `-39424` | `ACkArMv6JBtNTM64qLYnNirkMyWgYHUJ9x6CMbLPKZGy` |

**`div_euclid` is mandatory** — every realistic tick here is negative, and truncation picks the wrong array every time:

| tick | `div_euclid` ✅ | truncating `/` ❌ |
|---|---|---|
| `-40176` | `-40832` | `-40128` |
| `-38168` | `-38720` | `-38016` |
| `-39140` | `-39424` | `-38720` |
| `-1` | `-704` | `0` |

### C.4 TickArray PDA seeds — exact

```rust
Pubkey::find_program_address(
    &[
        b"tick_array",
        whirlpool.as_ref(),
        start_tick_index.to_string().as_bytes(),   // DECIMAL ASCII, not bytes
    ],
    &whirlpool_program_id,
)
```

> 🚨 **The single most common integration bug.** The third seed is the **decimal string representation** of the `i32`, produced by Rust's `to_string()`. For our example the seeds are the ASCII bytes of `"-22528"` and `"-16896"` — six and six bytes, including the ASCII minus sign. It is **not** `start_tick_index.to_le_bytes()` (4 bytes) and **not** `to_be_bytes()`. A PDA derived from LE bytes is a valid-looking but wrong address, and Orca will reject it with an account-constraint failure that does not say why.

Source: `programs/whirlpool/src/instructions/initialize_tick_array.rs`, identical seeds in `initialize_dynamic_tick_array.rs`.

### C.5 When a TickArray must already exist

| Situation | Required action |
|---|---|
| Array exists and is initialized | Pass it; nothing else to do |
| Array does not exist | Call `initialize_tick_array(start)` **before** `increase_liquidity_v2`, in the same transaction or a prior one |
| Array exists but the specific tick was never initialized | Fine — Orca initializes the individual `Tick` inside the array during `increase_liquidity_v2` |
| Removing liquidity / closing | Arrays necessarily already exist (they were created to open); never init on the close path |

**PERMA does not CPI `initialize_tick_array` from inside `mint_position`.** Rationale: rent payment, compute budget, and failure attribution all get muddier inside a CPI, and a failed init would abort the whole mint. Instead:

1. The client SDK derives both array PDAs and checks whether they exist.
2. Any missing array is created by a **separate preceding instruction** in the same transaction, funded by the user.
3. `mint_position` validates the arrays exist and are correct, and returns `TickArrayNotInitialized` if not — it never creates them.

On devnet the relevant arrays around spot usually exist already (Orca's own LPs created them); arrays far from spot usually do not.

### C.6 Which TickArrays to pass

For `increase_liquidity_v2` / `decrease_liquidity_v2` / any `ModifyLiquidity*`:

- `tick_array_lower` = the array containing `tick_lower_index`
- `tick_array_upper` = the array containing `tick_upper_index`
- **That is all.** There is no "current tick" array for liquidity operations.
- If `start_tick_index(tick_lower) == start_tick_index(tick_upper)`, pass the **same account pubkey twice**. This is legal and expected for narrow ranges.

> Do not copy the swap pattern. `swap` / `swap_v2` take `tick_array_0/1/2` walking outward from the current tick. Liquidity instructions do not. Confusing the two is the second most common integration bug.

### C.7 Failure modes

| Failure | Orca symptom | PERMA prevention |
|---|---|---|
| TickArray account does not exist | Account-not-initialized / `AccountLoader` failure | Pre-flight existence check → `TickArrayNotInitialized` |
| Wrong array passed (correct PDA form, wrong `start`) | Tick-not-found / constraint failure | Recompute `start` with `div_euclid` and assert the passed key matches the derived PDA |
| Seeds built from `to_le_bytes()` | Derived address simply does not match | Derive with `to_string().as_bytes()`; assert equality on-chain |
| `tick % tick_spacing != 0` | `InvalidTickIndex` (`check_is_usable_tick`) | Snap per §C.2 → `TickNotAlignedToSpacing` |
| Tick outside `±443636` | `TickIndexOutOfBounds` | Bounds check → `TickOutOfBounds` |
| `tick_lower >= tick_upper` | `InvalidTickRangeIndexes` | Assert ordering → `InvalidRange` |
| Truncating division on a negative tick | Wrong array, confusing constraint error | `i32::div_euclid`, covered by a unit test on negative ticks |
| Stale `Whirlpool` read (tick moved mid-tx) | `TokenMaxExceeded` / `TokenMinSubceeded` | Re-read `Whirlpool` inside the instruction; slippage bounds |
| Array exists but is a *dynamic* array where fixed was assumed | Deserialization failure | Use Orca's tick-array loader, which accepts both variants |

### C.8 Adapter responsibilities before any CPI

Every adapter entry point runs this preamble. No exceptions.

```rust
fn validate_before_cpi(ctx, tick_lower: i32, tick_upper: i32) -> Result<()> {
    // 1. Program identity
    require_keys_eq!(ctx.whirlpool_program.key(), WHIRLPOOL_PROGRAM_ID, PermaError::WrongWhirlpoolProgram);

    // 2. Market allowlist — exactly one pool in MVP
    require_keys_eq!(ctx.whirlpool.key(), ctx.market.whirlpool, PermaError::WhirlpoolNotAllowlisted);

    // 3. Pool internals match what the Market recorded
    require_keys_eq!(ctx.whirlpool.token_mint_a, ctx.market.token_mint_a, PermaError::InvalidAsset);
    require_keys_eq!(ctx.whirlpool.token_mint_b, ctx.market.token_mint_b, PermaError::InvalidAsset);
    require_keys_eq!(ctx.token_vault_a.key(), ctx.whirlpool.token_vault_a, PermaError::InvalidAsset);
    require_keys_eq!(ctx.token_vault_b.key(), ctx.whirlpool.token_vault_b, PermaError::InvalidAsset);

    // 4. Tick validity — spacing read from the pool, never hardcoded
    let ts = ctx.whirlpool.tick_spacing as i32;
    require!(tick_lower < tick_upper, PermaError::InvalidRange);
    require!(tick_lower % ts == 0 && tick_upper % ts == 0, PermaError::TickNotAlignedToSpacing);
    require!((MIN_TICK_INDEX..=MAX_TICK_INDEX).contains(&tick_lower), PermaError::TickOutOfBounds);
    require!((MIN_TICK_INDEX..=MAX_TICK_INDEX).contains(&tick_upper), PermaError::TickOutOfBounds);

    // 5. TickArray PDAs match the ticks actually being used
    let n = TICK_ARRAY_SIZE * ts;
    for (tick, array) in [(tick_lower, &ctx.tick_array_lower), (tick_upper, &ctx.tick_array_upper)] {
        let start = tick.div_euclid(n) * n;
        let (expected, _) = Pubkey::find_program_address(
            &[b"tick_array", ctx.whirlpool.key().as_ref(), start.to_string().as_bytes()],
            &WHIRLPOOL_PROGRAM_ID,
        );
        require_keys_eq!(array.key(), expected, PermaError::TickArrayNotInitialized);
        require!(!array.data_is_empty(), PermaError::TickArrayNotInitialized);
    }

    // 6. Position authority is a PERMA PDA, never a user key
    require_keys_eq!(ctx.position_authority.key(), ctx.market_authority.key(), PermaError::PositionAuthorityMismatch);

    // 7. No unexpected remaining accounts (see §E)
    require!(ctx.remaining_accounts.is_empty(), PermaError::UnexpectedRemainingAccounts);
    Ok(())
}
```

Error names map to [`ERROR-CATALOG.md`](../03-api-interfaces/ERROR-CATALOG.md) §5.

---

## D. Adapter Interface (PERMA-facing)

Consumed only by the [Position Engine](04-position-engine-1leg.md). Signatures are illustrative Rust; bodies are pseudocode.

### D.1 `add_liquidity_for_short`

```rust
pub fn add_liquidity_for_short(
    ctx: Context<AddLiquidityForShort>,
    tick_lower: i32,
    tick_upper: i32,
    liquidity: u128,
    token_max_a: u64,
    token_max_b: u64,
) -> Result<LiquidityDelta>
```

| | |
|---|---|
| **Inputs** | Aligned tick bounds (§C.2), liquidity amount, slippage caps |
| **Outputs** | `LiquidityDelta { liquidity_added: u128, amount_a: u64, amount_b: u64 }` |
| **Accounts** | §B.1 (first open only) then §B.2 |
| **Invariants** | `position.liquidity` increases by exactly `liquidity`; `vault_a/b` decrease by the reported amounts; the Whirlpool's `liquidity` increases iff the range is in-range |
| **CU note** | **Measured** (01B): `increase_liquidity_v2` = **54 957 CU / 820 bytes / 20 accounts**; `open_position` = **81 964 CU / 654 bytes / 14 accounts**, run as a prior transaction. A 400 000 CU request is ample. The earlier "~80 bytes of headroom" figure was a pessimistic static estimate — the real transactions are well under the 1232-byte limit. |

```rust
// 1. validate_before_cpi(...)                        // §C.8
// 2. If perma_position.orca_position is unset:
//      cpi open_position(bumps, tick_lower, tick_upper)
//      record orca_position + position_mint on the PERMA position
// 3. Snapshot vault_a/vault_b balances
// 4. cpi increase_liquidity_v2(liquidity, token_max_a, token_max_b, None)
//      signed by market_authority PDA seeds
// 5. Re-read Orca Position; assert liquidity delta == requested
// 6. amount_a/amount_b := snapshot - post-balance   // actual spend, not the quote
// 7. emit LiquidityAdded
```

Step 6 matters: the *actual* token spend is derived from observed vault deltas, never from the client's quote. All PERMA collateral accounting uses the observed values.

### D.2 `remove_liquidity_for_short`

```rust
pub fn remove_liquidity_for_short(
    ctx: Context<RemoveLiquidityForShort>,
    liquidity: u128,
    token_min_a: u64,
    token_min_b: u64,
    close_after: bool,
) -> Result<LiquidityDelta>
```

| | |
|---|---|
| **Inputs** | Liquidity to remove (`== position.liquidity` for a full close), minimum-received guards, `close_after` |
| **Outputs** | `LiquidityDelta { liquidity_removed, amount_a, amount_b }` |
| **Accounts** | §B.3, plus §B.4 and §B.6 when `close_after` |
| **Invariants** | Never removes more than `position.liquidity`; withdrawn tokens land in PERMA vaults only |
| **CU note** | **Measured** (01B, local validator): `decrease_liquidity_v2` + `collect_fees_v2` = **86 500 CU / 821 bytes**; `close_position` = **29 562 CU / 442 bytes**. `close_position` is issued as its own instruction (`adapter_close_position`) because `position_authority` is a PDA only the program can sign for. |

**Full-close sequence — exactly three steps, in this order.** Steps 1–2 run inside
`adapter_remove_liquidity(close_after = true)`; step 3 is the separate
`adapter_close_position` instruction, because `position_authority` is a PDA that only
the program can sign for — a client cannot issue it.

```
1. decrease_liquidity_v2(position.liquidity, min_a, min_b, None)   // liquidity -> 0
2. collect_fees_v2(None)                                            // fee_owed_a/b -> 0
3. close_position()                                                 // burns NFT, refunds rent
```

Two non-obvious constraints make this the *only* correct ordering:

- **Do not insert `update_fees_and_rewards` between steps 1 and 2.** It would fail. Orca's `_calculate_modify_liquidity` opens with `if liquidity_delta == 0 && position.liquidity == 0 { return Err(LiquidityZero) }`, and `update_fees_and_rewards` is exactly the `liquidity_delta == 0` case. After step 1 the position has zero liquidity, so the call errors with `LiquidityZero` (0x177c). `update_fees_and_rewards` is only for refreshing fees on a position that **still holds** liquidity.
- **Step 2 is not optional, and step 1 is what makes it necessary.** `decrease_liquidity` routes through the same `calculate_modify_liquidity`, which updates fee and reward growths as a side effect — so step 1 *populates* `fee_owed_a/b`. Skipping step 2 therefore leaves fees owed, and step 3 fails with `ClosePositionNotEmpty` (0x1775).

If the pool ever has reward emissions configured, `collect_reward_v2` must be called for each active reward index before step 3. MVP's allowlisted pool must be verified to have **no active rewards** at market-creation time, and the Market account records that fact.

Partial removes call step 1 only, with `close_after = false`.

### D.3 `get_sqrt_price_x64` / `get_current_tick`

```rust
pub fn get_sqrt_price_x64(whirlpool: &Account<Whirlpool>) -> u128   // whirlpool.sqrt_price
pub fn get_current_tick  (whirlpool: &Account<Whirlpool>) -> i32    // whirlpool.tick_current_index
```

Pure reads of the already-deserialized `Whirlpool` account — no CPI, negligible CU. Both **must** be re-read inside the instruction that uses them; never pass a price in from the client.

For the example above, `sqrt_price_x64` at the range bounds:

| Tick | `sqrt_price_x64` |
|---|---|
| `-17152` | `7825054952500434944` |
| `-15104` | `8668758966488156160` |

Useful as test fixtures for the conversion helpers.

### D.4 `RangePremiumState::available_short_liquidity()` — the long-mint gate

```rust
impl RangePremiumState {
    /// total_short_liquidity − total_long_liquidity, saturating. Derived; never stored.
    pub fn available_short_liquidity(&self) -> u128
}
```

Returns **PERMA-owned short liquidity** for the exact range, read from PERMA's `RangePremiumState` PDA (`["range", market, lower_le, upper_le]`) — *not* from `whirlpool.liquidity`. The Whirlpool aggregates every LP on Orca; selling longs against liquidity PERMA does not control would break the inventory invariant. The long-mint path rejects with `NoShortInventory` when `requested > available`. Owned by [06-long-mint-inventory.md](06-long-mint-inventory.md); the adapter only exposes the read.

---

## Algorithms & Pseudocode

The two liquidity flows are specified in §D.1 and §D.2. The price→tick→array derivation is specified in §C.2–§C.4. No further algorithm lives in this component; the adapter deliberately contains no economic logic.

## Invariants

1. **Single destination.** Every CPI targets `WHIRLPOOL_PROGRAM_ID` and `market.whirlpool`. No other program or pool is reachable from the adapter.
2. **PDA authority.** Every Orca position PERMA creates is authorized by `market_authority`; no user key is ever `position_authority`.
3. **Conservation.** Tokens leaving PERMA vaults on add equal tokens entering the Whirlpool vaults, modulo Orca's rounding, which always favors the pool.
4. **Observed over quoted.** Collateral accounting uses measured vault deltas, never client-supplied estimates.
5. **Alignment.** Any tick reaching a CPI satisfies `tick % tick_spacing == 0` and lies within `±443636`.
6. **Array correctness.** Every passed TickArray key equals the PDA derived from the tick it serves.
7. **No orphans.** A PERMA position with `liquidity == 0` and `close_after` either holds a closed Orca position or is flagged for a follow-up close; it is never silently abandoned.

## Failure Modes & Errors

Orca error codes below are from `programs/whirlpool/src/errors.rs` at the pinned commit.

| PERMA error | Trigger | Orca-side cause (code) |
|---|---|---|
| `WrongWhirlpoolProgram` | CPI target is not the pinned program ID | — (caught pre-CPI) |
| `WhirlpoolNotAllowlisted` | Pool ≠ `market.whirlpool` | — (caught pre-CPI) |
| `TickArrayNotInitialized` | Array missing or PDA mismatch | account-not-initialized; `TickNotFound` `0x1779` |
| `TickNotAlignedToSpacing` | `tick % tick_spacing != 0` | `InvalidTickIndex` `0x177a` |
| `TickOutOfBounds` | Tick beyond `±443636` | `TickArrayIndexOutofBounds` `0x1773` |
| `InvalidRange` | `tick_lower >= tick_upper` | `InvalidTickIndex` `0x177a` |
| `PositionAuthorityMismatch` | `position_authority` is not `market_authority` | `MissingOrInvalidDelegate` `0x1783` |
| `UnexpectedRemainingAccounts` | Caller injected extra accounts | — (caught pre-CPI) |
| `SlippageExceeded` | Actual amounts breached the caps | `TokenMaxExceeded` `0x1781` / `TokenMinSubceeded` `0x1782` |
| `ClosePositionNotEmpty` *(propagated)* | Close attempted with liquidity or fees outstanding | `ClosePositionNotEmpty` `0x1775` |
| *(propagated raw)* | Any unmapped Orca error — e.g. `LiquidityZero` `0x177c`, `InvalidTickSpacing` `0x1774`, `InvalidTickArraySequence` `0x1787` | the Orca code itself |

Unmapped Orca errors **propagate unmapped** — there is no `CPIFailure` wrapper. The raw Orca code appears in the transaction logs, which is what the `0x1775` / `0x177c` regression guards in `tests/adapter-liquidity.ts` assert on.

## Security Notes

- **Program ID allowlist.** `WHIRLPOOL_PROGRAM_ID` is a compile-time constant compared with `require_keys_eq!` on every entry point. A caller passing a look-alike program that mimics the Whirlpool account layout would otherwise drain the vaults.
- **Whirlpool address allowlist.** MVP has exactly one market. The pool address is fixed at `create_market` and stored on the Market account; the adapter never accepts a pool from instruction data.
- **No arbitrary remaining accounts.** `RemainingAccountsInfo` is Orca's transfer-hook channel. Because SOL/USDC have no hooks, MVP passes `None` and asserts `remaining_accounts.is_empty()`. Accepting caller-supplied remaining accounts would let an attacker route token transfers through an arbitrary hook program.
- **Position ownership.** The position NFT lives in an ATA owned by `market_authority`. A user can never hold, transfer, or independently close a PERMA short's Orca position; Orca's own `verify_position_authority` then guarantees only PERMA can modify it.
- **Tick / price manipulation.** `tick_current_index` and `sqrt_price` are instantaneous and manipulable within a single transaction by anyone who can move the pool. They are therefore usable for **range gating and display only**. **Fair MVP has no settlement or solvency figure that depends on price** — solvency is token balances plus premium liability, no price input ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)). Note that Orca Whirlpool exposes **no TWAP**: `orca_whirlpools_client` 8.0.0 has no observation array, and the `Oracle` PDA is adaptive-fee state, so a manipulation-resistant price cannot be built from the pool alone. Any future price-dependent operation (Part B) needs an external source first; `OracleDeviationTooHigh` is reserved for that and is not defined today. The adapter must not expose a "current price" helper that invites settlement use.
- **Rent griefing.** TickArray init is user-funded and non-refundable while the array holds initialized ticks. The UI must disclose the one-time cost when a range requires a new array.
- **Reentrancy.** Solana's account-locking model plus Anchor's mutable borrow rules prevent CPI reentry into PERMA; regardless, all PERMA state is written **after** the CPI returns and is reconciled against observed deltas.

## Test Cases

Run against `solana-test-validator` with the Whirlpool program and the allowlisted pool cloned from devnet (see [`RELEASE-GATE.md`](../06-testing/RELEASE-GATE.md) §3).

- [ ] **Happy path — add.** Open position + `increase_liquidity_v2` on `[-17152, -15104]`; assert Orca `Position.liquidity` matches, vaults decreased, `LiquidityAdded` emitted.
- [ ] **Happy path — partial remove.** Remove 50%; assert `Position.liquidity` halved and the position stays open.
- [ ] **Happy path — full close.** Run the 3-step sequence; assert the Orca position account is closed and rent refunded.
- [ ] **Close without collecting fees.** After a pool that accrued fees, skip `collect_fees_v2` → expect Orca `ClosePositionNotEmpty` `0x1775`. *Regression guard for §D.2 step 2.*
- [ ] **`update_fees_and_rewards` on a drained position.** Call it after a full `decrease_liquidity_v2` → expect Orca `LiquidityZero` `0x177c`. *Regression guard proving the 3-step sequence is correct and a 4-step one is not.*
- [ ] **Missing TickArray.** Choose a range whose upper array is uninitialized → expect `TickArrayNotInitialized`; then bundle `initialize_tick_array` and assert success.
- [ ] **Tick not aligned.** Pass `tick_lower = -17150` on a `tick_spacing = 64` pool → expect `TickNotAlignedToSpacing`.
- [ ] **Negative-tick array derivation.** Unit-test `start_tick_index` for `-17152` → `-22528` and `-15104` → `-16896`; assert truncating division would have produced the wrong answer.
- [ ] **Same-array range.** A range narrow enough that lower and upper share an array → assert the same pubkey passed twice succeeds.
- [ ] **Wrong whirlpool.** Pass a different Orca pool → expect `WhirlpoolNotAllowlisted`.
- [ ] **Wrong program.** Pass a cloned look-alike program ID → expect `WrongWhirlpoolProgram`.
- [ ] **Injected remaining accounts.** Append an arbitrary account → expect `UnexpectedRemainingAccounts`.
- [ ] **Slippage.** Set `token_max_a` one below the required amount → expect `SlippageExceeded`.
- [ ] **Compute ceiling.** Assert `open_position` + `increase_liquidity_v2` + optional TickArray init fits in one transaction under a 400k CU request and within the 1232-byte transaction size limit. If it does not, the SDK must split TickArray init into a preceding transaction.

## Observability & Events

```rust
LiquidityAdded   { market, perma_position, orca_position, tick_lower, tick_upper, liquidity, amount_a, amount_b }
LiquidityRemoved { market, perma_position, orca_position, liquidity, amount_a, amount_b, closed: bool }
// TickArrayRequired / FeesCollected: NOT emitted. A missing array fails TickArrayNotInitialized (no event);
// collected fees land in the vault deltas and surface as `returned_*` on ShortBurned.
```

All amounts are observed post-CPI values. Indexed per [11-events-indexing.md](11-events-indexing.md).

## MVP Done Definition

- [ ] CPIs `open_position`, `increase_liquidity_v2`, `decrease_liquidity_v2`, `collect_fees_v2`, `close_position` against the pinned Whirlpool commit.
- [ ] Derives both TickArray PDAs correctly for negative ticks, using `div_euclid` and `to_string()` seeds.
- [ ] Rejects missing / misaligned / out-of-bounds ticks before any CPI, with the mapped PERMA error.
- [ ] Enforces the program-ID and whirlpool-address allowlists and the empty-remaining-accounts rule.
- [ ] All Orca positions are authorized by `market_authority`; no user key is ever `position_authority`.
- [ ] Full close runs the 3-step sequence (`decrease_liquidity_v2` → `collect_fees_v2` → `close_position`) and leaves no orphaned Orca position.
- [ ] Reads `sqrt_price`, `tick_current_index`, `tick_spacing`, and `liquidity` from the live `Whirlpool` account, with no external oracle.
- [ ] Every test in **Test Cases** passes on a local validator with cloned Orca accounts.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
