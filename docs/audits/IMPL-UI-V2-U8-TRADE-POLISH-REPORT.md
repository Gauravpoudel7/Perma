# IMPL-UI-V2-U8 — Review footer visible; inventory list scale

> **Scope:** the shared slide-over's geometry and the Trade inventory picker. No `programs/**`, IDL, instruction-builder, mint or range-matching change.
> **Date:** 2026-09-23
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## A — Slide-over footer was clipped

**Root cause.** The panel was `inset-y-0` — full viewport height — while `AppShell` keeps a fixed bottom stack (`fixed inset-x-0 bottom-0 z-50`) holding the Prototype banner at every width plus the 56 px tab bar below `md`. Its only concession was `pb-[banner+safe-area] md:pb-0`, wrong twice: on desktop `md:pb-0` put the footer *under* the banner, and on phones the padding ignored the tab bar. Hence "half-clipped" Cancel / Confirm.

**Fix** (`primitives/SlideOver.tsx`): the panel now ends where the chrome starts —
`top-0 bottom-[calc(var(--shell-banner-h)+var(--shell-tabbar-h)+env(safe-area-inset-bottom,0px))]`, relaxed to banner-only from `md`. The header and footer are `shrink-0` and the body is `min-h-0 flex-1 overflow-y-auto` (without `min-h-0` a flex child refuses to shrink, so a tall summary would still push the footer out). One primitive, so `ReviewSheet`, `PositionDetail`, both Vault review sheets and the connect dialog are all fixed together.

## B — Inventory list scale

`lib/inventory.ts` gained `sortRangesForPicker(ranges, currentTick)`: available desc, ties to the range nearest the pool tick, then `tickLower` so the order never reshuffles between polls. The midpoint comparator is now shared with `bestAvailableRange`, so the top row and the "Use available short" button cannot disagree.

`trade/InventoryPicker.tsx`:
- rows live in a `max-h-64 overflow-y-auto` list with the heading and "Use available short" outside it, so the shortcut and the count stay put while rows scroll;
- the first 8 rows render, with "Show all ({K})" / "Show fewer" when more exist — the count is always the true total, rows are never merged or summarised;
- on the **short** side the rows collapse behind "Ranges with short liquidity ({K})" (`aria-expanded`/`aria-controls`, "Show"/"Hide"), since a short provisions new liquidity rather than consuming someone else's; "Use available short" stays visible for matching an existing band. Long keeps the list open.

## Verification

| Check | Result |
|---|---|
| `yarn typecheck` | clean |
| `yarn test` | 10 files, 73 tests passed (+2 `sortRangesForPicker`) |
| `yarn check-copy` | "No banned phrases found." |
| `yarn build` | Compiled successfully |
| `yarn test:e2e` | 89 passed, 13 skipped |

New e2e:
- **"caps the list height and collapses it on the short side"** — asserts the row container's computed `overflow-y: auto`, a bounded `max-height`, and an actual height within it; then that switching to Short sets `aria-expanded="false"` and hides the rows while "Use available short" stays visible, and that re-opening restores them.
- **"Slide-over footer keeps its actions above the honesty banner"** — opens the connect dialog and asserts the panel's bottom edge is at or above the banner's top and inside the viewport. With no wallet extension that dialog has no footer buttons of its own, so the assertion is on the panel bounds — the invariant that makes a footer reachable.

Both ran against the app as currently configured (an operator has since pointed `.env.local` at Solana-devnet), and the U7 picker selection test passed there too — so the picker, its sort and its cap are verified against a real deployment, not only localnet.

**Three pre-existing tests had to be made cluster-honest** rather than left red, because they asserted localnet-only conditions that stopped holding when `.env.local` moved to devnet: the localnet CLI-keypair dialog entry (compiled out elsewhere) and the connect-dialog focus trap (no focusable controls without a wallet extension) now skip with a stated reason, read from the same env files the dev server reads. The U7 picker test also needed `Long` selected first, since the ticket opens on Short where the rows are now collapsed.

**Visual proof** (scratch page against the built stylesheet, not committed): at 1440×900 and 390×844, the list shows ~5 rows with internal scroll and "Show all (20)", and a tall Review sheet's Cancel / Confirm Open Long sit fully above the banner (and above the tab bar on the phone) while the summary scrolls. The 20 synthetic rows exist only in that scratch page; nothing under `src/` renders invented inventory.

## Manual, still owed (needs a wallet)
Trade → Open Short/Long → Review → both buttons clickable above the banner, Tab reaches Confirm. With several ranges open, the list scrolls inside its card and "Use available short" still lands on the largest.
