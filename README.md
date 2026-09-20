# PERMA | Perpetual Options Powered by Solana Liquidity

**Prototype. Not audited. Single pool. Not production mainnet risk capital.**

PERMA is a Solana-native perpetual-options protocol that uses concentrated-liquidity positions as the option primitive, implementing Panoptic V1–equivalent economics—starting with a one-pool Orca MVP.

## 🚀 Quick Start
1. **Read the Docs**: Start with the [Product PRD](PRD.md) and the [MVP Scope](docs/00-overview/MVP-SCOPE.md).
2. **Setup Dev Environment**: Follow the [Local Dev Guide](docs/05-engineering/LOCAL-DEV.md).
3. **Run Tests**: `anchor test`.

## 🛠️ Technical Core
- **Chain**: Solana (Devnet).
- **CLMM**: Orca Whirlpool.
- **Stack**: Rust/Anchor $\rightarrow$ Next.js/TypeScript.

## 📂 Documentation
Full business-class documentation is available in the `/docs` directory:
- **Product & Scope**: `docs/00-overview/`
- **System Architecture**: `docs/01-architecture/`
- **Component Specs**: `docs/02-mvp-components/`
- **API & SDK**: `docs/03-api-interfaces/`
- **Design & UI**: `docs/04-ui-ux/`
- **Engineering**: `docs/05-engineering/`
- **Testing & Release**: `docs/06-testing/`
- **Ops & Presentation**: `docs/07-ops-presentation/`

## ⚖️ Disclaimer
This repository contains a prototype for a technical demonstration. It is not intended for use with real capital. The authors are not responsible for any losses incurred through the use of this prototype.

---

## Running the on-chain test suites

Components 01–09 are implemented: the Orca CLMM adapter, the market factory,
the collateral manager, short and long mint, the premium engine, premium cash
settlement, and the solvency gate (long premium liability + margin, no price
input — see `docs/adr/ADR-0003-fair-mvp-risk-model.md`). Toolchain pins are in [`docs/06-testing/RELEASE-GATE.md`](docs/06-testing/RELEASE-GATE.md) §1.

```bash
# 1. Unit tests - tick math, PDA seeds, div_euclid. No validator needed.
cargo test -p perma --lib

# 2. Build. --arch v0 is REQUIRED; Anchor 1.x defaults to v3, which the
#    local validator's loader rejects with "invalid file header".
anchor build --arch v0

# 3. Fixtures FIRST - devUSDC cannot be minted locally, so the user ATAs are
#    hand-crafted. They are keyed to your wallet; regenerate per machine.
node scripts/make-fixtures.mjs

# 4. Local validator with Orca, the allowlisted pool, its TickArrays and those
#    fixtures all loaded. Mirrors [test.validator] in Anchor.toml.
./scripts/local-validator.sh            # foreground, or --detach
#    Full flag list and what each account is: RELEASE-GATE.md §3.

# 5. Deploy and run the suites.
solana airdrop 100 -u localhost
solana program deploy target/deploy/perma.so \
  --program-id target/deploy/perma-keypair.json -u localhost

export ANCHOR_PROVIDER_URL="http://127.0.0.1:8899"
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/risk-solvency.ts      # component 09
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/settle-premium.ts     # component 08
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/position-long.ts      # component 06
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/position-short.ts     # components 04+05
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/collateral.ts         # component 03
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/factory.ts            # component 02
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/adapter.ts            # validation
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/adapter-liquidity.ts  # real CPI

# Guards that need an UNINITIALIZED GlobalConfig (singleton PDA). Run this
# FIRST on a freshly --reset ledger, before any other suite creates the config.
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/factory-rewards.ts

# Optional: measured CU / tx size.
node scripts/measure.mjs           # liquidity path
node scripts/measure-position.mjs  # mint / burn / settle (needs a market)

# Optional: reconcile both money invariants over RPC, from outside the program.
node scripts/reconcile.mjs
```

Expected: **60 unit**, **10 risk-solvency**, **10 settle-premium**, **9 position-long**,
**7 position-short**, **11 collateral**, **9 factory**, **12 validation**, **8 liquidity**,
and **2 fresh-ledger** tests passing.

> `tests/factory-rewards.ts` needs its **own** reset ledger: it allowlists a
> different pool, so running it first makes every other suite fail with
> `PoolNotAllowlisted`. Run it on a dedicated validator, not alongside.

> Account layouts changed in components 02, 03, 06, 08 and 09 (`Market` grew
> twice; `UserCollateral`, `GlobalPremiumIndex` and `RangePremiumState` are new;
> `PermaPosition` gained `premium_receivable`; `UserCollateral` gained
> `open_longs`). Always `--reset` after pulling, or old accounts fail to
> deserialize.

> Component 03 changed the fixtures: the **user's** ATAs are funded and the
> market vaults start **empty**, filled by the real `deposit_collateral`
> instruction. Regenerate per machine — they are keyed to your wallet.

The liquidity suite moves real tokens through Orca and runs the `0x1775` /
`0x177c` regression guards. It fails fast if the vault fixtures are missing.

`tests/settle-premium.ts` is the money suite: every assertion checks SPL balances
on both sides of a transfer, and `range_vault.amount == premium_pool + dust` is
re-checked after every settle path. The range vault is a PERMA PDA and is
deliberately **not** `Market.vault_b` — keeping them separate is what makes the
collateral conservation identity independently verifiable.

`tests/risk-solvency.ts` is the gate suite: a long's **accrued** premium blocks a
withdrawal even though nothing has been written to `premium_owed_usdc`, even
when nobody has cranked the index since the long opened, and the open-long set
passed to the gate cannot be shortened or padded. Long mints and withdraws pass
the owner's open longs as remaining accounts (`MAX_OPEN_LONGS = 8`).

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
