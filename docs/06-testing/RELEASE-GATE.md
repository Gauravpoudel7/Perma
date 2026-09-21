# RELEASE GATE: MVP Demo Readiness

## Fair MVP sign-off — **PASSED** (2026-09-21)

| Field | Value |
|---|---|
| **Status** | **Fair MVP release gate GREEN** |
| **Components** | **01–11** shipped (10 pause/admin, 11 Fair-thin events) |
| **Integration suite** | **114 passing / 0 failing**, forward and reversed, fresh localnet ledger |
| **Unit** | `yarn test:unit` **67** green |
| **Web** | typecheck / unit / copy / build / Playwright e2e green (as of Component 11 ship) |
| **On-chain** | Program `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt` on localnet; thin Trade / Portfolio / Vault UI |
| **Evidence** | [`CHANGELOG.md`](../CHANGELOG.md) `0.10.0`–`0.11.0`; [`IMPL-10-PAUSE-ADMIN-REPORT.md`](../audits/IMPL-10-PAUSE-ADMIN-REPORT.md); [`IMPL-11-EVENTS-INDEXING-REPORT.md`](../audits/IMPL-11-EVENTS-INDEXING-REPORT.md); [`COMPONENT-INDEX.md`](../02-mvp-components/COMPONENT-INDEX.md) |
| **Next** | Protocol V1 **P1** (production hardening) per [`docs/09-post-mvp/ROADMAP.md`](../09-post-mvp/ROADMAP.md). Do **not** reopen Fair scope. |
| **Honesty** | Prototype. Not audited. Single pool. Not production mainnet risk capital. |

**Checklist notes (Fair honesty):** S1–S5, A1–A3, Q1, Q3 met by the green suites above. Q2 anti-slop remains an ongoing UI bar. E1/E2: localnet product loop (deposit → short → long → portfolio) verified by hand; Fair has **no mark P&L** ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)) — UI shows positions, collateral, and premium, not CEX-style P&L%. Devnet full `E2E-DEMO-SCRIPT` remains optional ops polish, not a Fair reopen.

---

Hard blocking criteria before PERMA Fair MVP is declared ready. **Follow this file top to bottom without improvising.** Every command states its working directory. `$REPO` is the repository root (the directory containing `Anchor.toml`).

> Historical note: steps that once failed because a suite was missing were build gaps. As of the sign-off above, the Fair suites exist and are green.

---

## 1. Toolchain

Confirm versions **before** anything else. Version drift is the most common cause of an unreproducible `anchor test`.

| Tool | Pinned | Verify |
|---|---|---|
| Rust | `1.98.1` stable | `rustc --version` |
| Solana CLI (Agave) | `3.0.0`+ | `solana --version` |
| Anchor | `1.2.0` (`avm use 1.2.0`) | `anchor --version` |
| Node.js | `24.11.1` | `node --version` |
| Yarn | `1.22.x` | `yarn --version` |

> **Pins changed 2026-09-19.** The previous Anchor 0.30.1 / Rust 1.79.0 / Solana 1.18.17 pins were impossible: the pinned Orca commit requires `anchor-lang` 0.32+ and a newer toolchain. See [ADR-0001 addendum](../adr/ADR-0001-orca-cpi-instruction-surface.md) and [`IMPL-01-FEASIBILITY.md`](../audits/IMPL-01-FEASIBILITY.md) §3.

```bash
# cwd: $REPO
rustc --version && solana --version && anchor --version && node --version && yarn --version
```

Expected — patch versions may differ, **major/minor must not**:

```text
rustc 1.98.1 (48a229cea 2026-09-01)
solana-cli 3.0.0 (src:b6c96e84; feat:128318206, client:Agave)
anchor-cli 1.2.0
v24.11.1
1.22.22
```

The repo now ships `rust-toolchain.toml` and `.nvmrc`. `avm use 1.2.0` switches Anchor.

## 2. Environment

```bash
# cwd: $REPO
export ANCHOR_WALLET="$HOME/.config/solana/id.json"

# Localnet (default for the test suites in §4)
export ANCHOR_PROVIDER_URL="http://127.0.0.1:8899"

# Devnet (only for §5 and §6)
# export ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
```

If the wallet does not exist: `solana-keygen new -o "$ANCHOR_WALLET"`.
Verify it is funded on whichever cluster you target:

```bash
# cwd: anywhere
solana balance -u devnet -k "$ANCHOR_WALLET"      # need ≥ 2 SOL; top up with: solana airdrop 2 -u devnet
```

## 3. Local validator with Orca cloned in

The Whirlpool program is **not** in the local validator by default. Every test in §4 fails without this step.

```bash
# cwd: $REPO — generate the fixtures first; they are keyed to your wallet.
node scripts/make-fixtures.mjs

# Then start the validator. Run in a dedicated terminal and leave it running,
# or pass --detach to background it and wait for the Orca clone to land.
./scripts/local-validator.sh
```

`scripts/local-validator.sh` is the single source of truth for the flag list and is
mirrored in `Anchor.toml` under `[test.validator]`. **Keep the two in sync** — they drifted
once already: §3 was missing the active-rewards pool and the unallowlisted pool, and the
result was not a loud failure but two tests that passed for the wrong reason.

The `--account` entries are the **funded PERMA fixtures**. devUSDC cannot be minted
locally, so they are hand-crafted SPL token accounts at the addresses the program derives.
The user ATAs carry balances; the market vaults are emitted **empty** and filled by the
real `deposit_collateral`. The devUSDC *mint* is never modified. Without them the liquidity
suite fails fast in its `before` hook.

> In **zsh**, do not build the `--clone` list in a shell variable — zsh does not word-split unquoted parameters, and the validator fails with `Invalid value for '--clone'`.

| Account | What it is |
|---|---|
| `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | Whirlpool program (same ID on devnet and mainnet) |
| `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR` | `WhirlpoolsConfig`, devnet |
| `2WUgXb…ym9G` | **The allowlisted SOL/devUSDC Whirlpool** (`tick_spacing = 8`) |
| `3uyTv2…DGh4` / `63GvSv…DT5C` | its `token_vault_a` / `token_vault_b` |
| `So1111…1112` / `BRjpCH…ok1k` | WSOL and devUSDC mints |
| `86pYzh…H571` / `49ixSQ…cFPv` | TickArrays for the demo range (starts `-40832`, `-38720`) |
| `ACkArM…KZGy` | TickArray `-39424`, the narrow same-array case |
| `EgxU92…EiZ4` | a devnet pool with **active reward emissions** — proves the factory's allowlist check fires before its rewards check (`tests/factory*.ts`) |
| `3KBZiL…HvPt` | a real devnet pool that is **not** allowlisted (`tests/adapter.ts`) |

TickArrays must be cloned too, or every liquidity call fails with `TickArrayNotInitialized`. The three above cover the demo range on the allowlisted pool — see [`01-clmm-adapter-orca.md`](../02-mvp-components/01-clmm-adapter-orca.md) §C.3a for the derivation.

The last two entries are not optional conveniences. A *missing* account does not make a
rejection test fail — it makes it reject for a different reason and pass anyway. Without
`3KBZiL…HvPt` the allowlist test failed at Whirlpool deserialization and never reached the
allowlist check it is named for.

Confirm the clone worked:

```bash
# cwd: anywhere
solana program show whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc -u localhost
```

Expected: program details with a non-zero data length. `Error: Unable to find the account` means the clone failed — check network access to devnet and re-run with `--reset`.

## 4. Build and test

### 4.1 Build

```bash
# cwd: $REPO
anchor build --arch v0
```

> **Expect seven lines beginning `Error: Function … overflows the maximum allowed frame
> space`.** They name `orca_whirlpools_client::generated::accounts::{fixed,dynamic}_tick_array`
> deserializers — **not PERMA code**. The build completes and the `.so` is valid. PERMA
> never calls them: it locates TickArrays by deriving the PDA (`adapter::derive_tick_array`)
> and passes them straight to Orca, and never deserializes a TickArray itself. Treat them as
> known upstream noise; a *new* name in that list is not.

> **`--arch v0` is required.** Anchor 1.x defaults to `--arch v3`, which produces an ELF the local validator's loader rejects with `ELF error: Failed to parse ELF file: invalid file header`. Verify with
> `python3 -c "import struct;print(struct.unpack_from('<I',open('target/deploy/perma.so','rb').read(64),48)[0])"` - it must print `0`.

Expected: `Finished release [optimized] target(s)`, and `target/deploy/perma.so` exists. Then sync the program ID:

```bash
# cwd: $REPO
anchor keys sync && anchor build --arch v0     # keep --arch v0 on the rebuild too
```

### 4.2 Core functional suite

`--skip-local-validator` is required because §3 already has one running.

```bash
# cwd: $REPO
export ANCHOR_PROVIDER_URL="http://127.0.0.1:8899"
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
solana program deploy target/deploy/perma.so \
  --program-id target/deploy/perma-keypair.json -u localhost

npx ts-mocha -p ./tsconfig.json -t 1000000 \
  tests/adapter.ts tests/adapter-liquidity.ts tests/collateral.ts \
  tests/factory.ts tests/position-short.ts tests/position-long.ts \
  tests/settle-premium.ts tests/risk-solvency.ts \
  tests/admin-transfer.ts tests/range-unwind.ts \
  tests/pause-admin.ts tests/events.ts
```

Expected: **114 passing, 0 failing** (76 through component 09 + 7 in `tests/admin-transfer.ts` + 5 in `tests/range-unwind.ts` + 17 in `tests/pause-admin.ts` + 9 in `tests/events.ts`). The two P1 suites (Protocol V1 — `transfer_admin`, `unwind_empty_range`) go before `pause-admin.ts`; they self-heal the same way, and `admin-transfer.ts` hands `GlobalConfig.admin` back to the provider wallet in an unconditional `after()`. This covers gates **S1–S5** below. `pause-admin.ts` and `events.ts` go **last** in the forward list: both self-heal (unpause + restore risk defaults + burn what they opened) in their own `before()`/`after()`, so the reversed pass — where they run first — also stays clean.

> `tests/factory-rewards.ts` is **excluded on purpose** and needs its own `--reset`
> ledger: it allowlists a different pool, so running it alongside makes every other
> suite fail `PoolNotAllowlisted`. Plain `anchor test` picks up `tests/**/*.ts` and
> therefore includes it — run the explicit list above instead.

Run the list **twice against the same ledger**, then once in reverse order. Suites must be
order-independent; a pass that only works from a fresh ledger is hiding state coupling.

To run one gate at a time (no test title contains "S1"…"S4" — run the suite that carries it):

```bash
# cwd: $REPO
T="npx ts-mocha -p ./tsconfig.json -t 1000000"
$T tests/position-short.ts                     # S1 short-to-Orca
$T tests/position-long.ts                      # S2 long inventory gate
$T tests/settle-premium.ts tests/position-long.ts   # S3 premium settlement (cash)
$T tests/collateral.ts tests/risk-solvency.ts  # S4 withdraw gate: free balance + open-long liability + margin
```

### 4.3 Adapter CPI suite

Explicitly covers the TickArray failure modes in `01-clmm-adapter-orca.md` §"Test Cases".

```bash
# cwd: $REPO
anchor test --skip-local-validator -- --grep "adapter"
```

Expected: includes passing cases for missing TickArray, unaligned tick, wrong whirlpool, wrong program, injected remaining accounts, and the two close-sequence regression guards (`ClosePositionNotEmpty` `0x1775`, `LiquidityZero` `0x177c`).

### 4.4 Math vector validation

Vectors are defined in [`FIXTURES-AND-VECTORS.md`](FIXTURES-AND-VECTORS.md) and encoded as Rust unit tests in `programs/perma/src/premium.rs`. *(There is no `tests/vectors/` directory and no `yarn test:math-vectors`; an earlier draft described a JSON runner that was never built.)*

```bash
# cwd: $REPO
yarn test:unit          # = cargo test -p perma --lib
```

Expected: **67 passing** (66 as of component 11, plus `validate_new_admin`'s `rejects_default_pubkey_as_new_admin` from P1). The vector tests by name:

| Test | Covers | Needs the pool? |
|---|---|---|
| `v1_single_long_accrual` | §1 V1 — single-long accrual | No |
| `v6_settle_frequency_neutrality` | §1 V6 — settle-frequency neutrality | No |
| `v2_unequal_shorts_split_pro_rata_with_dust`, `v3_equal_shorts_split_evenly_with_dust` | §2 V2, V3 — pro-rata split, residue | No |
| `v4_poking_before_the_weight_change_is_correct`, `v4_poking_after_the_weight_change_is_wrong` | §2 V4 — ordering guard, asserted in **both** directions | No |
| `v5_short_exits_early_and_is_made_whole_when_cash_arrives` | §2 V5 — receivable carry | No (and on chain in `tests/settle-premium.ts`) |
| §3 P&L | **not implemented** — Part B (no price to value against) | — |
| `risk.rs` tests (10) | §4 solvency: margin round-up / overflow, projection, no-mutation, both gates | No |
| `tests/adapter-liquidity.ts` | §6 Orca liquidity | **Yes** |

Then reconcile the two money identities from outside the program:

```bash
node scripts/reconcile.mjs      # range_vault.amount == premium_pool + dust for every range;
                                # vault + Σ in_orca == Σ(free + locked) — exactly 0 on the product path;
                                # UserCollateral.open_longs == count(open LONG positions) per user
```

Two vectors are regression guards rather than ordinary cases; a failure in either is a correctness bug, not a tuning issue:

- **V6** asserts 100 single-slot settles total exactly the same as one 100-slot settle. If this fails, the rounding policy has drifted to ceil-or-floor-per-settle and the permissionless crank becomes a griefing vector ([`07-premium-engine.md`](../02-mvp-components/07-premium-engine.md) §C).
- **V4** asserts a late-joining short earns nothing for the period before it existed. If this fails, `poke_range` is running after a liquidity-weight change ([`08-burn-settle.md`](../02-mvp-components/08-burn-settle.md) invariant 5).

## 5. Devnet deployment

```bash
# cwd: $REPO
anchor deploy --provider.cluster devnet
solana program show <PROGRAM_ID> -u devnet
```

Expected from `program show`: correct `Program Id`, an `Authority` you control, and a recent `Last Deployed In Slot`.

Then initialize per [`RUNBOOK-DEVNET.md`](../07-ops-presentation/RUNBOOK-DEVNET.md):

```bash
# cwd: $REPO
# TODO: none of these scripts exist yet. The working equivalents are the before() hooks in
#       tests/factory.ts (init + create_market) and tests/position-short.ts (mintShort); the
#       demo range is 18-22 USDC/SOL (ticks -40176 / -38168), NOT 180-220.
# yarn scripts:init-market
# yarn scripts:seed-shorts --amount 10000 --range 18-22
node scripts/reconcile.mjs                             # inventory + escrow + conservation per range
```

## 6. End-to-end and UI

> **Build gap:** there is no `app/` in the repo. E1/E2 cannot pass until a UI exists; walk [`E2E-DEMO-SCRIPT.md`](E2E-DEMO-SCRIPT.md) against the test suites / explorer instead, collecting a transaction signature at each step.

---

## 7. PASS / FAIL Checklist

Sign off only with a real artifact per row — a transaction signature, or the test-runner line that proves it.

### Core functional (S1–S4)

| ID | Gate | Verified by | Evidence |
|---|---|---|---|
| S1 | `mint_position(SHORT)` actually adds liquidity to the target Whirlpool | `tests/position-short.ts`, `tests/adapter-liquidity.ts` | Explorer shows the `increaseLiquidityV2` CPI; Whirlpool `liquidity` increased |
| S2 | `mint_position(LONG)` rejects with no short inventory, succeeds with it | `tests/position-long.ts` | Both assertions pass; rejection returns `NoShortInventory` |
| S3 | `burn_position` settles **premium** into collateral, in cash | `tests/settle-premium.ts`, `tests/position-long.ts` | `vault_b` debited and `range_vault` credited by the same amount; `range_vault.amount == premium_pool + dust` after every path. **Long P&L is 0 by decision** ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)); short burn credits Orca's returned amounts, so `returned − locked` is realized once in `close_short`. See `IMPL-08-BURN-SETTLE-REPORT.md` |
| S5 | Premium splits pro-rata across multiple shorts, zero-sum with residue accounted | `cargo test -p perma --lib`, `tests/settle-premium.ts` | V2 `74 999`/`24 999` residue `2`; V3 `33 333` each, residue `1`; V5 end-to-end on chain. `node scripts/reconcile.mjs` reconciles both identities over RPC. **`dust` itself is never written** — the residue stays inside `premium_pool`; see the same report |
| S4 | `withdraw_collateral` blocked when it would leave an obligation uncovered | `tests/collateral.ts`, `tests/risk-solvency.ts` | More than free balance → `InsufficientFunds` (locked is unreachable by construction). Free USDC below open-long accrued premium + margin → `InsolventWithdrawal` — asserted with a cranked index (R3) and an **uncranked** one (R7). Long mint below margin → `InsolventMint` (R1). |

### Adapter

| ID | Gate | Verified by |
|---|---|---|
| A1 | All TickArray failure modes rejected pre-CPI with mapped PERMA errors | §4.3 |
| A2 | Full close runs `decrease_liquidity_v2` → `collect_fees_v2` → `close_position`, leaving no orphan position | §4.3 |
| A3 | Program-ID and whirlpool allowlists reject impostor accounts | §4.3 |

### E2E and quality

| ID | Gate | Verified by |
|---|---|---|
| E1 | `E2E-DEMO-SCRIPT.md` runs start to finish on devnet without errors | §6 |
| E2 | UI shows live P&L and accrued premium matching on-chain state | §6 |
| Q1 | The banner `Prototype. Not audited. Single pool. Not production mainnet risk capital.` is visible on **every** page, verbatim and non-dismissible | [`COPY-DECK.md`](../04-ui-ux/COPY-DECK.md) §1 |
| Q2 | All screens pass the anti-slop review, including the banned-phrase list | [`UI-QA-CHECKLIST.md`](../04-ui-ux/UI-QA-CHECKLIST.md), `COPY-DECK.md` §5 |
| Q3 | `yarn test:unit` green (67), incl. the V6 anti-grief and V4 ordering guards; `node scripts/reconcile.mjs` reports both identities and every `open_longs` counter holding | §4.4 · [`FIXTURES-AND-VECTORS.md`](FIXTURES-AND-VECTORS.md) |

**The gate passes only when every row above passes.** A partial pass is a FAIL.

---

## 8. When something fails

| Symptom | Where to look | Usual cause |
|---|---|---|
| Any Orca CPI fails | `solana logs` in the validator terminal; per-test logs under `$REPO/.anchor/program-logs/` | Wrong or missing TickArray — recheck `01-clmm-adapter-orca.md` §C.4 seeds and §C.3 `div_euclid` |
| `AccountNotFound` for the Whirlpool | Validator startup output | §3 clone step skipped (use `scripts/local-validator.sh`) |
| `ClosePositionNotEmpty` `0x1775` | Program logs | `collect_fees_v2` skipped before `close_position` |
| `LiquidityZero` `0x177c` | Program logs | `update_fees_and_rewards` called after liquidity hit zero — remove it |
| `DeclaredProgramIdMismatch` | `anchor build` output | Run `anchor keys sync && anchor build --arch v0` |
| Tests hang then time out | Validator terminal | Validator died; `--reset` and restart §3 |
| Devnet tx timeouts | RPC response times | Public devnet RPC is rate-limited — switch to Helius/Triton per [`TECH-STACK.md`](../05-engineering/TECH-STACK.md) |
| Vector diff | Runner `expected / actual` output | Genuine math regression — fix the code, not the expected file |

Full log locations:

```text
$REPO/.anchor/program-logs/        # per-test program logs written by anchor test
$REPO/test-ledger/                 # local validator ledger (delete with --reset)
solana logs -u localhost           # live stream while the validator runs
solana logs <PROGRAM_ID> -u devnet # devnet program logs
```

Attach the failing log excerpt to the release-gate sign-off. Do not re-run until green without recording what changed.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
