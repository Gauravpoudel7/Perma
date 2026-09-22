# CLAUDE-IMPLEMENT — Localnet wallet / deposit funding fix

> **Product UI + localnet DX only.** Not marketing. Not protocol.  
> **Read first:** `apps/web/README.md` (local validator setup), `scripts/make-fixtures.mjs`, `tests/fixtures/addresses.json`, `apps/web/src/components/vault/DepositForm.tsx`, `apps/web/src/hooks/useSendPermaTx.ts`, `apps/web/src/lib/errors.ts`, `apps/web/src/components/wallet/ClusterGuard.tsx`, COPY-DECK §4.3–4.4, skills `perma-honesty`, `perma-no-break`.  
> **Plugins:** `frontend-design` ON for any UI copy/surface. **Disable** ponytail and caveman.  
> **Model:** strongest available.

## Problem (reproduced)

On localnet, deposit fails with wallet `WalletSendTransactionError: Unexpected error` when the **connected browser wallet is not the fixture-funded owner**.

- `scripts/make-fixtures.mjs` forges WSOL + Orca **devUSDC** ATAs for `ANCHOR_WALLET` (default `~/.config/solana/id.json`).
- Those ATAs are injected into `solana-test-validator` via `--account`.
- Orca `devUSDC` **cannot be minted** locally (no mint authority).
- Phantom/Solflare with a different pubkey has **no USDC** → simulation fails → opaque error.
- Users also hit a Next.js red overlay when failures were rethrown from `useSendPermaTx` (partially fixed: return `null` instead of throw — keep that).

## Goal

Make localnet deposits **obvious and workable** without asking users to guess:

1. **Detect** funded-wallet mismatch and show honest, actionable UI (not “Unexpected error”).
2. **Provide one first-class localnet path** to transact as the funded wallet (see Options — pick A+B below unless an ADR says otherwise).
3. **Keep** mainnet/devnet behavior unchanged; never ship CLI private keys; never weaken deposit guards.

## Locked decisions

### A — Funded-wallet awareness (must)

- Read the expected funded pubkey from `tests/fixtures/addresses.json` → `wallet` (or generate a small `apps/web`-readable copy at build/dev time if the web app cannot import outside `apps/web` — e.g. `apps/web/src/lib/localnetFundedWallet.ts` committed/synced from fixtures, or `NEXT_PUBLIC_LOCALNET_FUNDED_WALLET` written by a tiny sync script).
- When `CLUSTER === "localnet"` and wallet connected and `publicKey !== fundedWallet`:
  - Show a non-blocking `InlineError` / `DegradedState` on **Vault** (and optionally Trade nudge) with COPY-DECK-approved copy, e.g. that this address is not the fixture-funded localnet wallet, deposits of USDC will fail, and how to fix (use Localnet Dev Wallet / import CLI key / regenerate fixtures).
- Preflight: disable Deposit Confirm (or show disabled reason) when mismatch **and** `amountUsdc > 0`. SOL-only wrap may still work if they have lamports — be precise in copy.
- Improve `parseAnchorError` unwrap of `WalletSendTransactionError.error` / logs (if not already) so insufficient-funds simulations map to the localnet fixture message.

### B — Localnet Dev Wallet adapter (must for “fix”, localnet only)

Add a **localnet-only** wallet adapter entry (name e.g. “Localnet CLI (fixtures)”) that:

- Appears in the wallet modal **only** when `NEXT_PUBLIC_CLUSTER=localnet` (tree-shake / dead-code so production/devnet builds do not register it).
- Signs using the Solana CLI keypair the operator pastes **once per browser session** via a secure in-app form (`request_user_form` pattern or a masked paste field that stays in memory — **never** `localStorage`, never logged, never committed).
- OR (preferred if simpler and still safe): a “Load CLI keypair JSON” file picker that reads `id.json` in-memory only for the session.
- Public key must match `addresses.json` wallet after load; if not, show error (“This keypair is not the fixture-funded wallet — run make-fixtures with this key or pick the funded one”).
- Label clearly: **Local testing only. Never use on mainnet.**

Do **not** auto-read `~/.config/solana/id.json` from the Next server into the browser (exfiltrates secrets). Client-side paste/file picker only.

### C — Fixture regen helper (should)

Add `apps/web` or root script documented in README:

```bash
# Example — exact flags up to you
node scripts/make-fixtures.mjs   # already uses ANCHOR_WALLET
# Document: to fund Phantom, user must set ANCHOR_WALLET to a keypair file for that pubkey, remake fixtures, restart validator with --account list.
```

Optional: `scripts/print-fixture-wallet.mjs` prints funded address + Phantom import reminder (no secret).

### D — Out of scope

- Minting fake USDC / changing mint authority.
- Changing `programs/**`, IDL, or deposit instruction semantics.
- Auto-airdrop of USDC (impossible without mint).
- Storing private keys on disk from the web app.
- PWA / mainnet faucet.

## In scope (files likely)

- `apps/web/src/components/wallet/*` — modal list, new LocalnetDevWallet adapter
- `apps/web/src/components/vault/DepositForm.tsx` (+ Withdraw if useful)
- `apps/web/src/lib/errors.ts`, `useSendPermaTx.ts` (keep no-rethrow)
- `apps/web/src/lib/constants.ts` / new `localnetFundedWallet.ts`
- `docs/04-ui-ux/COPY-DECK.md` — new localnet funding strings
- `apps/web/README.md` — Localnet wallet section
- `docs/audits/IMPL-LOCALNET-WALLET-FUNDING-REPORT.md`
- Unit tests for mismatch helper + error unwrap; e2e: localnet banner/copy visible when stubbing a non-funded pubkey is feasible; do not require real Phantom in CI

## Acceptance

- [ ] On localnet, connecting a non-funded wallet shows clear Vault messaging before submit; USDC deposit CTA explains why it’s blocked or will fail.
- [ ] Localnet Dev Wallet (session paste/file) can deposit successfully against the running validator when fixtures match that key.
- [ ] Failed sends still **toast only** — no Next.js Unhandled Runtime Error overlay.
- [ ] Insufficient-funds / nested wallet errors map to honest localnet copy when detectable.
- [ ] Devnet/mainnet builds do not expose the CLI/dev wallet.
- [ ] `yarn typecheck && yarn test && yarn check-copy && yarn build` green in `apps/web`; e2e green (update screenshots only if intentional).
- [ ] No secrets in git; IMPL report lists manual verify steps.

## Method

1. Confirm current `tests/fixtures/addresses.json` `wallet` field and DepositForm send path.
2. Implement funded-pubkey sync + Vault banner/disable reasons first (unblocks confusion immediately).
3. Implement Localnet Dev Wallet adapter second; test deposit on localnet.
4. Docs + COPY-DECK + IMPL report.
5. Gates often; kill stale next on 3001 if e2e CSS breaks.

## Manual verify (report these)

1. Phantom (random key) + localnet → see mismatch UI; no red overlay on failed deposit.
2. Localnet Dev Wallet with CLI `id.json` → deposit USDC+SOL succeeds; TopBar Free updates; Trade nudge clears.
3. Devnet build / `CLUSTER=devnet` → no Dev Wallet in modal.

## Gate commands (from `apps/web`)

```bash
yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e
```
