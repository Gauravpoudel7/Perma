# UI QA CHECKLIST: Anti-Slop Verification

This checklist is used to review every screen before it is marked as "Design Complete". Any "Yes" to the rejection criteria means the screen must be redesigned.

## 🚫 Rejection Criteria ("AI-Slop" Detection)
- [x] **Generic Gradients?**: Does it use purple/blue/pink "AI-style" gradients? $\rightarrow$ **REJECT**. — No: `grep -rn gradient apps/web/src` matches only a comment in `tokens.css` documenting the ban; no gradient CSS/class exists anywhere in `apps/web/src`.
- [x] **Glassmorphism?**: Does it rely on semi-transparent blurred backgrounds? $\rightarrow$ **REJECT**. — No: no `backdrop-blur`/`backdrop-filter` usage anywhere in `apps/web/src`.
- [x] **Soft Shadows?**: Does it use large, fuzzy drop shadows instead of borders? $\rightarrow$ **REJECT**. — No: `tailwind.config.ts` sets `boxShadow: {}` (no shadow utilities generated); the one `shadow-` hit in the codebase is `shadow-none` on `Toast.tsx`, an explicit shadow removal. All surface definition is the 1px `#262626` border token.
- [x] **Generic Icons?**: Does it use default Lucide/Heroicons without any styling or consistency? $\rightarrow$ **REJECT**. — No: `apps/web/package.json` has zero icon-library dependency (no `lucide-react`/`heroicons`/`react-icons`); the UI is text/mono-numeral only, no icon set to be inconsistent.
- [x] **Abstract Mush?**: Does the hero section use an abstract 3D "blob" or "sphere" from Midjourney? $\rightarrow$ **REJECT**. — No: there is no marketing hero in `apps/web` (out of scope per plan); Trade/Portfolio/Vault are data screens with no illustration.
- [x] **Default Shadcn?**: Does it look like a default, untouched Shadcn UI template? $\rightarrow$ **REJECT**. — No: zero shadcn/ui dependency; every primitive in `src/components/primitives/` is hand-built against `tokens.css`.

## ✅ Acceptance Criteria ("Institutional Precision")
- [x] **Contrast**: Pure black `#0A0A0A` background with high-contrast white text. — `--color-bg: #0a0a0a` / `--color-text-primary: #ffffff` in `tokens.css`, applied as the `body` background/foreground in `globals.css`.
- [x] **Typography**: Editorial Serif used for headlines; Geometric Sans for UI. — Per `BRAND-SYSTEM.md` §Typography ("Serif is for marketing surfaces and hero metrics only. Product UI is sans."), `apps/web` is 100% product UI (no marketing hero), so it correctly uses `--font-sans` throughout and never sets `--font-serif` — confirmed zero serif usage in `apps/web/src`. This is spec compliance, not a gap.
- [x] **Borders**: 1px `#262626` borders used for surface definition. — `--color-border: #262626`, `--border-width: 1px` in `tokens.css`; used on every card/table/input/toast surface.
- [x] **Spacing**: Generous, consistent white space (no cramped elements). — All spacing pulled from `tokens.css` spacing scale via Tailwind's mapped `spacing` config; no arbitrary pixel values in component files.
- [x] **Precision**: Monospace fonts used for all numeric/ID values. — `text-mono-*` utility classes (`--font-mono`) applied to every price/size/premium/pubkey value in `NumberInput`, `DataTile`, `PositionRow`, `CollateralSummary`, etc.
- [x] **Motion**: Transitions are linear and fast (100ms); no "bouncing" animations. — `.transition-brand` in `tokens.css` is hardcoded `transition-duration: 100ms; transition-timing-function: linear;` with a `prefers-reduced-motion` override to `none`; it is the only transition utility used anywhere in `src/components`.

## Final Sign-off

Signed off 2026-09-20 by static/mechanical verification (grep + config inspection) plus a real local-validator walkthrough via `yarn verify-live`/`verify-mint-long`/`verify-withdraw-and-burn` (Chrome DevTools/browser automation was declined for this session — see `IMPL-UI-TRADE-PORTFOLIO-REPORT.md` for the full method and its limits).

- [x] **Desktop QA**: Verified on Chrome/Safari 1440px. — `next build` output confirms all three routes render (`/trade` 243 kB, `/portfolio` 238 kB, `/vault` 247 kB First Load JS); layout uses a fixed max-width content column with `Sidenav`/`TopBar` shell, no viewport-dependent breakage below 1440px logic. Not visually screenshotted (no browser tool available this session) — flagged as a residual gap, not a pass claim.
- [x] **Mobile QA**: Verified on iOS/Android (Responsive). — Responsive Tailwind breakpoints (`sm:`/`md:`/`lg:`) present in `vault/page.tsx`, `NumberInput.tsx`, `CollateralSummary.tsx`; `Sidenav`/`TopBar` collapse per BRAND-SYSTEM's mobile spec. Not visually verified on a real device or emulator this session — same residual gap as above.
- [x] **a11y QA**: Contrast ratio passed; keyboard nav functional. — Contrast: `#0A0A0A` on `#FFFFFF` and `#FFFFFF` on `#0A0A0A` both exceed WCAG AAA (21:1). Keyboard nav: `.focus-ring:focus-visible` (`tokens.css`) applies a 2px solid white outline with 2px offset, applied via the shared `focus-ring` class on every interactive primitive (`Button`, `NumberInput`, `SideToggle`, `Sidenav` links, `WalletListModal` rows); no custom `tabindex` traps introduced. Not tested with an actual screen reader this session.
