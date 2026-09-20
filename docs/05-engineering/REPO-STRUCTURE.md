# REPO STRUCTURE: PERMA

## Project Layout
The PERMA repository is organized to separate on-chain logic, off-chain indexing, and the user interface.

```text
perma/
├── programs/
│   └── perma/             # Anchor program source code
│       └── src/           # Rust source (modules for risk, premium, etc.)
├── scripts/               # local-validator.sh, make-fixtures.mjs, reconcile.mjs, measure*.mjs
├── apps/web/              # Frontend (Next.js) — SHIPPED; see apps/web/README.md
│   ├── components/        # UI Components
│   ├── hooks/             # Solana/Anchor custom hooks
│   ├── lib/               # SDK & API clients
│   └── pages/             # Application routes
├── indexer/               # Off-chain state sync (Node.js) — P2, not in repo; Fair's event consumer is apps/web/src/lib/events.ts
│   ├── src/               # Indexer logic
│   └── prisma/            # Database schema
├── docs/                  # Technical & Product documentation
│   ├── 00-overview/
│   ├── 01-architecture/
│   ├── 02-mvp-components/
│   └── ...
├── tests/                 # ts-mocha integration suites + fixtures/ (adapter, collateral, factory, position-*, settle-premium)
├── Anchor.toml            # Anchor configuration
└── README.md              # Project entry point
```

## Core Module Mapping
Within `programs/perma/src/`, the logic is split as follows:
- `factory.rs`: Market creation and allowlist logic.
- `collateral.rs`: Deposit/Withdraw/Lock logic.
- `position.rs`: Position open/close ledger transitions (`open_short`, `close_short`, `open_long`, `close_long`).
- `premium.rs`: Index-based premium calculation.
- `risk.rs`: the solvency gate — `required_margin`, `required_free_usdc`, `check_withdraw_allowed`, `check_long_mint_allowed`, `collect_open_longs` (component 09). No P&L math exists, by decision.
- `adapter.rs`: Orca Whirlpool CPI wrappers and tick/PDA math.
- `errors.rs`: the `PermaError` enum.
- `lib.rs`: instruction handlers and account structs.
- `state.rs`: Account structures (PDAs).

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
