---
name: perma-no-break
description: Use this for any PERMA UI change. Protects on-chain programs, IDL, and existing tx semantics.
---

# PERMA No-Break

## Do not touch

- `programs/**`, Anchor account layouts, instruction discriminators.
- IDL bytes except when program intentionally changed (UI-only work: **no**).
- Solvency / pause / wallet-guard semantics (may restyle, not weaken).

## Keep working

- Hooks: useSendPermaTx, useWalletGuard, deposit SOL+USDC, open short/long, settle/burn, withdraw gates.
- `yarn check-copy`, typecheck, unit tests, Playwright e2e (desktop + mobile projects).

## Allowed

- `apps/web/**` presentation, layout, new presentational components, chart clients, CSS.
- Indexer **read** clients only (no indexer write that mutates accounting).

## Gate before done

```bash
cd apps/web && yarn typecheck && yarn test && yarn check-copy && yarn build
# with localnet + yarn dev as required:
yarn test:e2e
```

