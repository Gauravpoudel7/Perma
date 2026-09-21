# P1 — Commission: deferred, deliberately

**Date:** 2026-09-21
**Scope authority:** [`ROADMAP.md`](../09-post-mvp/ROADMAP.md) P1 — Production Hardening
**Status:** Deferred. Not started, not partially built, not stubbed.

> **🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## The exit criterion

P1's exit criteria include: *"commission is either parameterized or explicitly
deferred."* This document is the explicit deferral. Nothing in the program, the
IDL, the UI or the copy references a commission today, and nothing in P1 added
one.

## Why deferred rather than parameterized

**The trade loop is complete without it.** A short earns premium pro-rata by
liquidity and time; a long pays it; `range_vault.amount == premium_pool + dust`
holds throughout. Inserting an opening commission changes none of that
mechanism — it only skims from one side of a transfer that already works. There
is no dependency in Fair, or in P1's hardening work, that is blocked on it.

**Parameterizing it means inventing numbers.** A commission needs a rate, and a
rate needs a basis: what an opening commission should be in bps, whether it
scales with size or with range width, whether it is taken from the long's
premium or charged separately, where it accrues, and who may withdraw it. None
of those are answered by any document in this repo.
[`NON-GOALS.md`](../09-post-mvp/NON-GOALS.md) forbids inventing APY, bps or yield
figures, and shipping `commission_bps: u64` with a placeholder value would be
exactly that — the placeholder becomes the number people quote.

**It has a custody question attached.** A commission implies an account that
accumulates protocol revenue and an authority that can withdraw it. P1
deliberately declined to create a protocol-fee PDA even for the µUSDC residue
swept by `unwind_empty_range` (the residue goes to an admin-owned token account
instead; see the [ADR-0002](../adr/ADR-0002-premium-accounting.md) addendum of
2026-09-21). Adding a revenue stream would force that decision under time
pressure rather than under an ADR.

## Where the requirement lives

Commission remains a **complete-product** requirement, not a dropped one:

- [`PRD.md`](../../PRD.md) §B18 — commission on position opening.
- [`COMPLETE-PRODUCT-DEFINITION.md`](../09-post-mvp/COMPLETE-PRODUCT-DEFINITION.md):55.

## Conditions to revisit

Write an ADR first. It must pin, at minimum:

1. **Rate and basis** — bps of what, with the reasoning for the figure, not a round number chosen because it looks reasonable.
2. **Collection point** — mint-time charge, or a skim inside `settle_premium`. These have different failure modes: the first can make a mint fail for want of a few µUSDC; the second breaks the zero-sum invariant this protocol currently advertises.
3. **Destination and authority** — a protocol fee account (PDA or otherwise), who may withdraw, and how that interacts with the "no admin path moves user funds" property that [`SECURITY-BASELINE.md`](../05-engineering/SECURITY-BASELINE.md) §4 states today.
4. **Layout impact** — `Market` has no spare field for a rate. Adding one is an account resize, which Fair and P1 both refused.
5. **Copy consequences** — the UI would have to state the fee at the point of trade, which is a copy-gate change (`yarn check-copy`).

Until that ADR exists, PERMA takes no cut. That is a statement the code
currently backs: the only path by which the protocol receives any premium is
`unwind_empty_range`, and it only moves rounding residue out of a range that
every position has already left.
