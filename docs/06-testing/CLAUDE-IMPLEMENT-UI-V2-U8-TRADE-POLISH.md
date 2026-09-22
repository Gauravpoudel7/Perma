# CLAUDE-IMPLEMENT — U8 Trade polish: Review footer visible + inventory list scale

> **Read first:** `apps/web/src/components/primitives/SlideOver.tsx`, `trade/ReviewSheet.tsx`, `trade/InventoryPicker.tsx`, `trade/TradePanel.tsx`, U5 mobile shell / PrototypeBanner / `--shell-banner-h`, `perma-no-break`, `perma-honesty`, COPY-DECK.  
> **Plugins:** frontend-design ON. Ponytail/caveman OFF.  
> **Measured defects (Solana-devnet screenshots 2026-09-23):**  
> 1. Review position **Cancel** / **Confirm Open Short|Long** are **half-clipped** at the bottom of the viewport (footer under PrototypeBanner / safe-area / panel height).  
> 2. **Open against existing shorts** lists every distinct tick range with shorts; as users open shorts in many bands the list grows without bound and crowds Trade. "Use available short" is fine; the unbounded list is the problem.

## Goals

A. Review slide-over actions always fully visible and clickable (desktop + mobile).  
B. Inventory picker stays usable when many ranges exist — scroll, order, and (when Short) don’t force the long-oriented list into the way.

## In scope

### A — SlideOver footer never clipped

1. Fix `SlideOver` so the **footer is sticky/pinned** at the bottom of the panel and always fully on-screen. Body scrolls; Cancel/Confirm never sit under the honesty banner or off the viewport.
2. Respect `--shell-banner-h` + `env(safe-area-inset-bottom)` on **all** breakpoints (today `md:pb-0` may be wrong when the banner still shows).
3. Manual + preferably e2e/visual: open Review with a tall summary → both buttons fully visible without page scroll; Tab reaches Confirm.
4. Same fix benefits Portfolio `PositionDetail` (shared SlideOver).

### B — Inventory list scale

5. Cap visible list height (e.g. `max-h` ~12–16rem) with **internal scroll**; keep header + "Use available short" fixed above the list.
6. Sort rows: largest `available` first; ties nearest to spot tick (same rule as `bestAvailableRange`).
7. When trade side is **Short**, either collapse the picker behind a disclosure ("Ranges with short liquidity") default **closed**, or move it so it doesn’t compete with Open Short — Long keeps it open by default. Do not remove the picker for Short if it is useful for matching an existing band; just don’t leave a huge always-open wall.
8. Optional but preferred: show top N (e.g. 8) then “Show all (K)” expanding inside the scroll area — honesty: never invent rows.
9. Copy stays inventory-not-order-book. Tests for sort + scroll container + Short collapse behavior.
10. Audit: `docs/audits/IMPL-UI-V2-U8-TRADE-POLISH-REPORT.md`

## Out of scope / Forbidden

- Changing mint / range matching on-chain  
- Merging different tick ranges into one fake row  
- Hiding available liquidity  
- Breaking U7 click-bar / Use available short / toast dismiss  
- Invented chart data  

## Gate

```bash
cd apps/web && yarn typecheck && yarn test && yarn check-copy
# manual A: Trade → Open Short/Long → Review → Cancel + Confirm fully visible above banner
# manual B: many ranges listed → list scrolls inside card; Use available short still works; Short side does not flood the viz pane
```
