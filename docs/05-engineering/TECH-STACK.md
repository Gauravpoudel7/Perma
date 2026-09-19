# TECH STACK: PERMA

## On-Chain (Solana)
- **Language**: Rust
- **Framework**: Anchor (v0.29+)
- **Underlying CLMM**: Orca Whirlpool
- **Tokens**: SPL Token / Token-2022 (Standard SOL and USDC).

## Off-Chain (Frontend & API)
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Custom-built (following Institutional Precision spec).
- **State**: Zustand
- **Blockchain Interaction**: `@solana/web3.js`, `@coral-xyz/anchor`.

## Indexing & Data
- **Runtime**: Node.js
- **Database**: PostgreSQL (via Prisma ORM).
- **RPC Provider**: Helius / Triton (Devnet).

## Tooling & DevOps
- **Local Validation**: `solana-test-validator`
- **Testing**: `mocha`, `chai` (via Anchor).
- **CI/CD**: GitHub Actions.
- **Linting**: `cargo fmt`, `eslint`, `prettier`.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
