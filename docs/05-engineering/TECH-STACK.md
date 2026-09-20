# TECH STACK: PERMA

## On-Chain (Solana)
- **Language**: Rust
- **Framework**: Anchor **1.2.0** (`anchor-lang` 1.2.0; build with **`anchor build --arch v0`** — the v3 default produces an ELF the local loader rejects). Solana/Agave 3.0.0.
- **Underlying CLMM**: Orca Whirlpool via `orca_whirlpools_client` 8.0.0 **without** its `anchor` feature (ADR-0001). No `anchor-spl`: SPL calls are hand-built.
- **Tokens**: classic SPL Token only (WSOL and devUSDC). No Token-2022 path.

## Off-Chain (Frontend & API) — *planned; not in the repo*
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Custom-built (following Institutional Precision spec).
- **State**: Zustand
- **Blockchain Interaction**: `@solana/web3.js`, `@coral-xyz/anchor`.

## Indexing & Data — *P2; not in the repo* (Fair's consumer is `apps/web/src/lib/events.ts`, no database)
- **Runtime**: Node.js
- **Database**: PostgreSQL (via Prisma ORM).
- **RPC Provider**: Helius / Triton (Devnet).

## Tooling & DevOps
- **Local Validation**: `solana-test-validator`
- **Testing**: `cargo test` (54 unit) and `ts-mocha` + `chai` (66 integration) against `scripts/local-validator.sh`.
- **CI/CD**: none yet.
- **Linting**: `yarn lint` = `cargo fmt --check && cargo clippy` (currently red on formatting in files predating component 08; own commit).

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
