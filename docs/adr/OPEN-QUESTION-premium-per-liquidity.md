# Open question: premium and margin are priced per unit of L, not per dollar

> Prototype. Not audited. Single pool. Not production mainnet risk capital.

| Field | Value |
|---|---|
| Status | **Answered:** [ADR-0006, value-based premium](ADR-0006-value-based-premium.md) (Accepted 2026-09-26, built on branch `p5`). Premium and margin are now priced on notional `L·v`. |
| Raised | 2026-09-26, while building the SOL/USDC trade ticket |
| Code | `programs/perma/src/risk.rs` (`required_margin`), `premium.rs`; mirrored in `apps/web/src/lib/solvency.ts` |

## What the program does today

A long pays premium on its liquidity `L`, the raw Orca Whirlpool unit:

- premium per slot = `premium_rate × L × premium_multiplier / 1e12` µUSDC
- required margin = `ceil(horizon × rate × L × mult / 1e12) + buffer`

At the deployed defaults (`rate = 1_000_000`, `mult = 1_000`, `horizon = 1_000` slots, `buffer = 1 USDC`), this simplifies to:
- **premium = L / 1000 µUSDC per slot**, about `L × 9e-6` USDC per hour at 9,000 slots/hour
- **margin = L µUSDC + 1 USDC**

Neither number depends on the range's price or width, or on what `L` is worth in tokens.

## What that costs in SOL terms

Here is how much `L` a given amount of SOL buys, at the Solana-devnet spot of 115.81 USDC/SOL (tick −21560), for ranges that sit just above spot and hold only SOL:

| Range | L per 1 SOL | Long of 0.001 SOL: premium/h, margin | Long of 1 SOL: premium/h, margin |
|---|---|---|---|
| 128 ticks, 116.54–118.05 | 5.35e10 | **481.6 USDC/h**, 54.5 USDC | **481,600 USDC/h**, 53,520 USDC |
| ~1,056 ticks | 6.47e9 | 58.2 USDC/h, 7.5 USDC | 58,230 USDC/h, 6,471 USDC |
| 2,048 ticks | 3.33e9 | 30.0 USDC/h, 4.3 USDC | 29,990 USDC/h, 3,334 USDC |

Take the position the web brief used as its example: L = 100,000 on 116.54–118.05. It is worth about 0.0000019 SOL (≈ $0.0002), yet it pays about 0.9 USDC/hour and needs 1.1 USDC of margin.

## Why narrow ranges make it extreme

In concentrated liquidity, the tokens behind one unit of `L` scale with how far the price range reaches:
- a range entirely above spot holds `L × (1/√P_low − 1/√P_high)` SOL
- a range entirely below spot holds `L × (√P_high − √P_low)` USDC

A narrow range therefore holds very few tokens per unit of `L`. So the same dollar amount becomes a much larger `L`, and a much larger premium. Going from 2,048 ticks to 128 ticks raises the `L` per SOL about 16×, and with it the premium and margin for the same SOL-sized long.

## Questions for the ADR
1. Should premium be priced on the notional the long tracks (its token value at spot, or at the range midpoint), rather than on raw `L`?
2. If it stays per-`L`, should `premium_rate` scale with the range width so that equal notionals pay equal premium?
3. Who sets the rate, and how can it change? Fair MVP has no setter for `premium_rate` or `premium_multiplier`, so any change is a program or market re-creation decision.
4. How does this interact with the short side? Shorts are paid from the same per-`L` stream, so a fix must keep the premium conservation checks in ADR-0002.

Until this is decided, the web ticket shows the real numbers: premium per hour is the headline figure, next to a "Max you can open" limit from free USDC. The ticket does not hide or rescale them.
