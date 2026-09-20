# Component: Factory (Allowlisted Market)

## Purpose
The Factory is responsible for the lifecycle of PERMA Markets. In the MVP, it restricts market creation to a single, allowlisted SOL/USDC Orca Whirlpool to minimize risk and complexity.

## User-Facing Behavior
For the MVP, the market is pre-created by the operator. Users do not interact with the Factory directly; they interact with the existing `Market` account.

## Dependencies
- **GlobalConfig**: For admin authority and allowlist definitions.
- **Market**: The target account being created.

## State & PDAs

### Market PDA
`PDA(["market", pool_address])`
Stores the configuration for a specific pool: the Whirlpool and its mints/vaults, the PERMA vaults, `tick_spacing`, and the premium parameters (risk parameters arrive with component 09).

### GlobalConfig PDA
`PDA(["global_config"])`
Stores the admin pubkey and the **single** `allowlisted_whirlpool`. Fair MVP approves exactly one pool, so this is a fixed `Pubkey`, not a collection — the type enforces the PRD constraint. Immutable after init: there is no setter, so an admin-key compromise cannot repoint the protocol at another pool.

```rust
pub struct GlobalConfig { admin: Pubkey, allowlisted_whirlpool: Pubkey, bump: u8 }
```

## Public Interface

### `initialize_global_config()`
- **Caller**: Admin.
- **Action**: Sets the admin key and initial parameters.

### `create_market(pool_address)`
- **Caller**: Admin.
- **Action**:
    1. Verifies `pool_address` is in the allowlist.
    2. **Reads pool geometry from the live Whirlpool account** (§A).
    3. Initializes the `Market` PDA.
    4. Sets the premium parameters from `premium_defaults` (component 09 adds `risk_defaults` the same way).

## Algorithms & Pseudocode

### Market Creation Flow
```rust
// NOTE (component 02): the shipped instruction takes NO `pool_address` arg.
// The whirlpool arrives as an account and the Market PDA derives from it, so a
// parameter would be a redundant value that must equal `whirlpool.key()`.
// Admin + allowlist checks run FIRST - see IMPL-02-FACTORY-REPORT.md.
fn create_market(ctx, pool_address) {
    require!(global_config.allowlisted_whirlpool == pool_address, PoolNotAllowlisted);   // single pubkey, not a Vec
    require!(ctx.whirlpool_program.key() == WHIRLPOOL_PROGRAM_ID, WrongWhirlpoolProgram);
    require!(ctx.whirlpool.key() == pool_address, WhirlpoolNotAllowlisted);

    let wp = Whirlpool::try_deserialize(&ctx.whirlpool)?;

    market.whirlpool           = pool_address;
    market.tick_spacing        = wp.tick_spacing;      // READ LIVE — never hardcoded
    market.token_mint_a        = wp.token_mint_a;
    market.token_mint_b        = wp.token_mint_b;
    market.token_vault_a       = wp.token_vault_a;
    market.token_vault_b       = wp.token_vault_b;
    market.whirlpools_config   = wp.whirlpools_config;
    market.has_active_rewards  = wp.reward_infos.iter().any(|r| r.is_active());
    market.is_paused           = false;
    market.premium_rate        = DEFAULT_PREMIUM_RATE;        // 1_000_000
    market.premium_multiplier  = DEFAULT_PREMIUM_MULTIPLIER;  // 1_000
    // no risk_params in Fair MVP through 08 - component 09 appends long_margin_horizon_slots / long_margin_buffer_usdc
}
```

> ⚠️ **`tick_spacing` is read from the live Whirlpool account and stored on the `Market` PDA. It is never a constant, a parameter, or an assumption.** SOL/USDC exists at several fee tiers with different spacings (1, 2, 4, 8, 16, 32, 64, 96, 128, 256). Every tick-alignment and TickArray derivation downstream reads `market.tick_spacing`; the `tick_spacing = 64` figure used in the [CLMM Adapter](01-clmm-adapter-orca.md) §C worked example is **illustrative only**.

`has_active_rewards` must be **false** for the Fair MVP pool — the adapter's close sequence does not call `collect_reward_v2`. Recording it at market creation makes the assumption explicit and checkable rather than implicit.

---

## A. Selecting and Recording the Allowlisted Whirlpool

Fair MVP allowlists exactly **one** SOL/USDC Whirlpool on devnet. Until it is chosen, `PERMA_WHIRLPOOL` is unset and the integration tests in [`RELEASE-GATE.md`](../06-testing/RELEASE-GATE.md) §3 cannot run.

### Step 1 — Find candidate pools

Devnet `WhirlpoolsConfig` is `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR`; the Whirlpool program is `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` on both clusters.

Either derive the PDA for a chosen fee tier, or list pools with the Orca SDK and pick one that actually has liquidity:

```
seeds = [b"whirlpool", whirlpools_config, token_mint_a, token_mint_b, tick_spacing.to_le_bytes()]
program = whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
```

Mint ordering is **not** arbitrary: `token_mint_a` and `token_mint_b` must be passed in the order the pool was created with (canonically sorted). Deriving with them swapped yields a valid-looking address that does not exist.

### Step 2 — Selection criteria

| Criterion | Requirement | Why |
|---|---|---|
| Pair | WSOL / USDC (devnet mints) | The only Fair MVP market |
| `liquidity` | Non-zero | A dead pool makes the demo meaningless |
| `tick_spacing` | Any — **record it, do not assume** | Drives every alignment check |
| Reward emissions | None active | Adapter close sequence omits `collect_reward_v2` |
| TickArrays near spot | Initialized, or budget to create them | Uninitialized arrays cost rent and an extra instruction |

### Step 3 — Record these seven values

```bash
solana account "$PERMA_WHIRLPOOL" -u devnet --output json
```

| Value | Source | Consumed by |
|---|---|---|
| Whirlpool address | chosen pool | `GlobalConfig.allowlisted_whirlpool`, `Market.whirlpool` |
| `tick_spacing` | `Whirlpool.tick_spacing` | all tick math, TickArray derivation |
| `token_mint_a` / `token_mint_b` | `Whirlpool` | account validation, vault ATAs |
| `token_vault_a` / `token_vault_b` | `Whirlpool` | liquidity CPI account tables |
| `whirlpools_config` | `Whirlpool` | cluster sanity check |
| Program ID | constant | CPI allowlist |
| TickArray start indices for the demo range | derived (adapter §C.3) | validator clone list |

### Step 4 — Fill-in checklist

`PERMA_WHIRLPOOL` is the single canonical name for this value across the repo.

- [x] Pool chosen and its seven values recorded above
- [x] `export PERMA_WHIRLPOOL=<address>` — [`RELEASE-GATE.md`](../06-testing/RELEASE-GATE.md) §2/§3
- [x] `PERMA_WHIRLPOOL_VAULT_A` / `_VAULT_B` exported for the validator clone list — §3
- [x] Address replaces `TODO_ALLOWLIST_ADDRESS` in [`FIXTURES-AND-VECTORS.md`](../06-testing/FIXTURES-AND-VECTORS.md) §6
- [x] `tick_spacing` recorded in `FIXTURES-AND-VECTORS.md` §6 (**8**); the spacing-64 example re-labelled illustrative
- [x] TickArray start indices for the demo range recomputed **for the real spacing** (adapter §C.3a)
- [x] Added to `GlobalConfig` via `initialize_global_config` *(component 02)*
- [x] `has_active_rewards == false` confirmed (asserted on-chain at `create_market`)
- [ ] `yarn scripts:init-market` run — [`RUNBOOK-DEVNET.md`](../07-ops-presentation/RUNBOOK-DEVNET.md) *(ops-only; devnet deploy not yet done)*

**Premium vectors (V1–V6) are independent of the pool** — they depend only on `premium_rate`, `premium_multiplier`, and `PREMIUM_SCALE`, so they pass before a pool is chosen. Only the Orca liquidity vector in §6 needs the real address.

## Invariants
- **Uniqueness**: Only one `Market` account can exist per `pool_address`.
- **Authorization**: Only the `GlobalConfig` admin can call `create_market`.

## Failure Modes & Errors
- **`PoolNotAllowlisted`**: The requested pool is not approved for PERMA.
- **`MarketAlreadyExists`**: Market account already initialized.
- **`Unauthorized`**: Caller is not the admin.

## Security Notes
- **Admin Key Security**: The admin key should be a multisig for any mainnet-like demo.
- **Strict Allowlist**: No "dynamic" allowlisting in MVP; it must be a hard-coded or admin-set list.

## Test Cases
- **Success**: Admin creates the SOL/USDC market.
- **Failure**: Non-admin attempts to create a market $\rightarrow$ Expect `Unauthorized`.
- **Failure**: Admin attempts to create a market for an unallowlisted pool $\rightarrow$ Expect `PoolNotAllowlisted`.
- **Success**: `Market.tick_spacing` equals the live `Whirlpool.tick_spacing` $\rightarrow$ assert against a cloned pool whose spacing is **not** 64, proving nothing is hardcoded.
- **Success**: `token_mint_a/b` and `token_vault_a/b` on `Market` match the live Whirlpool.
- **Failure**: Pool with active reward emissions $\rightarrow$ `has_active_rewards` is true; market creation is rejected for Fair MVP.

## Observability & Events
- `MarketCreated(pool_address, admin)`

## MVP Done Definition
- [x] `GlobalConfig` PDA implemented and initialized. *(component 02)*
- [x] `create_market` successfully initializes a `Market` PDA for an allowlisted pool. *(component 02)*
- [x] `tick_spacing`, mints, and vaults are read from the live Whirlpool, never hardcoded. *(components 01/02)*
- [x] `premium_rate` and `premium_multiplier` set from the documented defaults at `create_market`. **No update path exists** (immutable; a setter is component 10). *(component 02)*
- [x] The §A Step 4 checklist is fully ticked; the pool is `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G`, hard-coded in tests and fixtures (no env var).
- [x] Admin authorization is strictly enforced. *(component 02)*
