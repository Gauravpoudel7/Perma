# RELEASE GATE: MVP Demo Readiness

Hard blocking criteria before the PERMA MVP is declared "Ready to Present", plus the exact commands to verify each one. **Follow this file top to bottom without improvising.** Every command states its working directory. `$REPO` is the repository root (the directory containing `Anchor.toml`).

> These commands describe the MVP as specified. Until the corresponding code exists, a step that fails because a script or suite is missing is a **build gap**, not a gate failure — record it in §7 and move on.

---

## 1. Toolchain

Confirm versions **before** anything else. Version drift is the most common cause of an unreproducible `anchor test`.

| Tool | Pinned | Verify |
|---|---|---|
| Rust | `1.79.0` stable | `rustc --version` |
| Solana CLI | `1.18.17` | `solana --version` |
| Anchor | `0.30.1` | `anchor --version` |
| Node.js | `20.11.0` LTS | `node --version` |
| Yarn | `1.22.x` (Anchor's default test runner) | `yarn --version` |

```bash
# cwd: $REPO
rustc --version && solana --version && anchor --version && node --version && yarn --version
```

Expected — patch versions may differ, **major/minor must not**:

```text
rustc 1.79.0 (129f3b996 2024-06-10)
solana-cli 1.18.17 (src:...; feat:..., client:Agave)
anchor-cli 0.30.1
v20.11.0
1.22.22
```

> ⚠️ The repository currently ships **no** `rust-toolchain.toml`, `.tool-versions`, or `.nvmrc`. Versions above are the agreed pins and must be added as version files in the first implementation PR. Until then, verify by hand. `avm use 0.30.1` switches Anchor; `solana-install init 1.18.17` switches the Solana CLI.

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
# cwd: $REPO — run in a dedicated terminal and leave it running
solana-test-validator --reset \
  --url https://api.devnet.solana.com \
  --clone-upgradeable-program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc \
  --clone FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR \
  --clone "$PERMA_WHIRLPOOL" \
  --clone "$PERMA_WHIRLPOOL_VAULT_A" \
  --clone "$PERMA_WHIRLPOOL_VAULT_B"
```

| Account | What it is |
|---|---|
| `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | Whirlpool program (same ID on devnet and mainnet) |
| `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR` | `WhirlpoolsConfig`, devnet |
| `$PERMA_WHIRLPOOL` | The allowlisted SOL/USDC Whirlpool — set this to the address recorded at `create_market` |
| vaults A/B | `token_vault_a` / `token_vault_b` read off that Whirlpool account |

Also clone the TickArray accounts covering your test range, or the suite must create them via `initialize_tick_array`. For the `[-17152, -15104]` range at `tick_spacing = 64`, that is the arrays with start indices **`-22528`** and **`-16896`** — see [`01-clmm-adapter-orca.md`](../02-mvp-components/01-clmm-adapter-orca.md) §C.3–§C.4 for the derivation and exact PDA seeds.

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
anchor build
```

Expected: `Finished release [optimized] target(s)`, and `target/deploy/perma.so` exists. Then sync the program ID:

```bash
# cwd: $REPO
anchor keys sync && anchor build
```

### 4.2 Core functional suite

`--skip-local-validator` is required because §3 already has one running.

```bash
# cwd: $REPO
anchor test --skip-local-validator
```

Expected: every suite green, `0 failing`. This covers gates **S1–S4** below.

To run one gate at a time:

```bash
# cwd: $REPO
anchor test --skip-local-validator -- --grep "S1"     # short-to-Orca
anchor test --skip-local-validator -- --grep "S2"     # long inventory gate
anchor test --skip-local-validator -- --grep "S3"     # settlement
anchor test --skip-local-validator -- --grep "S4"     # solvency
```

### 4.3 Adapter CPI suite

Explicitly covers the TickArray failure modes in `01-clmm-adapter-orca.md` §"Test Cases".

```bash
# cwd: $REPO
anchor test --skip-local-validator -- --grep "adapter"
```

Expected: includes passing cases for missing TickArray, unaligned tick, wrong whirlpool, wrong program, injected remaining accounts, and the two close-sequence regression guards (`ClosePositionNotEmpty` `0x1775`, `LiquidityZero` `0x177c`).

### 4.4 Math vector validation

Vectors are defined in [`FIXTURES-AND-VECTORS.md`](FIXTURES-AND-VECTORS.md); the machine-readable copy lives at `tests/vectors/`.

```bash
# cwd: $REPO
yarn test:math-vectors
```

| Input file | Expected-output file | Covers |
|---|---|---|
| `tests/vectors/premium.json` | `tests/vectors/expected/premium.json` | `FIXTURES-AND-VECTORS.md` §1 |
| `tests/vectors/pnl-short.json` | `tests/vectors/expected/pnl-short.json` | §2 |
| `tests/vectors/solvency.json` | `tests/vectors/expected/solvency.json` | §3 |
| `tests/vectors/orca-liquidity.json` | `tests/vectors/expected/orca-liquidity.json` | §4 |

Expected: `N passing (Nms)` with zero diffs. On mismatch the runner prints `expected / actual` per vector — treat any diff as a **FAIL**, never update the expected file to match the code without an accompanying spec change.

> ⚠️ `FIXTURES-AND-VECTORS.md` §4 still carries placeholder values (`SOL = X, USDC = Y`). Those must be replaced with computed Whirlpool figures before this sub-gate can pass.

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
yarn scripts:init-market                              # global config + allowlisted SOL/USDC market
yarn scripts:seed-shorts --amount 10000 --range 180-220   # so the long path is demoable
yarn perma-cli get-market-status                      # expect non-zero short inventory
```

## 6. End-to-end and UI

```bash
# cwd: $REPO/app
yarn install && yarn dev          # http://localhost:3000
```

Walk [`E2E-DEMO-SCRIPT.md`](E2E-DEMO-SCRIPT.md) start to finish against devnet, collecting a transaction signature at each step.

---

## 7. PASS / FAIL Checklist

Sign off only with a real artifact per row — a transaction signature, or the test-runner line that proves it.

### Core functional (S1–S4)

| ID | Gate | Verified by | Evidence |
|---|---|---|---|
| S1 | `mint_options(SHORT)` actually adds liquidity to the target Whirlpool | §4.2 `--grep "S1"` | Explorer shows the `increaseLiquidityV2` CPI; Whirlpool `liquidity` increased |
| S2 | `mint_options(LONG)` rejects with no short inventory, succeeds with it | §4.2 `--grep "S2"` | Both assertions pass; rejection returns `NoShortInventory` |
| S3 | `burn_options` settles P&L + premium into collateral | §4.2 `--grep "S3"` | Collateral delta matches the §4.4 vectors |
| S4 | `withdraw_collateral` blocked when it would leave a position insolvent | §4.2 `--grep "S4"` | Rejection returns `InsolventWithdrawal` |

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
| Q3 | Math vectors match expected outputs with zero diffs | §4.4 |

**The gate passes only when every row above passes.** A partial pass is a FAIL.

---

## 8. When something fails

| Symptom | Where to look | Usual cause |
|---|---|---|
| Any Orca CPI fails | `solana logs` in the validator terminal; per-test logs under `$REPO/.anchor/program-logs/` | Wrong or missing TickArray — recheck `01-clmm-adapter-orca.md` §C.4 seeds and §C.3 `div_euclid` |
| `AccountNotFound` for the Whirlpool | Validator startup output | §3 clone step skipped or `$PERMA_WHIRLPOOL` unset |
| `ClosePositionNotEmpty` `0x1775` | Program logs | `collect_fees_v2` skipped before `close_position` |
| `LiquidityZero` `0x177c` | Program logs | `update_fees_and_rewards` called after liquidity hit zero — remove it |
| `DeclaredProgramIdMismatch` | `anchor build` output | Run `anchor keys sync && anchor build` |
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
