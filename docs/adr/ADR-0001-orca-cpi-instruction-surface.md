# ADR 0001: Orca CPI Instruction Surface and Position Ownership Model

**Date**: 2026-09-19
**Status**: Accepted
**Decider(s)**: PERMA engineering

### Context

The docs audit ([`DOCS-AUDIT-REPORT.md`](../audits/DOCS-AUDIT-REPORT.md)) graded the CLMM Adapter **Partial** — the spec lacked TickArray management and CPI account layouts.

While closing that gap against the Orca source (`orca-so/whirlpools`, commit `408c945fef4c49ab70def4303377cfaf8f0f3c99`, 2026-09-03), a more serious problem surfaced: **the instruction names in the PERMA docs do not exist in the Whirlpool program.** Earlier drafts referenced `increase_position` and `decrease_position`. The real program exposes `open_position`, `increase_liquidity` / `increase_liquidity_v2`, `decrease_liquidity` / `decrease_liquidity_v2`, `collect_fees` / `collect_fees_v2`, `close_position`, and `initialize_tick_array`. The invented names had propagated into five documents.

Three decisions had to be made to write an implementation-ready adapter spec. Process rule: when Orca reality conflicts with a prior PERMA assumption, PERMA changes.

### Options Considered

**1. Instruction naming**

- **Option 1a — Keep `increase_position` / `decrease_position` as PERMA-internal adapter method names.**
    - **Pros**: No cross-doc churn.
    - **Cons**: Names collide conceptually with real Orca instructions that behave differently; every engineer reading the spec would search the Whirlpool IDL for a name that is not there. The audit's "implementable without guessing" bar fails.
- **Option 1b — Adopt the real Orca instruction names everywhere; give PERMA adapter functions clearly PERMA-flavored names.**
    - **Pros**: Doc text greps directly against the Whirlpool IDL; no ambiguity about what is a CPI and what is PERMA's own API.
    - **Cons**: One-line edits across five docs.

**2. v1 vs v2 liquidity instructions**

- **Option 2a — v1 (`increase_liquidity` / `decrease_liquidity`).**
    - **Pros**: 10 accounts instead of 15; lower CU; simplest tables.
    - **Cons**: Constrains `token_program` to `address = token::ID`, hardcoding the legacy SPL Token program. Any future Token-2022 market requires re-specifying and re-auditing the adapter.
- **Option 2b — v2 (`increase_liquidity_v2` / `decrease_liquidity_v2` / `collect_fees_v2`).**
    - **Pros**: Token-program-agnostic via `Interface<TokenInterface>`; handles transfer hooks through `RemainingAccountsInfo`; what the current Orca SDK emits, so client and program agree.
    - **Cons**: Three extra accounts (`token_program_a`, `token_program_b`, `memo_program`) plus two mint accounts; slightly more CU and transaction bytes.

**3. Orca position ownership**

- **Option 3a — One Orca position per PERMA short.**
    - **Pros**: 1:1 mapping; partial close, full close, and P&L attribution are all trivial; no internal share ledger.
    - **Cons**: Position + mint + ATA rent per short; more accounts per transaction.
- **Option 3b — One shared Orca position per `(market, tick range)`, with PERMA netting user shorts internally.**
    - **Pros**: Less rent; fewer accounts; ranges consolidate naturally.
    - **Cons**: Requires an internal share ledger and fee attribution logic; partial closes become proportional-withdrawal math; a bug in the ledger is a direct solvency bug. Substantial extra surface for a Fair MVP.

### Decision

- **Option 1b** — the CLMM Adapter spec and all cross-references use the real Orca instruction names. PERMA's own adapter API uses deliberately distinct names (`add_liquidity_for_short`, `remove_liquidity_for_short`) so a reader can always tell a CPI from a PERMA call.
- **Option 2b** — PERMA targets the **v2** instruction family. The Token-2022 optionality is worth three accounts, and matching the SDK's emitted instruction removes a class of client/program mismatch bugs. MVP always passes `remaining_accounts_info: None` and asserts zero remaining accounts, because neither WSOL nor USDC has a transfer hook.
- **Option 3a** — **one Orca position per PERMA short**, with the position NFT held in an ATA owned by the `market_authority` PDA. Fair MVP optimizes for auditability over rent efficiency. Revisit only if per-transaction account limits become binding.

Additionally, two Orca behaviors discovered during verification are recorded here because they are counter-intuitive and cost real debugging time:

1. **The full-close sequence is exactly `decrease_liquidity_v2` → `collect_fees_v2` → `close_position`.** Inserting `update_fees_and_rewards` between the first two **fails**: `_calculate_modify_liquidity` returns `LiquidityZero` (`0x177c`) when `liquidity_delta == 0 && position.liquidity == 0`, which is precisely the state after a full decrease. `decrease_liquidity` already updates fee growths itself, so the refresh is both redundant and invalid. Omitting `collect_fees_v2` instead fails at `close_position` with `ClosePositionNotEmpty` (`0x1775`).
2. **TickArray PDA seeds use the decimal ASCII string of the start index** — `start_tick_index.to_string().as_bytes()`, not `to_le_bytes()`. Combined with the requirement to use floor division (`i32::div_euclid`) rather than Rust's truncating `/` for negative ticks — and the entire SOL/USDC range is negative — this is the highest-risk detail in the integration.

### Consequences

- **Positive**: The adapter spec is now implementable directly against the Whirlpool IDL with no name translation. Token-2022 markets remain possible without re-specifying the adapter. Position accounting stays trivial.
- **Positive**: The two counter-intuitive behaviors above are captured as regression tests in [`01-clmm-adapter-orca.md`](../02-mvp-components/01-clmm-adapter-orca.md) §"Test Cases", so a future refactor cannot silently reintroduce them.
- **Negative**: Each PERMA short carries Orca position + mint + ATA rent, paid by the user. The UI must disclose this, along with the one-time TickArray rent when a range needs a new array.
- **Negative**: v2 costs three extra accounts per liquidity CPI, tightening the 1232-byte transaction budget when `open_position` and a TickArray init are bundled into one transaction.
- **Risk**: The Orca dependency is pinned to a **commit**, not a release tag — the repo's `v1.x` tags cover the SDK, not the program. Any bump requires re-verifying every account table in the adapter spec and a follow-up ADR.
- **Risk**: The shared-position model (Option 3b) is the natural scaling path post-Fair. Choosing 3a now means that migration is a real project, not a refactor.

---
**Related Docs**: [`docs/02-mvp-components/01-clmm-adapter-orca.md`](../02-mvp-components/01-clmm-adapter-orca.md) · [`PRD.md` Part A](../../PRD.md) · [`docs/03-api-interfaces/ERROR-CATALOG.md`](../03-api-interfaces/ERROR-CATALOG.md)

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
