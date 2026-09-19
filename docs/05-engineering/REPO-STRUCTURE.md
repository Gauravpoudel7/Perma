# REPO STRUCTURE: PERMA

## Project Layout
The PERMA repository is organized to separate on-chain logic, off-chain indexing, and the user interface.

```text
perma/
├── programs/
│   └── perma/             # Anchor program source code
│       ├── src/           # Rust source (modules for risk, premium, etc.)
│       └── tests/         # Integration tests (TypeScript)
├── app/                   # Frontend (Next.js)
│   ├── components/        # UI Components
│   ├── hooks/             # Solana/Anchor custom hooks
│   ├── lib/               # SDK & API clients
│   └── pages/             # Application routes
├── indexer/               # Off-chain state sync (Node.js)
│   ├── src/               # Indexer logic
│   └── prisma/            # Database schema
├── docs/                  # Technical & Product documentation
│   ├── 00-overview/
│   ├── 01-architecture/
│   ├── 02-mvp-components/
│   └── ...
├── tests/                 # Global E2E and math tests
├── Anchor.toml            # Anchor configuration
└── README.md              # Project entry point
```

## Core Module Mapping
Within `programs/perma/src/`, the logic is split as follows:
- `factory.rs`: Market creation and allowlist logic.
- `collateral.rs`: Deposit/Withdraw/Lock logic.
- `position.rs`: Position minting and burning.
- `premium.rs`: Index-based premium calculation.
- `risk.rs`: Solvency and P&L calculations.
- `adapter.rs`: Orca Whirlpool CPI wrappers.
- `state.rs`: Account structures (PDAs).

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
