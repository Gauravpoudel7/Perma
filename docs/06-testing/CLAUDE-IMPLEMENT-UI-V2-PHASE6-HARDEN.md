# CLAUDE-IMPLEMENT-UI-V2 — Phase U6 Harden (a11y + perf)

> **Product UI only** (Trade / Portfolio / Vault / Markets). Not landing page.  
> **Read first:** `docs/04-ui-ux/PRODUCT-UI-V2-RESEARCH.md` (§7 U6, §6 skills), `UI-UPGRADE-RESEARCH.md` Phase 6, `BRAND-SYSTEM.md`, `UI-QA-CHECKLIST.md`, `APP-SHELL.md`, `MOBILE-U5-RESEARCH.md` (deferrals: viewport-fit, real-device), U0–U5 IMPL reports under `docs/audits/IMPL-UI-V2-U*-*.md`, skills `perma-brand-lock`, `perma-honesty`, `perma-no-break`, `perma-fair-surface`.  
> **Plugins / skills:** `frontend-design` ON. **Disable** ponytail and caveman. Prefer Vercel `web-design-guidelines`, `react-best-practices`, `composition-patterns` if installed; AccessLint skills optional if present — do not block the phase on missing installs.  
> **Model:** Opus for audit judgment; Sonnet OK for mechanical fixes after the plan is written.

## Goal

Close UI V2 with an **accessibility + performance harden pass** on the product app that U0–U5 built. Fix real focus/contrast/keyboard/touch gaps and obvious React/Next hotspots. **Do not** redesign layouts, add features, or touch protocol code.

This is the last UI-V2 implementation phase. Prefer a short punch-list of verified fixes over a vague “polish everything” rewrite.

## Current baseline (do not regress)

- U0 shell + States + CollateralNudge  
- U1 Trade desk + ReviewSheet + InventoryStrip  
- U2 Lightweight Charts (dynamic, client-only) + ResizeObserver fitContent (U5)  
- U3 Portfolio cards + PositionDetail + shared SlideOver  
- U4 Vault hierarchy + deposit/withdraw review + shared required-free hook  
- U5 MobileTabBar stacked above banner; sidenav `md+`; Trade “Market data” disclosure; toast/sheet clearance  

Gates already green at U5: typecheck, 55 unit tests, check-copy, build, 77 e2e.

## In scope

1. **Audit plan (write first, then fix)**  
   Spend the opening of the session producing a dated punch-list in the IMPL report draft: findings from reading Trade/Portfolio/Vault/shell + running available guideline skills. Rank P0 (blocks keyboard/screen-reader/core path) → P2 (nice). Only implement P0/P1 in this phase unless P2 is trivial.

2. **Accessibility (must)**  
   - Keyboard: Tab order through TopBar, sidenav (desktop), MobileTabBar (mobile), Trade ticket, Review/Position/Vault sheets; Esc closes sheets; focus return already claimed — **verify and fix gaps**. Expand `e2e/keyboard.spec.ts` if a hole is real (e.g. tab bar focus rings, disclosure button, sheet footer).  
   - Focus rings: never removed; visible on tabs, disclosure, Max chips, Details.  
   - Labels / names: icon-free text controls have accessible names; `aria-current` on both nav modes; live regions (`aria-live`) for disabled reasons / toast if missing.  
   - Contrast: stay on brand tokens; no muted-on-muted body copy that fails WCAG AA for UI text.  
   - Reduced motion: honor existing `prefers-reduced-motion` on `.transition-brand`; no new loops.  
   - Banner: still verbatim, always in view; do not change U5 stacking unless a11y requires a labeled landmark tweak.

3. **Performance (must, measured lightly)**  
   - Confirm charts stay behind `next/dynamic({ ssr: false })`; no accidental server import of `lightweight-charts`.  
   - Avoid rerender waterfalls on Trade: spot/premium/collateral selectors stay narrow (zustand); fix any new whole-tree subscriptions introduced since U0.  
   - Disclosure/hidden chart: keep U5 ResizeObserver behavior; do not remount charts on every toggle if avoidable.  
   - Images/fonts: no new font downloads; Inter/JetBrains already loaded — do not add display fonts.  
   - Optional: note `/trade` first-load JS from `yarn build` before/after in the IMPL report (no aggressive code-splitting crusade).

4. **Consistency / hygiene**  
   - Anti-slop grep on `apps/web/src` (gradient, backdrop-blur, shadow-*, raw hex outside tokens).  
   - `yarn check-copy` clean; no new banned phrases.  
   - Remove dead code only if clearly unused from U0–U5 refactors (no drive-by renames).  
   - Document remaining manual debt in IMPL: wallet-connected localnet path; real notched-device safe-area (U5 deferred `viewport-fit=cover` — implement **only if** audit shows a concrete bug in Playwright or you can justify with a minimal layout change that does not fight U5 chrome).

5. **Docs**  
   - Short note in `UI-QA-CHECKLIST.md` or APP-SHELL if a11y contracts changed.  
   - Report: `docs/audits/IMPL-UI-V2-U6-HARDEN-REPORT.md` (punch-list + what fixed + what deferred + gate table).  
   - Optional one-pager `docs/04-ui-ux/UI-V2-COMPLETE.md` summarizing U0–U6 Definition of Done for product UI (no protocol claim).

## Out of scope / Forbidden

- `programs/**`, IDL, instruction builders, solvency math changes.  
- New product features (multi-leg, P&L columns, PWA, Markets redesign, new chart series).  
- Visual redesign / brand experiments / new radius language.  
- Softening gates (pause, insolvency, inventory empty).  
- Large dependency adds (no new a11y runtime libraries unless a one-line eslint plugin is clearly justified — prefer Playwright assertions).  
- “Fix everything AccessLint ever mentioned” without a ranked punch-list.

## Acceptance

- [ ] Written P0/P1 punch-list in IMPL report; each P0/P1 either fixed or explicitly deferred with reason.  
- [ ] Keyboard e2e still green; at least one meaningful new assertion if a real gap was found (or note “no gap; baseline sufficient”).  
- [ ] Focus visible on primary mobile + desktop chrome.  
- [ ] Charts still client-only; no SSR crash; U5 disclosure/fitContent intact.  
- [ ] `yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e` green.  
- [ ] Slop grep clean; honesty banner + label bans intact.  
- [ ] `docs/audits/IMPL-UI-V2-U6-HARDEN-REPORT.md` (+ optional UI-V2-COMPLETE).  

## Method

1. Read U5 report + shell/Trade/Portfolio/Vault entry points; run web-design-guidelines / react-best-practices on touched trees if skills exist.  
2. Write punch-list → implement P0/P1 only → re-run gates often.  
3. Prefer surgical diffs; evolve, don’t rewrite.  
4. Kill stale next on 3001 if e2e CSS breaks.  
5. End with anti-slop grep + gate table in IMPL.

## Notes carried from U0–U5

- Wallet-connected manual path still unpaid — list steps in IMPL; do not block U6 on it.  
- Real-device safe-area still unpaid — optional `viewport-fit=cover` only with evidence.  
- Indexer `:8799`; honesty empty/degraded still beats fake data.

## Gate commands (from `apps/web`)

```bash
yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e
```
