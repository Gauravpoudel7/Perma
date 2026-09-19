# PERMA | Perpetual Options Powered by Solana Liquidity

**Prototype. Not audited. Single pool. Not production mainnet risk capital.**

PERMA is a Solana-native perpetual-options protocol that uses concentrated-liquidity positions as the option primitive, implementing Panoptic V1–equivalent economics—starting with a one-pool Orca MVP.

## 🚀 Quick Start
1. **Read the Docs**: Start with the [Product PRD](PRD.md) and the [MVP Scope](docs/00-overview/MVP-SCOPE.md).
2. **Setup Dev Environment**: Follow the [Local Dev Guide](docs/05-engineering/LOCAL-DEV.md).
3. **Run Tests**: `anchor test`.

## 🛠️ Technical Core
- **Chain**: Solana (Devnet).
- **CLMM**: Orca Whirlpool.
- **Stack**: Rust/Anchor $\rightarrow$ Next.js/TypeScript.

## 📂 Documentation
Full business-class documentation is available in the `/docs` directory:
- **Product & Scope**: `docs/00-overview/`
- **System Architecture**: `docs/01-architecture/`
- **Component Specs**: `docs/02-mvp-components/`
- **API & SDK**: `docs/03-api-interfaces/`
- **Design & UI**: `docs/04-ui-ux/`
- **Engineering**: `docs/05-engineering/`
- **Testing & Release**: `docs/06-testing/`
- **Ops & Presentation**: `docs/07-ops-presentation/`

## ⚖️ Disclaimer
This repository contains a prototype for a technical demonstration. It is not intended for use with real capital. The authors are not responsible for any losses incurred through the use of this prototype.
