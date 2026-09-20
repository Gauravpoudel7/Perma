# PERMA — Claude Code Prompt: Thin Trade / Portfolio / Vault UI

**How to use:** New Claude Code chat in `Perma/` repo root. Paste `PROMPT` → `END PROMPT`, then the one-liner.

**Goal:** Ship a **thin but excellent** Fair MVP web UI: Trade, Portfolio, Collateral/Vault. Institutional Precision. Responsive. No AI-slop. Wired to the **live** 01–09 program (shorts, longs, premium cash settle, solvency).

**Why this prompt is careful:** UI docs (`APP-SHELL`, `COPY-DECK`) still mention mark P&L % and “solvency ratio” in places that **ADR-0003 / component 09** do not support. Prefer live risk model over stale marketing columns. Do not invent TVL/APY or liquidation screens.

---

````text
PROMPT
=====

# Role

You are a senior product engineer + UI implementer building PERMA’s Fair MVP **Trade / Portfolio / Vault** web app.

Fresh chat. **UI-only** — do not change on-chain program logic unless a tiny IDL/export helper is required for the client. Keep Anchor program tests green if you touch shared tooling.

# Product lock

- Fair MVP: one allowlisted SOL/USDC Orca market, 1-leg, **devnet**
- Banner verbatim on every route, non-dismissible:
  `Prototype. Not audited. Single pool. Not production mainnet risk capital.`
- Stack preference: **Next.js App Router + TypeScript + Tailwind** (or Vite+React if the repo already standardized — match existing layout). Solana wallet-adapter. Anchor TS client from IDL.
- Read **before coding**:
  1. `docs/04-ui-ux/BRAND-SYSTEM.md`
  2. `docs/04-ui-ux/APP-SHELL.md`
  3. `docs/04-ui-ux/WIREFRAMES.md`
  4. `docs/04-ui-ux/COMPONENT-LIBRARY.md`
  5. `docs/04-ui-ux/COPY-DECK.md` (strings source of truth — except honesty overrides below)
  6. `docs/04-ui-ux/UI-QA-CHECKLIST.md`
  7. `docs/adr/ADR-0003-fair-mvp-risk-model.md` + `docs/02-mvp-components/09-risk-solvency.md`
  8. `docs/adr/ADR-0002-premium-accounting.md`
  9. `docs/audits/IMPL-08-BURN-SETTLE-REPORT.md`, `IMPL-09-RISK-SOLVENCY-REPORT.md`
  10. `docs/03-api-interfaces/INSTRUCTIONS.md`, `ERROR-CATALOG.md`
  11. Live IDL under `target/idl` or generate via `anchor build`

# Honesty overrides (beat stale copy)

| Stale UI doc idea | Live truth |
|---|---|
| Unrealized P&L column as primary | Fair MVP: **no synthetic long intrinsic**. Short realized delta is returned−locked on close. Portfolio: Side, Range, Size, **Accrued premium (Est.)**, Status (`Open` / `PendingPremium`), Close / Settle |
| “Solvency Ratio %” | Show **free USDC vs required** (owed + projected accrual + horizon margin per ADR-0003). Block withdraw with COPY-DECK solvency message |
| Closing “premium and P&L…” | Prefer “Settling premium…” unless you display only realized short token delta honestly |
| TWAP price | Spot from Whirlpool only; label **Spot**, never TWAP |
| Liquidation distance | **Out of scope** — no liquidation in Fair MVP |

Update `COPY-DECK.md` surgically for any string you change; do not invent hype.

# PHASE 0 — FEASIBILITY (mandatory)

Write `docs/audits/IMPL-UI-FEASIBILITY.md` with GO / blockers:

## Q1 — App location
`apps/web`, `web/`, or `frontend/`? Prefer `apps/web` monorepo-style if Anchor root stays clean. Document.

## Q2 — Cluster & config
Env vars: `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_CLUSTER=devnet`, `NEXT_PUBLIC_PERMA_PROGRAM_ID`, market PDA, whirlpool, mints. Never hardcode secrets.

## Q3 — IDL path
How the UI loads the program IDL and types. Commit a generated `idl/perma.json` + types if needed for reproducible builds.

## Q4 — Instruction account maps
Confirm client builders for:
- `deposit_collateral` / `withdraw_collateral` (09: remaining accounts = open longs when `open_longs > 0`)
- `mint_position` SHORT (full Orca accounts) vs LONG (optional Orca accounts per 09)
- `burn_position` + `settle_premium` (range_vault, premium index, range state)
- Create/ATA / tick array edge cases — show COPY-DECK rent notice when a new tick array is needed

## Q5 — Data reads
How you list user positions (PDA derivation with nonce? getProgramAccounts filtered?). Cap awareness: `MAX_OPEN_LONGS = 8`.

## Q6 — Design token implementation
Map BRAND-SYSTEM tokens to CSS variables / Tailwind theme. Reject glass, gradients, soft shadows (UI-QA).

## Q7 — Responsive plan
Desktop shell with sidenav; `<1024` collapsible nav; `<640` stacked portfolio cards; banner wraps two lines; no horizontal scroll.

End Phase 0 with GO + file tree.

---

# PHASE 1 — IMPLEMENT

## Shell
- Persistent prototype banner
- Sidenav: Trade · Portfolio · Vault · Docs (link)
- Top: wallet connect, cluster guard, market paused badge, optional spot ticker
- Toasts: pending → confirmed (explorer link) / failed (ERROR-CATALOG name)

## Trade
- Market: `SOL/USDC · Orca Whirlpool`
- Dual range control snapped to `tick_spacing`; monospace tick labels
- Size input; Short / Long toggle with COPY-DECK labels
- Preview: est. premium/hour (labeled Est.); for short, collateral/slippage caps UX
- Long empty inventory → exact empty-inventory copy; disable CTA
- CTAs: Open Short / Open Long; wallet confirm copy

## Portfolio
- Table/cards of open + pending-premium positions
- Actions: Close; Settle premium when relevant (long crank permissionless optional advanced; short claim when PendingPremium)
- Empty state from COPY-DECK
- Collateral summary: deposited / locked / available / **required free USDC** (not fake %)

## Vault
- Deposit / withdraw WSOL & USDC
- Withdraw preflight using same solvency projection as chain (pass open longs)
- Solvency block copy when blocked

## Quality bar (non-negotiable)
- Pass UI-QA rejection criteria (no slop)
- Tabular nums on live values; 100ms linear hovers; focus rings
- Loading skeletons; disabled states while tx pending; no double-submit
- Keyboard: tab order through forms; Esc closes slide-overs
- Lighthouse / manual: usable on 375px width
- Map errors — never “Something went wrong” alone

## Tests
- Unit: tick snap, premium estimate formatting, solvency required-free helper
- Optional Playwright: routes render + banner present
- Manual checklist filled in `docs/04-ui-ux/UI-IMPL-NOTES.md` (desktop + mobile screenshots paths)

## Docs
- Root or `apps/web/README.md`: run instructions
- `docs/audits/IMPL-UI-TRADE-PORTFOLIO-REPORT.md`
- Surgical COPY-DECK / APP-SHELL fixes for honesty overrides

## Out of scope (hard)
- Marketing site rebuild
- Admin pause UI (component 10)
- Liquidation, multi-market, multi-leg
- Fake charts of volume/TVL/APY
- Changing rust program behavior
- Enabling mainnet

# Process
1. Phase 0 feasibility  
2. Scaffold app + tokens + shell  
3. Read paths (balances, positions)  
4. Write paths (deposit, mint, burn, settle, withdraw)  
5. Responsive + a11y pass  
6. Report + STOP  

# Done when
- [ ] Trade / Portfolio / Vault usable for the Fair MVP demo loop  
- [ ] Banner + brand + copy compliance  
- [ ] Solvency + inventory + pending premium reflected honestly  
- [ ] Responsive + error mapping  
- [ ] Feasibility + report written  

# Start now
Phase 0 first. Do not ship a default shadcn dashboard skin.

END PROMPT
````

## One-liner

```text
Repo is PERMA. On-chain 01–09 shipped (short/long/premium cash/solvency). Build the thin Fair MVP Trade + Portfolio + Vault web UI per docs/04-ui-ux (Institutional Precision, COPY-DECK, UI-QA). Honesty: ADR-0003 solvency (no fake % / no TWAP / no synthetic long PnL); PendingPremium + settle_premium; inventory-gated longs; prototype banner everywhere. Phase 0 → IMPL-UI-FEASIBILITY.md → Next/Vite+TS+wallet+Anchor IDL → IMPL-UI-TRADE-PORTFOLIO-REPORT.md. Responsive + a11y. Do not change rust program. No marketing-site rebuild. STOP when demo loop works in UI.
```

## Design note for the human
Cloud Agent launch was blocked by Cursor usage limits — this prompt is the local Claude Code path. Prefer real IDL wiring over a mock labeled as production.
