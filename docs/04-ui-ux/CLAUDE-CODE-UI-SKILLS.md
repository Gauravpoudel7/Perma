# Claude Code — Skills for PERMA Product UI V2

Run these on the machine where Claude Code runs (your Mac), from any directory. Prefer **project** install so the PERMA repo inherits them.

## A. Must install before UI V2

```bash
# Official Anthropic frontend design (anti AI-slop)
/plugin install frontend-design@claude-plugins-official
/reload-plugins

# Vercel: a11y/UX audit + React/Next performance + composition
npx skills add vercel-labs/agent-skills \
  --skill web-design-guidelines \
  --skill react-best-practices \
  --skill composition-patterns \
  -a claude-code -y

# TradingView Lightweight Charts agent skill (v5 API)
npx skills add https://github.com/tradingview/lightweight-charts -a claude-code -y
```

Verify:

```bash
claude plugin list
# expect: frontend-design among plugins

ls ~/.claude/skills 2>/dev/null; ls .claude/skills 2>/dev/null
# expect web-design-guidelines, react-best-practices, composition-patterns, lightweight-charts-related
```

## B. Optional (visual critique loops)

```bash
# Multi-persona design loop — use on polish passes only (token-heavy)
# /plugin marketplace add andrejkanuch/design-lenses
# /plugin install <name>@design-lenses
```

## C. Already have — how to use for UI

| Tool | During UI V2 |
|---|---|
| frontend-design | **Always on** for visual work |
| web-design-guidelines | After each phase: “audit apps/web against guidelines” |
| react-best-practices | When wiring charts / dynamic import / fetch |
| composition-patterns | When refactoring TradePanel / shell |
| caveman | **Disable** for UI copy/layout (too terse for product prose) |
| ponytail | **Disable** for UI density (fights rich layouts) |
| Graphify | Once: map `apps/web/src` before U1 |
| headroom | Optional on huge redesign prompts |

## D. PERMA project skills (create in repo)

Copy the four `SKILL.md` files from `docs/04-ui-ux/claude-skills/` into `.claude/skills/<name>/SKILL.md` (or tell Claude Code to read them at prompt start).

## E. Session recipe (each phase)

1. Open Claude Code in `Perma/` root.
2. Confirm plugins: frontend-design on; ponytail/caveman off for this session.
3. Paste the phase prompt from `docs/06-testing/CLAUDE-IMPLEMENT-UI-V2-*.md`.
4. After code: run gates in prompt.
5. Ask: “Run web-design-guidelines on changed files.”
6. Manual browse desktop + phone width before marking phase done.


## F. Extra skills from deep research (optional but recommended)

```bash
# WCAG evidence
npx skills add AccessLint/skills -a claude-code -y

# Impeccable anti-slop / design commands
npx impeccable install
# then in Claude Code:
/impeccable init

# Reference-driven layout (structure from peers — never pixel-copy)
claude plugin marketplace add mojomoth/design-lens
claude plugin install design-lens@design-lens
```

**Port note:** PERMA indexer prefers `:8799`. Headroom often uses `:8787` — don’t collide.

**Conflict rule:** design stack ON for visual phases; `/ponytail off` then. Ponytail ON only for tx/hook/IDL-minimal code later.

Full peer teardown + paste blocks: `docs/04-ui-ux/UI-UPGRADE-RESEARCH.md` (538 lines).
