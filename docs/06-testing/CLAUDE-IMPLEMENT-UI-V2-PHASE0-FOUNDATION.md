# CLAUDE-IMPLEMENT-UI-V2 — Phase U0 Foundation

> **Product UI only** (Trade / Portfolio / Vault). Not landing page.  
> **Read first:** `docs/04-ui-ux/PRODUCT-UI-V2-RESEARCH.md`, `BRAND-SYSTEM.md`, `UI-QA-CHECKLIST.md`, `APP-SHELL.md`, and skills `perma-brand-lock`, `perma-honesty`, `perma-no-break`, `perma-fair-surface`.  
> **Plugins:** `frontend-design` ON. **Disable** ponytail and caveman for this session.  
> **Model:** strongest available for visual work.

## Goal

Bring the existing Fair web app to a denser, business-grade **shell and foundation** without changing transaction semantics. No new chart library yet (that is U2). No fabricated metrics.

## In scope

1. Audit `apps/web` against BRAND-SYSTEM / tokens — fix drift only.
2. AppShell / Sidenav / TopBar density:
   - TopBar shows: market label, spot (existing hook), pause badge, free collateral summary when connected.
   - Sidenav: clear active route; mobile icon-rail preserved.
3. Shared UI states: Skeleton, EmptyState, DegradedState (indexer/RPC), inline Error with recovery CTA — use across pages.
4. Typography: ensure all live numbers use tabular mono tokens.
5. Focus rings and 100ms linear hovers per brand.
6. After wallet connect with zero collateral: non-blocking nudge toward Vault (no modal spam).

## Out of scope / Forbidden

- `programs/**`, IDL changes, new instructions.
- Landing / marketing pages.
- Chart library install (U2).
- Multi-leg, liquidation gauges, fake P&L, fake depth.
- Weakening deposit/withdraw/mint guards.
- Glass, gradients, shadows, radius > 8px.

## Acceptance

- [ ] Visual: denser institutional shell; no AI-slop per UI-QA rejection list.
- [ ] `yarn typecheck && yarn test && yarn check-copy && yarn build` green in `apps/web`.
- [ ] Playwright e2e desktop + mobile green (update screenshots only if intentional).
- [ ] Manual: Trade/Portfolio/Vault usable; mint/deposit paths still work on localnet.
- [ ] Short IMPL note: `docs/audits/IMPL-UI-V2-U0-FOUNDATION-REPORT.md`.

## Method

1. Read existing components before rewriting — prefer evolve over greenfield.
2. Commit to a short design plan (tokens already exist — refine layout, don’t reinvent palette).
3. Implement incrementally; run gates often.
4. End with web-design-guidelines audit on touched files.

