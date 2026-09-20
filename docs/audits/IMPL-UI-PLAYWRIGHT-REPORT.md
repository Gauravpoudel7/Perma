# IMPL-UI-PLAYWRIGHT-REPORT

**Status:** Shipped. **Date:** 2026-09-20. **Scope:** close the one gap `IMPL-UI-TRADE-PORTFOLIO-REPORT.md` explicitly flagged — real rendered-pixel/viewport/keyboard verification of `apps/web`'s Trade/Portfolio/Vault UI, which that build could only sign off by grep/config inspection because no browser tool was available. No feature work, no program changes, no scope beyond disconnected-wallet visual/e2e QA.

## 1. What was added

- `apps/web/playwright.config.ts` — `testDir: e2e`, `webServer` starts `next dev` itself (port 3001, since 3000 is routinely occupied on this machine), three projects: `desktop-chromium` (1440×900), `mobile-chromium` (390×844), `desktop-webkit` (1440×900, a cross-engine sanity check — WebKit via Playwright is not a driven instance of Safari.app).
- `apps/web/e2e/shell.spec.ts` — banner exact-text match on all three routes, no-horizontal-overflow check at the live viewport, primary nav between Trade/Portfolio/Vault.
- `apps/web/e2e/disconnected.spec.ts` — real disconnected-wallet copy (`Connect a wallet to continue.`) on all three routes, no mint button present on Trade, no positions table on Portfolio, no "Solvency Ratio" text anywhere on Vault.
- `apps/web/e2e/keyboard.spec.ts` — real `Tab`-key traversal (not `.focus()`) from the Sidenav through to the Connect button, asserts it receives focus and has a non-`none` outline, screenshots the result.
- `apps/web/e2e/screenshots.spec.ts` — the six required screenshots (`{trade,portfolio,vault}-{desktop,mobile}.png`) plus two bonus focus-ring screenshots, all in `docs/04-ui-ux/screenshots/`.
- `apps/web/package.json` — `test:e2e` / `test:e2e:update-screenshots` scripts, `@playwright/test` devDependency.
- `apps/web/.gitignore` — `test-results/`, `playwright-report/`, `blob-report/`, `playwright/.cache/`.

All 38 applicable specs pass (4 WebKit cases are intentionally skipped — see §4). Wallet stays disconnected throughout, matching the plan: this is a visual/layout pass, not a transaction pass (that's what `yarn verify-live`/`verify-mint-long`/`verify-withdraw-and-burn` are for, and they still pass unchanged).

## 2. Two real bugs found and fixed

This is exactly the class of bug static analysis (`tsc`, `vitest`, `eslint`) cannot catch, because none of them execute the app in a real browser.

### 2a. The entire client bundle never rendered — `NEXT_PUBLIC_*` env vars were read dynamically

**Symptom:** every route rendered a blank black screen under a real browser. `page.on("pageerror")` showed: `Missing NEXT_PUBLIC_RPC_URL. Copy apps/web/.env.example to .env.local and fill it in.` — thrown from `src/lib/constants.ts`, even though `.env.local` exists on disk with the correct values, and `next build`/SSR curl output both looked fine.

**Root cause:** `src/lib/constants.ts`'s `requireEnv(name)` read the value as `process.env[name]` — a *dynamic* bracket-notation lookup. Next.js only inlines `NEXT_PUBLIC_*` values into the **client** bundle when the exact literal expression `process.env.NEXT_PUBLIC_X` appears at the call site (webpack's `DefinePlugin` does a textual replacement, not a real runtime env read — there is no `process.env` object in the browser at all otherwise). A dynamic key is invisible to that replacement, so `RPC_URL`, `PERMA_PROGRAM_ID`, and `WHIRLPOOL` all silently became `undefined` in every client component, while the same code worked fine in `verify-live.ts`/`verify-mint-long.ts` (real Node.js, where `process.env` is real at runtime) and in SSR (same reason). **This means the shipped Trade/Portfolio/Vault UI had never actually rendered successfully in a browser before this pass** — the previous report's "no browser tool available" gap wasn't just a missing checkbox, it was hiding a total showstopper.

**Fix:** `requireEnv` now takes the already-read value as a parameter instead of the variable name, and every call site passes the literal `process.env.NEXT_PUBLIC_X` expression directly (`src/lib/constants.ts`). Grepped the rest of `src/` and `scripts/` for the same `process.env[` anti-pattern — no other occurrences.

### 2b. Sidenav had no responsive collapse, causing real horizontal overflow on mobile

**Symptom:** `apps/web/e2e/shell.spec.ts`'s overflow check failed on all three routes at 390×844: `scrollWidth` 396 vs `clientWidth` 390.

**Root cause:** `Sidenav.tsx` always rendered at a fixed `w-48` (192px) regardless of viewport — it already had a `collapsed` boolean prop half-built (icon-only single-letter labels) but nothing ever passed it, so on a 390px-wide phone the sidenav alone ate roughly half the screen and squeezed the rest into overflow.

**Fix:** replaced the unused JS `collapsed` prop path with a pure Tailwind breakpoint collapse — `w-14` icon-rail below `md`, full `w-48` labeled rail at `md` and up — so it's SSR-safe with no resize-listener/hydration-mismatch risk. Verified with a re-run: all three mobile overflow checks now pass, and the mobile screenshots show a clean icon-rail (`docs/04-ui-ux/screenshots/{trade,portfolio,vault}-mobile.png`).

## 3. Environment note: Playwright browser install in this sandbox

`npx playwright install chromium` (and `webkit`) failed reproducibly with `Request ... timed out after 30000ms` against `cdn.playwright.dev`'s Chrome-for-Testing redirect target. Root cause: this sandbox's route to `storage.googleapis.com` (the actual download host after redirect) is IPv6-reachable but effectively stalls on IPv6, and throttled to roughly 1 MB/s over IPv4 — well under the 190 MB Chromium package's requirement to complete inside Playwright's hardcoded 30-second idle-socket timeout for that specific downloader path. WebKit's smaller, differently-hosted package (`playwright.download.prss.microsoft.com`) happened to complete in time.

Worked around by downloading both `chrome-mac-arm64.zip` and `chrome-headless-shell-mac-arm64.zip` directly from `storage.googleapis.com` with `curl -4` (forcing IPv4) and generous retry/resume flags, then extracting them into `~/Library/Caches/ms-playwright/{chromium-1243,chromium_headless_shell-1243}/` by hand (matching the exact layout `playwright-core`'s `browsers.json`/registry code expects) and writing the `INSTALLATION_COMPLETE` marker files. `npx playwright install webkit` succeeded normally on retry. If this recurs in a fresh environment, the same manual-download workaround applies — see this section for the exact URLs and target paths.

## 4. Known gaps (explicit, not silently dropped)

- **WebKit ≠ Safari.app.** `desktop-webkit` runs the WebKit *engine* via Playwright, not a driven instance of the real Safari browser on macOS/iOS — closest automated stand-in available, not equivalent. It is skipped for `keyboard.spec.ts` and `screenshots.spec.ts` (both chromium-only, to avoid two "desktop" runs racing to write the same screenshot file); it still runs the banner/overflow/nav/disconnected-copy specs as a cross-engine sanity check and passes.
- **Mobile emulation ≠ a real device.** `mobile-chromium` is Chromium's viewport/UA emulation at 390×844, not real iOS Safari or Android Chrome. No real-device or BrowserStack-style pass was performed.
- **No screen reader was run.** Keyboard-focus and contrast are verified; VoiceOver/NVDA were not.
- **Vault's "Required free USDC" tile is not asserted in `disconnected.spec.ts`.** It only renders once a wallet is connected, and this pass is intentionally disconnected-only (wallet-connected e2e needs a seed wallet + local validator, explicitly out of scope for this task). The spec instead asserts the real disconnected-state copy and the absence of "Solvency Ratio" text, which is true in both states.
- Connected-wallet flows (mint/burn/settle/deposit/withdraw as actually exercised by a signer) remain covered only by `yarn verify-live`/`verify-mint-long`/`verify-withdraw-and-burn` against a local validator, not by Playwright.

## 5. Verification

- `yarn typecheck` — clean.
- `yarn test` (vitest, 28 tests) — unaffected, still green.
- `yarn check-copy` — no banned phrases.
- `yarn build` — clean production build.
- `yarn test:e2e` — 38 passed, 4 intentionally skipped, 0 failed.
- `git status --short programs/ tests/` at the repo root — no changes; this task never touched the Rust/Anchor side.
- Dev server left running locally per the task's Phase 5 — see the chat reply for the exact URL.
