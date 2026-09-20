# ADR 0002: Premium Accounting and Settlement

**Date**: 2026-09-19
**Status**: Accepted
**Decider(s)**: PERMA engineering

### Context

The docs stated a zero-sum premium invariant — *"for every long that pays premium, a short must receive it"* — with **no mechanism behind it**. `08-burn-settle.md` credited a short `premium + pnl` and debited a long `premium + pnl` with nothing connecting the two: no escrow, no counterparty matching, and no rule for splitting one long's payment across several shorts backing the same range.

Related undefined values: `MARKET_MULTIPLIER` appeared in the premium formula with no type, value, owner, or units; the `update_index` poke was "incentivized by a small fee" with no amount.

Fair MVP constraint: the premium **rate stays flat and admin-set**. Utilization- and demand-based pricing is Part B and explicitly out of scope.

### Options Considered

**1. Counterparty accounting**

- **Option 1a — Direct pairwise matching.** Each long is matched to specific shorts at mint; premium flows along those edges.
    - **Pros**: Conceptually obvious; no shared state.
    - **Cons**: Requires storing a match set per long, and re-matching whenever any short closes. Unbounded account references per settle. A short cannot exit without rewriting every long that referenced it.
- **Option 1b — Range-scoped premium bucket, pro-rata by liquidity.** Longs pay into a per-range escrow; shorts draw out in proportion to liquidity provided.
    - **Pros**: O(1) state per position; shorts enter and exit without touching any long; the standard accumulator pattern, well understood.
    - **Cons**: Needs a per-range PDA and a Q64.64 accumulator; introduces dust.

**2. What drives short entitlement**

- **Option 2a — Accrue on realized cash.** The accumulator advances only when a long actually pays.
    - **Pros**: The pool can never owe more than it holds; `receivable` is unnecessary.
    - **Cons**: **A short that closes before any long settles silently forfeits earned premium** — its entitlement is zero at exit, and the money it earned is later distributed to whichever shorts happen to remain. Time-worked is not paid.
- **Option 2b — Accrue on elapsed time, pay from realized cash.** Entitlement advances with slots; `receivable` tracks the gap.
    - **Pros**: Time-accurate and fair regardless of exit order.
    - **Cons**: Entitlement can temporarily exceed cash; needs `receivable` plus a `PendingPremium` position state.

**3. Funding timing**

- **Option 3a — Pay only at long burn.** Simple, but a short closing first almost always receives an IOU rather than cash.
- **Option 3b — Permissionless `settle_premium(long)` crank plus burn.** Anyone can move a long's accrued premium into the bucket at any time.
- **Option 3c — Block short close when underfunded.** No IOUs, but a short can be trapped indefinitely by a long who never closes.

**4. Rounding**

- **Option 4a — Round up per settle.** Debtor pays the extra unit; superficially the "safe" direction.
- **Option 4b — Floor with the sub-unit remainder carried on the position.**

**5. Premium asset**

- **Option 5a — USDC only.**
- **Option 5b — Split proportionally across SOL and USDC.**

**6. Poke reward**

- **Option 6a — A real bounty per poke.**
- **Option 6b — Zero.**

### Decision

- **1b — range-scoped bucket, pro-rata by `liquidity`.** `RangePremiumState` holds a Q64.64 accumulator; a short's claim is `floor((acc_now − entry_acc) × liquidity / 2^64)`. Escrow is a separate PDA token account per range, so vault conservation is independently checkable.
- **2b — accrue entitlement on elapsed time, pay from realized cash,** with `receivable` bridging the gap and a `PendingPremium` position state for a short whose claim outlives its liquidity. The forfeiture failure in 2a was decisive: a model where working capital earns nothing because of exit ordering is simply wrong, and no amount of documentation makes it acceptable.
- **3b — permissionless `settle_premium(long)`.** This also gives `settle_premium()` — already listed in `PRD.md` §A5 — a concrete job. Shorts have a natural incentive to crank the longs in their range before closing, which is what keeps the pool funded in practice.
- **4b — floor with carry.** See below; this one is not a style preference.
- **5a — USDC only.** One pool balance, one rounding rule, one dust accumulator. Splitting across two assets doubles every formula and requires a price to split by, which would pull the oracle into premium math for no benefit.
- **6b — poke reward zero.** The only available funding source is `premium_pool`, which is money that already belongs to shorts; a bounty would pay cranks out of creditors' funds. It is also unnecessary: the index is a pure function of elapsed slots, so a late poke catches up exactly and nothing is lost by not calling it. `mint_position`, `burn_position`, and `settle_premium` each refresh the index before use.

**`premium_multiplier`** is the canonical name (retiring `MARKET_MULTIPLIER`), a `u64` on the `Market` PDA, admin-only, defaulting to `1_000`, in units of µUSDC·`PREMIUM_SCALE` per (liquidity unit × index unit). It is kept separate from `premium_rate` because the two have different reasons to change: the rate is the clock speed, the multiplier is the price conversion and depends on what a liquidity unit is worth in the specific pool. Both defaults are **tuned for demo visibility, not derived from an options-pricing model**.

#### Why floor-with-carry is a security decision, not a style one

Option 3b makes `settle_premium(long)` callable by anyone. Combined with round-up (4a), settle frequency becomes an attack parameter. At `L = 1500`, `premium_rate = 1e6`, `premium_multiplier = 1000`, true cost is 1.5 µUSDC/slot, so 100 slots honestly cost **150**:

| Policy | 100 single-slot settles | Error |
|---|---|---|
| floor + carry | **150** | exact |
| ceil per settle | **200** | +33%, attacker-controlled |
| floor per settle, no carry | **100** | −33%, shorts underpaid |

Carrying the remainder makes settle frequency irrelevant: any partition of a slot range sums to the single-shot amount. **That property is the precondition for 3b being safe at all.** It is enforced by vector V6.

### Consequences

- **Positive**: The zero-sum invariant now has a mechanism — `Σ short claims + dust == Σ long payments` per range, with zero protocol skim while the range is live. Multi-short splits are implementable without inventing policy.
- **Positive**: Shorts enter and exit freely; no long is ever rewritten because a short left.
- **Positive**: A short that exits early is still paid for the time it worked.
- **Negative**: One `RangePremiumState` PDA and one token account per distinct tick range. Unbounded if users pick many ranges — fine at demo scale, but a cap on distinct ranges per market is worth adding before any real size.
- **Negative**: `PendingPremium` means a short's account can outlive its liquidity, holding rent until the claim clears.
- **Negative**: Dust is unavoidable and accumulates. *(As shipped in 08: the residue stays inside `premium_pool`, unclaimable by any position; the `dust` field is declared and never written, and no range-unwind or sweep instruction exists — see the 08 report residual #2. The "sweep to the protocol on unwind" below is the intended Protocol V1 rule.)* It is swept to the protocol only when a range fully unwinds — the single path by which the protocol receives any premium — and never credited to any party mid-life.
- **Risk**: **Fair MVP has no liquidation** (`PRD.md` §A2 lists it as an optional stretch). The premium-as-liability check in `09-risk-solvency.md` is the only defence against a long accruing unpayable premium — shipped in component 09 ([ADR-0003](ADR-0003-fair-mvp-risk-model.md)): free USDC must cover open-long accrual plus a horizon margin on every withdraw and long mint. Even with it, past the margin horizon a long can owe more than it holds; the honest MVP outcome is that the position stays open, the debt stands, and shorts hold `receivable` until it is paid. Accepted for a devnet prototype; **not acceptable for real size**, where liquidation or a premium pre-funding requirement must land first.
- **Risk**: `premium_rate` and `premium_multiplier` defaults are demo-tuned. Shipping them against real notional would be arbitrary pricing. Recalibrate and record in a follow-up ADR.

---
**Related Docs**: [`07-premium-engine.md`](../02-mvp-components/07-premium-engine.md) · [`08-burn-settle.md`](../02-mvp-components/08-burn-settle.md) · [`09-risk-solvency.md`](../02-mvp-components/09-risk-solvency.md) · [`FIXTURES-AND-VECTORS.md`](../06-testing/FIXTURES-AND-VECTORS.md) · [`PRD.md` Part A](../../PRD.md)

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

---

## Addendum — 2026-09-19: collateral is WSOL, not native SOL

**Status**: Accepted · **Component**: 03

`03-collateral-manager.md` originally named the fields `sol_balance` / `sol_locked`.
Implementing the ledger showed that is not representable: `Market.vault_a` is a
**WSOL SPL token account** and the Orca adapter moves SPL tokens exclusively
(`lib.rs` liquidity CPIs). Tracking native lamports alongside WSOL would create
two representations of one asset with no wrap/unwrap ledger to reconcile them —
unconservable by construction.

**Decision:** collateral is SPL-only. Side `a` = `Market.token_mint_a` (WSOL,
9 dp), side `b` = `token_mint_b` (devUSDC, 6 dp). "SOL collateral" means wrapped
SOL. Native-SOL wrapping at deposit time is a UX nicety for a later component,
not a collateral model.

**Premium unchanged:** still USDC-only (side `b`), still a senior claim. Component
03 enforces seniority at two points — `debit_usdc` draws from free USDC only and
never `locked_b`, and `withdraw_collateral` refuses to leave free USDC below
`premium_owed_usdc`. Taking locked funds to pay a long's premium would move
collateral backing someone else's short.


---

## Addendum — 2026-09-19: long burn records a liability, moves no cash (component 06)

**Status**: Accepted · **Supersedes**: nothing; scopes the gap until component 08.

### Context

Component 06 ships long mint behind the inventory gate, plus the minimum premium
scaffold that gate requires (`GlobalPremiumIndex`, `RangePremiumState`,
`poke_range`). It deliberately does **not** ship `settle_premium`, the
`range_vault` escrow, or any USDC movement — those are component 08.

That leaves one question with no cost-free answer: what happens when a long that
owes accrued premium is closed?

### Decision

**Accrue, record the payable on `UserCollateral.premium_owed_usdc`, close the
position, move no tokens.**

- Conservation is untouched, because nothing moves:
  `vault + Σ in_orca == Σ(free + locked)` is invariant across every long
  operation, asserted in `tests/position-long.ts`.
- The debt is **binding, not notional**: the component-03 withdraw gate already
  refuses to let free USDC drop below `premium_owed_usdc`, so the user cannot
  walk away with the money they owe.
- It is **not payment**. Shorts are owed and unpaid until component 08 settles.

The alternative — refusing to close a long while `payable > 0` — was rejected:
at the demo rate any long older than ~40 seconds would become unclosable, making
the demo path effectively one-way.

### Consequences

- **Positive**: longs are fully usable now; the liability is visible on-chain
  and enforced at the only place it could leak (withdraw).
- **Negative**: `premium_owed_usdc` accumulates with no way to discharge it
  until 08. A user who closes several longs will find that much USDC frozen.
- **Forward requirement**: component 08's `settle_premium` must *both* transfer
  the USDC into the range vault *and* clear `premium_owed_usdc`. Clearing it
  without transferring would silently forgive real debt.

---

## Addendum — 2026-09-19: settlement moves cash (component 08)

### Context

The previous addendum left a forward requirement in plain terms: component 08
must *both* transfer the USDC and clear the liability, because clearing without
transferring forgives real debt. This records how that was met, and the one
scope line that was deliberately not crossed.

### Decision

**Every liability decrement lives in the same function body as its transfer.**
There is no instruction that reduces `premium_owed_usdc`, `premium_receivable`
or `RangePremiumState.receivable` without an adjacent `spl_transfer`, and no
admin path that moves user funds. Three places settle premium — `settle_premium`
(long), `settle_premium` (short), and each burn leg — and all three are written
the same way for the same reason.

- **Long**: `debit_usdc` → `spl_transfer(vault_b → range_vault)` →
  `premium_pool +=` → `premium_owed_usdc -= min(owed, payable)`. The clear is
  never larger than the transfer, so every unit forgiven is a unit that moved.
- **Short**: `spl_transfer(range_vault → vault_b)` → `credit_usdc` →
  `premium_pool -=`, capped by what the pool holds.
- **Nothing in 08 ever increases `premium_owed_usdc`.** A closing long pays;
  it does not park. The field survives only to discharge debts recorded by
  component 06, which is why settle pays it down rather than ignoring it.

**The escrow is a PERMA PDA**, `["range_vault", market, lower_le, upper_le]`,
with mint `token_mint_b` and owner `market_authority` — created by hand
(`create_account` + `InitializeAccount3`) because `anchor-spl` is absent by
ADR-0001. It is **not** `ATA(market_authority, token_mint_b)`, which *is*
`Market.vault_b`. An early prototype derived exactly that; the measurement gave
it away by growing the transaction 1 byte instead of 32. Had it shipped, premium
escrow and collateral would have shared one account and neither
`range_vault.amount == premium_pool + dust` nor
`vault + Σ in_orca == Σ(free + locked)` could have been checked at all.

**A short that exits before any long has paid is not forfeited.** It carries the
shortfall on `PermaPosition.premium_receivable`, ends in the new
`position_status::PENDING_PREMIUM` rather than `Closed`, and keeps its account —
and its rent — until a later `settle_premium` clears the balance and closes it.
This is option 2b made real; vector V5 is an integration test, not a comment.

**An underwater long cannot close.** `debit_usdc` refuses to raid `locked_b`,
which backs someone else's Orca liquidity, so the burn fails with
`InsufficientCollateralForLoss` and the position stays `Open` with its debt
intact. The Fair MVP has no liquidation (`PRD.md` §A2), so such a long is stuck
until its owner deposits more USDC. The alternative — close anyway and park a
shortfall — is precisely the state this component exists to remove.

**Rounding was not touched.** `payable_from` still floors with carry, which is
what makes the permissionless crank safe: settling twice costs a long exactly
what settling once would, asserted to the µUSDC in `tests/settle-premium.ts`.

### Consequences

- **Positive**: the zero-sum invariant is now backed by tokens. Both identities
  are reconciled over RPC from outside the program after every settle path.
- **Negative**: short mint carries one more account (76 bytes of headroom left),
  and an unpayable long is stuck until a deposit (09's margin bounds how far underwater it can start, not whether it can get there).
- **Out of scope, explicitly**: P&L. `08-burn-settle.md` §E applies
  `risk::calculate_pnl`, which does not exist and cannot be invented without the
  valuation component 09 still has not defined. **P&L is 0 on every burn path**
  and the spec is marked deferred rather than silently skipped.
