# CODING STANDARDS: PERMA

## Rust (On-Chain)
- **Error Handling**: Use custom `ErrorCode` enums for all failure paths. No `unwrap()` or `expect()` in production logic.
- **Integer Precision**: 
    - No floating point math.
    - Use `u64` for balances and `u128` for intermediate premium calculations.
    - Always round **in favor of the protocol** (round up for costs, round down for payouts).
- **Account Validation**: Every account must be checked via `Account` or `Signer` in Anchor. Use `#[account(constraint = ...)]` for business logic invariants.
- **Naming**: 
    - Functions: `snake_case`.
    - Accounts: `PascalCase`.

## TypeScript (Frontend & Indexer)
- **Type Safety**: Strict mode enabled. No `any` types. Use interfaces for all API responses.
- **Async Patterns**: Use `async/await` with explicit `try/catch` blocks for all blockchain interactions.
- **Naming**: `camelCase` for variables/functions, `PascalCase` for components.

## Documentation
- **In-code Comments**: Every public function must have a doc comment explaining its purpose and invariants.
- **ADR**: Any significant change to the architecture must be recorded in an Architecture Decision Record (`docs/templates/ADR-TEMPLATE.md`).

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
