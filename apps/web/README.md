# PERMA web UI

Thin Fair MVP client for Trade / Portfolio / Vault. Next.js 14 App Router +
TypeScript + Tailwind + Zustand + `@solana/web3.js` + `@coral-xyz/anchor`.

**This app is standalone.** It has its own `package.json`/lockfile and does
not touch the root Anchor/Mocha tooling — `yarn test:unit` and the Rust+TS
test suites at the repo root are unaffected by anything in this directory.

> Prototype. Not audited. Single pool. Not production mainnet risk capital.

## Setup

```bash
cd apps/web
yarn install
cp .env.example .env.local   # fill in NEXT_PUBLIC_RPC_URL etc.
yarn dev                      # http://localhost:3000
```

### Running against the local validator (recommended for development)

Devnet has no PERMA market created yet — that's an ops step, not something
this app does. Point it at the same local validator the Rust/TS test suites
use instead:

```bash
# from the repo root
node scripts/make-fixtures.mjs
./scripts/local-validator.sh --detach
anchor deploy --provider.cluster localnet
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/factory.ts tests/collateral.ts \
  tests/position-short.ts   # creates the market and some real state to look at
```

Then, in `apps/web/.env.local`:

```
NEXT_PUBLIC_CLUSTER=localnet
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899
NEXT_PUBLIC_PERMA_PROGRAM_ID=4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt
NEXT_PUBLIC_WHIRLPOOL=2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G
```

## Resyncing the IDL

`src/idl/{perma.json,perma.ts}` are committed copies of the Anchor-generated
`target/idl/perma.json` / `target/types/perma.ts` (that directory is
gitignored at the repo root). After any change to `programs/perma/src/`:

```bash
# from the repo root
anchor build --arch v0
cp target/idl/perma.json target/types/perma.ts apps/web/src/idl/
```

## Testing

```bash
yarn test          # vitest — pure-function unit tests (solvency math, PDA
                    # derivation, Whirlpool byte decode, error mapping)
yarn typecheck      # tsc --noEmit
yarn check-copy      # greps src/ against docs/04-ui-ux/COPY-DECK.md §5's
                    # banned-phrase list
```

There is no browser/e2e test suite in this MVP. Manual verification against
the local validator is the release gate instead — three scripts exercise the
app's REAL `src/lib/*` modules (PDA derivation, account decoding, instruction
building, error mapping) against genuine on-chain state, not a mock:

```bash
# after seeding the local validator (see above)
yarn verify-live                # reads: Market, UserCollateral, positions, spot price, solvency
yarn verify-mint-long            # sends a real mint_position(LONG) tx, reads it back
yarn verify-withdraw-and-burn    # proves the InsolventWithdrawal gate, then burns + re-withdraws
```

Running these during this build caught two real bugs unit tests and `tsc`
couldn't: Anchor normalizes IDL account names to camelCase internally (so
the coder needs `"permaPosition"`, not the IDL file's own `"PermaPosition"`),
and a raw `getProgramAccounts` memcmp on `(market, owner)` alone also matches
`UserCollateral` — which has the identical field layout at those byte offsets
— so position fetches now go through `program.account.permaPosition.all()`,
which adds the discriminator check that disambiguates them. See
`docs/audits/IMPL-UI-TRADE-PORTFOLIO-REPORT.md` for the full record.

## What this is, and isn't

Wired to the live 01–09 program: deposit/withdraw, short and long mint
(inventory- and solvency-gated), close, and premium settlement — all real
transactions, no mocked data. No admin/pause UI, no liquidation UI (none
exists on-chain), no fake TVL/APY/volume/chart, no P&L or "Solvency Ratio"
(component 09's design has no price input — see
[ADR-0003](../../docs/adr/ADR-0003-fair-mvp-risk-model.md)). See
`IMPL-UI-FEASIBILITY.md` and `IMPL-UI-TRADE-PORTFOLIO-REPORT.md` under
`docs/audits/` for the full design record.
