# Trade / Portfolio / Vault Web UI — Phase 0 Feasibility

**Status: GO**

## Q1 — App location
`apps/web`, a fully standalone Next.js package with its own `package.json`/lockfile. The root `package.json` (Anchor/Mocha tooling) is untouched — no workspaces field added, zero risk to `yarn test:unit`/the Rust+TS suites. Note: `docs/05-engineering/REPO-STRUCTURE.md` and `LOCAL-DEV.md` currently say the frontend lives at `app/`; both get a surgical correction in the final report (Phase 5) so the stale path doesn't get "fixed" back by a future reader.

## Q2 — Cluster & config
Env vars: `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_CLUSTER` (`localnet`|`devnet`), `NEXT_PUBLIC_PERMA_PROGRAM_ID` (`4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt` — same on both clusters per `Anchor.toml`), `NEXT_PUBLIC_WHIRLPOOL` (`2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G`, the allowlisted pool). Everything else (`Market` PDA, vaults, mints, tick spacing) is derived client-side or read from the live `Market` account — never hardcoded. No secrets are ever needed (read-only RPC + wallet-signed txs). Devnet has no market created yet (ops step, out of this task's scope); development runs against `scripts/local-validator.sh`.

## Q3 — IDL path
`target/idl/perma.json` and `target/types/perma.ts` exist and are current (14 instructions, matching `lib.rs` 1:1) but `target/` is gitignored. Both are copied into `apps/web/src/idl/` and committed. Resync command documented in `apps/web/README.md`: `anchor build && cp target/idl/perma.json target/types/perma.ts apps/web/src/idl/`.

## Q4 — Instruction account maps
Confirmed this session directly against `programs/perma/src/lib.rs` and `target/idl/perma.json`: `deposit_collateral`/`withdraw_collateral` (withdraw needs `premiumIndex` + `remainingAccounts` = open longs), `mint_position` SHORT (full Orca account set) vs LONG (all 15 Orca fields `null`, no extra signer, `remainingAccounts` = open longs), `burn_position` (same `Option` branching; LONG still needs `vaultB`+`tokenProgram`), `settle_premium` (11 fixed accounts, SHORT leg requires `cranker === owner`). Tick-array creation for a fresh range: verified against the vendored `orca_whirlpools_client` 8.0.0 crate — discriminator, accounts, and args for `initialize_tick_array` are known exactly (see plan). COPY-DECK's rent notice is implemented for real, not stubbed.

## Q5 — Data reads
Positions listed via `getProgramAccounts` memcmp (`offset:8`=market, `offset:40`=owner), filtered client-side by `legType`/`status`. `MAX_OPEN_LONGS = 8` is enforced both in the on-chain gate and in the UI (CTA disables at 8 open longs).

## Q6 — Design tokens
`BRAND-SYSTEM.md` tokens mapped to CSS custom properties in `src/styles/tokens.css`, consumed by `tailwind.config.ts`. No glassmorphism, no gradients, no shadows above a 1px border, no default wallet-adapter-react-ui styling.

## Q7 — Responsive plan
Desktop sidenav shell; sidenav collapses under 1024px; portfolio table becomes stacked cards under 640px; banner wraps to two lines on narrow viewports; no horizontal scroll anywhere.

**GO. Proceeding to Phase 1 (scaffold).**
