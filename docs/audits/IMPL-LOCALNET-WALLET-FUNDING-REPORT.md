# IMPL — Localnet wallet / deposit funding fix

> **Scope:** `apps/web` UI + localnet developer experience. No `programs/**`, IDL, instruction builder, or deposit/withdraw gate change. `scripts/make-fixtures.mjs` untouched.
> **Date:** 2026-09-22
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## The problem

Orca devUSDC has no mint authority on a local validator, so it cannot be minted or airdropped. `scripts/make-fixtures.mjs` hand-crafts WSOL and devUSDC token accounts for exactly one address (`ANCHOR_WALLET`, recorded as `wallet` in `tests/fixtures/addresses.json`) and injects them with `--account`. Connect any other browser wallet and a USDC deposit fails in simulation; the wallet adapter reports a bare `WalletSendTransactionError: Unexpected error`, and nothing in the UI explains why.

Two parts of the fix were already in the tree: `useSendPermaTx` returns `null` instead of rethrowing (so a failed send toasts instead of raising a Next.js overlay), and `parseAnchorError` walks nested `.error` / `.cause` chains. This change adds the two missing halves — saying so before the user signs, and a supported way to act as the funded wallet.

## What changed

### A — Funded-wallet awareness
- `apps/web/scripts/sync-fixture-wallet.mjs` (`yarn sync-fixture-wallet`): reads `tests/fixtures/addresses.json`, prints the funded address, and writes or updates `NEXT_PUBLIC_LOCALNET_FUNDED_WALLET` in `apps/web/.env.local`. Public address only; it never reads or writes a secret.
- `src/lib/localnetFunding.ts`: `LOCALNET_FUNDED_WALLET` plus a pure `localnetFundingStatus()` returning `n/a` / `unconfigured` / `funded` / `mismatch`. Devnet always returns `n/a`. `hooks/useLocalnetFunding.ts` wraps it with the connected key.
- **Vault** shows an `InlineError` on `mismatch` (names the funded address and both ways out) and a one-line `DegradedState` on `unconfigured` (run the sync script). Non-blocking.
- **DepositForm** disables the CTA with a visible reason when a USDC amount is entered on a mismatched wallet; a SOL-only deposit stays enabled, because the wrap comes from ordinary lamports. Existing guards are untouched.
- **Trade `CollateralNudge`** adds one muted line on `mismatch` pointing at Vault.

### B — Localnet CLI keypair wallet
- `src/components/wallet/LocalnetKeypairWallet.ts`: `LocalnetKeypairWalletAdapter extends BaseSignerWalletAdapter` (so `sendTransaction` comes from `signTransaction`). `loadSecretKey()` builds a `Keypair` held in a `#private` field for the life of the tab — never `localStorage`, never serialised, never logged, never sent anywhere. `connect()` throws a readable `WalletNotReadyError` when no key is loaded, so a stale `autoConnect` after a reload fails cleanly; `disconnect()` drops the key.
- `WalletListModal` renders that entry as a card with a file picker ("Load CLI keypair JSON") and the warning "Local testing only. Never use a mainnet key here." The file is read with `File.text()` in the browser. A keypair that is not the fixture-funded address is rejected with copy naming both addresses.
- The dialog identifies the adapter by duck-typing a type-only `LocalnetKeypairSigner` interface, so the modal never imports the adapter as a value.
- `providers.tsx` loads the adapter through a dynamic `import()` inside a branch guarded by a literal `process.env.NEXT_PUBLIC_CLUSTER` read, and `next.config.mjs` aliases the module to `false` when that value is `devnet`.

### C — Error mapping
`lib/errors.ts` now matches every shape this failure takes on localnet — `insufficient funds/lamports`, `insufficient funds for rent`, the runtime's "Attempt to debit an account…", SPL's own `custom program error: 0x1`, and `could not find account` — against messages and logs together, and maps them to the existing localnet sentence.

## Verification

| Check | Result |
|---|---|
| `yarn typecheck` | clean |
| `yarn test` | 8 files, 63 tests passed (+4 funding status, +4 error shapes) |
| `yarn check-copy` | "No banned phrases found." |
| `yarn build` (localnet) | Compiled successfully; `/vault` 262 kB, `/trade` 262 kB |
| `yarn test:e2e` | 85 passed, 8 skipped (pre-existing WebKit skips) |
| Devnet exclusion | `NEXT_PUBLIC_CLUSTER=devnet yarn build` → `grep -rl "Localnet CLI keypair (fixtures)" .next/static` returns **nothing**. Before the `next.config.mjs` alias the dead branch still emitted the chunk; with it the module is not built at all. |
| Secret hygiene | `.env.local` is gitignored and holds only a public address; no keypair file is read by any server code; `grep -rn localStorage src` has no hit in the wallet code. |

New e2e (`shell.spec.ts`, "Localnet wallet"): the connect dialog lists the localnet entry, its "Never use a mainnet key here" warning, and the labelled file input. The mismatch banners need a connected wallet, so they are unit-tested (`test/localnetFunding.test.ts`) and listed below.

A build run that overlapped the Playwright dev server printed `PageNotFoundError: Cannot find module for page: /` — that is the dev server rewriting `.next` underneath the build, not a failure; a clean `rm -rf .next && yarn build` is green. Kill the dev server on port 3001 before building.

## Manual verification (needs the validator and a browser — not yet run)
1. **Phantom with a random key, localnet**: Vault shows the mismatch alert naming `7eDWS2L8…`; entering a USDC amount disables Deposit with the reason; forcing a failure toasts rather than raising a red overlay.
2. **Localnet CLI keypair**: load `~/.config/solana/id.json` in the connect dialog → deposit SOL + USDC succeeds, TopBar "Free" updates, the Trade nudge clears.
3. **Devnet**: run the dev server with `NEXT_PUBLIC_CLUSTER=devnet` → the localnet entry is absent from the connect dialog.
4. Wrong keypair: loading a non-funded `id.json` is rejected in the dialog without connecting.

These join the standing manual debt from the UI V2 phases (wallet-connected walkthrough, notched-device safe area, screen-reader pass).
