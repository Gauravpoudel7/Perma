# IMPL-UI-TRADE-PORTFOLIO-REPORT

**Status:** Shipped. **Date:** 2026-09-20. **Scope:** Fair MVP web UI (Trade / Portfolio / Vault) at `apps/web/`, wired live to the shipped 01–09 on-chain program. No changes to `programs/perma/src/*` or `tests/*`.

## 1. What was built

A standalone Next.js 14 (App Router) + TypeScript + Tailwind package at `apps/web/`, with three routes plus a shared shell:

- **Shell** (`src/components/shell/`): `AppShell`, `Sidenav`, `TopBar`, and a mandatory, non-dismissible `PrototypeBanner` rendered on every route with the verbatim copy *"Prototype. Not audited. Single pool. Not production mainnet risk capital."*
- **Trade** (`/trade`): open a SHORT or LONG position against the single live range market — spot price (labeled "Spot", never "Price" or a TWAP), tick-snapped range input, live inventory check for LONG (`available = totalShort − totalLong`), live premium/margin preview, tick-array-missing rent notice with a real computed SOL amount, and a submit button that is *disabled* (not just left to fail on-chain) on wallet-disconnected, wrong-cluster, paused-market, empty-inventory, or solvency-fail.
- **Portfolio** (`/portfolio`): live table of the connected wallet's open `PermaPosition` accounts — **Side · Range · Size · Accrued Premium (Est.) · Status · Close/Settle** — no P&L column, no history view. "Close" for a short or a long with nothing owed; "Settle" (routes to `settle_premium`) for a long with `payableIfSettledNow > 0`.
- **Vault** (`/vault`): Deposited / Locked / Available / **Required free USDC** (a real computed number, never a percentage), deposit and withdraw forms, withdraw disabled live via the same solvency helper used on-chain.
- **Wallet**: Wallet Standard auto-detection (no explicit adapter list), fully custom-styled `ConnectButton`/`WalletListModal` (zero official wallet-adapter CSS), `ClusterGuard` comparing the configured RPC's genesis hash against the expected cluster.
- **Chain layer** (`src/lib/`): `pda.ts` (seed-exact PDA derivation), `perma.ts` (Anchor client + every instruction builder via `.accountsPartial()`), `accounts.ts`, `whirlpool.ts` (raw `sqrt_price`/`tick_current_index` decode, verified byte offsets), `tickArray.ts` (existence check + hand-built `initialize_tick_array` CPI), `solvency.ts` (the single ADR-0003 implementation, imported by both the Trade preflight and the Vault tile — never reimplemented per-screen), `errors.ts` (34-entry `PermaError` → user-copy map keyed by name via `AnchorError.parse`), `liquidityMath.ts` (real, non-mocked slippage caps).
- **State**: Zustand (`useChainStore` for polled chain reads, `useTradeFormStore` for form state), `useSendPermaTx` as the single Submitting → Confirmed/Failed toast choke point with an immediate refetch after every confirmed transaction.
- **IDL**: `src/idl/perma.json`/`perma.ts` committed as copies of the gitignored `target/idl`/`target/types`; resync command documented in `apps/web/README.md`.

## 2. Honesty overrides implemented (the reason this task existed)

| Stale UI-doc claim | What ships instead | Where |
|---|---|---|
| "Unrealized P&L" column | Side / Range / Size / Accrued Premium (Est.) / Status / Close-Settle | `PositionRow.tsx`, `COPY-DECK.md` §4.2, `APP-SHELL.md`, `WIREFRAMES.md` |
| "Solvency Ratio (%)" | "Required free USDC" — a real µUSDC number from `requiredFreeUsdc()` | `RequiredFreeUsdcTile.tsx`, `SolvencyBlock.tsx`, `COMPONENT-LIBRARY.md`, `COPY-DECK.md` §4.2 |
| Bare "Price" / any TWAP framing | Always labeled "Spot", decoded live from the Whirlpool account | `MarketHeader.tsx` |
| Wireframe "Market Depth" mini-map | Descoped with rationale (no indexer exists; would be invented cross-range data) | `WIREFRAMES.md` |
| "142%"-style solvency percentage example | "Required free USDC: 51.00 USDC" example | `COMPONENT-LIBRARY.md` |
| Liquidation-adjacent UI | None built — no liquidation exists in the on-chain design (ADR-0003) | n/a |
| Docs claiming frontend is unbuilt at `app/` | Corrected to `apps/web/` (shipped) | `REPO-STRUCTURE.md`, `LOCAL-DEV.md` |

## 3. Verification performed

Browser automation tools (Claude in Chrome) were not available this session (installation was started but declined mid-session) — see the skill note in-session. In their place, verification used three permanent `tsx` scripts (`apps/web/scripts/verify-live.ts`, `verify-mint-long.ts`, `verify-withdraw-and-burn.ts`, wired as `yarn verify-*`) that import the *actual shipped* `src/lib/*` modules and drive them against a freshly-seeded local validator end-to-end — not a mock, not a separate test harness reimplementing the logic:

1. `verify-live.ts` — market/collateral/position reads, PDA derivation, spot-price decode, solvency formula, all against real on-chain state.
2. `verify-mint-long.ts` — a real `mint_position` LONG transaction built and sent through `src/lib/perma.ts`'s builder with the Orca accounts as `null` and no extra signer.
3. `verify-withdraw-and-burn.ts` — a real `withdraw_collateral` (with `remainingAccounts`) and `burn_position`/`settle_premium` flow.

This caught two real bugs that `yarn typecheck`/`yarn build`/unit tests could not have found (both fixed, both now permanently regression-covered by the same scripts):

- **Account-name casing**: Anchor normalizes IDL account names to camelCase internally; `program.account.permaPosition.all(...)` was required, not the IDL's own `"PermaPosition"` type-name string.
- **Discriminator collision**: `UserCollateral` and `PermaPosition` share identical byte offsets for `(market, owner)` (both at offsets 8/40), so a raw `getProgramAccounts` memcmp filter on those two fields alone silently returned wrong-typed accounts. `program.account.permaPosition.all(filters)` was needed because it auto-prepends the 8-byte discriminator memcmp.

Additional verification, all green as of this report:

- `yarn typecheck` — clean.
- `yarn test` (vitest) — 28/28 passing across `solvency.test.ts` (11, incl. the "50e6 long needs 51 USDC" worked example from `09-risk-solvency.md`), `pda.test.ts` (7), `whirlpool.test.ts` (5), `errors.test.ts` (5).
- `yarn build` (`next build`) — clean production build, three routes prerendered as static shells (`/trade` 243 kB, `/portfolio` 238 kB, `/vault` 247 kB First Load JS).
- `yarn check-copy` (banned-phrase scanner) — no banned phrases found across `src/`.
- `docs/04-ui-ux/UI-QA-CHECKLIST.md` — signed off by mechanical/grep verification (no gradients, no glassmorphism, no box-shadow, zero icon-library dependency, zero shadcn dependency, spec-correct all-sans typography per `BRAND-SYSTEM.md`'s own "serif is marketing-only" rule, WCAG AAA contrast, keyboard focus rings on every interactive primitive). Desktop/mobile *visual* QA and screen-reader testing were **not** performed — no browser tool was available this session; this is a real residual gap, not a claimed pass. See §5.

## 4. Known gaps / explicitly out of scope

- No devnet market exists yet — this UI has been run and verified against a local validator only, per the plan's locked decision that this is an ops step, not a UI blocker.
- No visual/screenshot QA (desktop 1440px, mobile viewport, screen reader) — blocked on browser tooling not being available this session. Recommend a follow-up pass with Claude in Chrome or manual QA before any external demo.
- `lock_collateral`/`unlock_collateral` have typed builders in `src/lib/perma.ts` for IDL parity but are not wired to any button (matches the plan: `mint_position`/`burn_position` already lock/unlock atomically).
- No closed-position history (component 11, no indexer). No admin/pause UI (component 10). No liquidation UI (none exists on-chain).

## 5. Method note on the missing browser step

The user began installing the Claude in Chrome extension mid-session but chose to continue without it. All UI verification in this report is therefore either (a) mechanical (grep/config inspection against the UI-QA rejection/acceptance criteria) or (b) functional-but-headless (the three `tsx` verification scripts driving real transactions through the real client code against a real validator). Neither substitutes for an actual rendered-pixel check. If/when Chrome tooling is connected in a future session, the remaining visual/a11y sign-off items in `UI-QA-CHECKLIST.md` should be re-run properly.

## 6. Files touched outside `apps/web/`

Doc-only, no program/test changes: `docs/04-ui-ux/APP-SHELL.md`, `WIREFRAMES.md`, `COMPONENT-LIBRARY.md`, `COPY-DECK.md` (§4.2), `UI-QA-CHECKLIST.md`, `docs/05-engineering/REPO-STRUCTURE.md`, `LOCAL-DEV.md`, plus this report.
