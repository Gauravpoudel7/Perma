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


## Localnet wallet

Orca's devUSDC has no local mint authority, so it **cannot be airdropped or minted** on a
`solana-test-validator`. `scripts/make-fixtures.mjs` works around that by hand-crafting WSOL and
devUSDC token accounts for one address — whatever `ANCHOR_WALLET` points at, default
`~/.config/solana/id.json` — and injecting them with `--account`. Every other wallet has zero USDC on
localnet, and a USDC deposit from one fails in simulation.

Tell the app which address that is:

```bash
cd apps/web
yarn sync-fixture-wallet     # writes NEXT_PUBLIC_LOCALNET_FUNDED_WALLET to .env.local
```

With that set, Vault warns before you sign if the connected wallet is not the funded one, and the
Deposit button blocks a USDC amount (SOL-only deposits still work — those come from ordinary
lamports).

Then pick one of two ways to transact:

1. **Connect the funded keypair in the browser.** On a localnet build the connect dialog offers
   "Localnet CLI keypair (fixtures)". Load your `~/.config/solana/id.json` with the file picker; the
   file is read in the browser, held in memory for that tab only, and never written to disk,
   `localStorage`, or any network request. It is rejected if it is not the fixture-funded address.
   **Local testing only — never load a mainnet key.** This adapter is compiled out of a devnet build.
2. **Fund your own wallet instead.** Export that wallet's keypair to a file, then:

   ```bash
   ANCHOR_WALLET=/path/to/your-keypair.json node scripts/make-fixtures.mjs
   # restart the validator so the new --account fixtures load
   cd apps/web && yarn sync-fixture-wallet
   ```


## Solana-devnet

Public Solana-devnet is the other way to run the app, with an ordinary browser wallet instead of a
local validator and the CLI keypair. It needs PERMA deployed there first — see
`docs/07-ops-presentation/RUNBOOK-DEVNET.md` for the current deployment status and the deploy +
`yarn init-market` commands.

Once it is deployed, put this in `apps/web/.env.local` (the block is also in `.env.example`):

```
NEXT_PUBLIC_CLUSTER=devnet
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PERMA_PROGRAM_ID=4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt
NEXT_PUBLIC_WHIRLPOOL=2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G
```

Leave `NEXT_PUBLIC_INDEXER_URL` and `NEXT_PUBLIC_LOCALNET_FUNDED_WALLET` unset. Without an indexer
the chart pane shows its empty state, which is the honest result; the localnet funded-wallet check
does not apply off localnet.

The program on Solana-devnet is still pre-P3 until an operator with the admin key upgrades it
(`docs/audits/IMPL-P3-DEVNET-UPGRADE.md`). With `NEXT_PUBLIC_CLUSTER=devnet` the client omits
`price_update` so the mint is not rejected as `UnexpectedRemainingAccounts` (6024). Localnet stays
on P3 and still passes the mock feed. Restart Next after changing the cluster.

After that upgrade lands, set `NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE=1`. Leave
`NEXT_PUBLIC_PRICE_UPDATE` unset to use the sponsored SOL/USD account
`7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`, or set it to that address. Put `PYTH_API_KEY` in
`.env.local` (never commit it). A mint then uses the sponsored account when it is younger than 60
seconds, and otherwise posts a fully verified Pyth update in an earlier transaction. Close and
Settle do not read the oracle. Do not point Solana-devnet at the localnet mock feed.

To check a short on Solana-devnet: liquidity `1000000`, ticks near spot (about 18–22) aligned to
spacing 8.

Then, in the browser:

1. Switch Phantom (or any Wallet Standard wallet) to **Devnet**. The Localnet CLI keypair entry is
   compiled out of a devnet build, so the connect dialog lists only real wallets.
2. Get SOL for fees: `solana airdrop 2 <your-pubkey> -u https://api.devnet.solana.com`, or Phantom's
   own devnet faucet. Public airdrops are rate-limited; retry later if refused.
3. Get **devUSDC**, mint `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k`, by swapping a little SOL on
   Orca's devnet app. This is Orca's own test token — **not** Circle USDC, which this pool does not
   use. There is no faucet for it and it cannot be minted.
4. Connect, then deposit SOL and devUSDC in Vault. Everything else behaves as on localnet.

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
yarn test:e2e       # Playwright — see below
```

### Browser/e2e tests (Playwright)

```bash
yarn test:e2e                     # headless Chromium desktop + mobile + WebKit desktop
yarn test:e2e:update-screenshots  # re-capture docs/04-ui-ux/screenshots/*.png
```

`playwright.config.ts` starts `next dev` itself (port 3001 by default — 3000
is often already in use on a dev machine; override with `PORT=<n>`) and
reuses an already-running server if one answers on that port. Specs live in
`apps/web/e2e/` only (never in `apps/web/test/`, which is vitest-only) and
cover: the mandatory prototype banner's exact text, no horizontal overflow at
either viewport, primary nav between routes, disconnected-wallet copy on all
three routes (wallet stays disconnected — no seed wallet or validator
required for this pass), and real `Tab`-key keyboard navigation to the
Connect button with a visible focus ring. Screenshots land in
`docs/04-ui-ux/screenshots/`. See `docs/audits/IMPL-UI-PLAYWRIGHT-REPORT.md`
for the full method, environment gotchas (this sandbox needed a manual
Chromium download — see the report if `playwright install` ever times out
here again), and the real mobile-overflow bug this pass found and fixed in
`Sidenav.tsx`.

### Events (component 11)

After a transaction confirms, `src/hooks/useSendPermaTx.ts` decodes that
transaction's Anchor events via `src/lib/events.ts` and refetches only the
slices they touched (market, premium index, the named range) on top of the
unconditional collateral + positions refetch; the success toast names the
events. Polling is untouched and remains the source of truth — if decoding
yields nothing, nothing changes. Catalog: `docs/03-api-interfaces/EVENT-CATALOG.md`.
Unit tests: `test/events.test.ts`; on-chain: `tests/events.ts` at the repo root.

Manual verification against the local validator remains the release gate for
actual on-chain transactions — three scripts exercise the app's REAL
`src/lib/*` modules (PDA derivation, account decoding, instruction building,
error mapping) against genuine on-chain state, not a mock:

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

### Admin: pause / unpause / risk params (component 10)

```bash
set -a; source .env.local; set +a        # tsx scripts read env from the shell
yarn pause-market                        # Market.is_paused = true (idempotent)
yarn unpause-market
yarn set-risk-params <horizon_slots> <buffer_usdc>   # rejects overflowing values
```

Signs with `~/.config/solana/id.json` (the `GlobalConfig` admin). While paused
the UI shows a **Paused** badge and disables the Trade CTA and Deposit form;
Withdraw / Close / Settle keep working — pausing never traps an open position.

## What this is, and isn't

Wired to the live 01–09 program: deposit/withdraw, short and long mint
(inventory- and solvency-gated), close, and premium settlement — all real
transactions, no mocked data. No admin/pause UI, no liquidation UI (none
exists on-chain), no fake TVL/APY/volume/chart, no P&L or "Solvency Ratio"
(component 09's design has no price input — see
[ADR-0003](../../docs/adr/ADR-0003-fair-mvp-risk-model.md)). See
`IMPL-UI-FEASIBILITY.md` and `IMPL-UI-TRADE-PORTFOLIO-REPORT.md` under
`docs/audits/` for the full design record.
