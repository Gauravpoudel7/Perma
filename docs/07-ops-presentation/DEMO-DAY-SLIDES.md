# PERMA — Demo Day Slides (6 slides)

**How to use:** Copy each slide into Google Slides / Keynote. Keep text large; one idea per slide.  
**Status line on every slide footer:** Prototype · Not audited · Single pool · Not production risk capital

---

## Slide 1 — Title

# PERMA
### Perpetual options powered by Solana liquidity

Fair MVP · Colosseum / Superteam Buildstation  
Built on **Orca Whirlpools**

*Options that don’t expire — backed by real pool liquidity*

---

## Slide 2 — What we’re building

### The problem
- Normal crypto options **expire** (Friday cliff)
- Solana has options vaults & order books — **not** perpetual options from concentrated LP
- Ethereum has **Panoptic**; Solana still has a gap

### Our product
**PERMA** = perpetual options on Solana  
When you **short**, you **add real liquidity** to an Orca pool  
When you **long** (next), you use that inventory and pay a streaming fee over time

**One line:** Options without expiry, powered by Orca ranges — not a separate fake market.

---

## Slide 3 — How it works (simple)

```
Deposit collateral
    → Open SHORT  (lock funds + add liquidity on Orca)
    → Hold / market moves
    → Close SHORT (remove liquidity + unlock)
```

**Coming next on the MVP path:** solvency (component 09, spec'd) → thin UI

**Under the hood (already real):**
- Solana program talks to Orca via CPI (real accounts & ticks)
- Admin allowlisted single SOL/USDC pool
- User collateral vaults + product `mint` / `burn` for shorts

---

## Slide 4 — Where we are right now

| Layer | Status |
|--------|--------|
| Specs & audits | Done (READY) |
| Orca adapter (real liquidity CPI) | **Shipped** |
| Market factory (allowlist) | **Shipped** |
| Collateral deposit / withdraw / lock | **Shipped** |
| Short open / close (product path) | **Shipped** |
| Long mint + premium settle (cash, on-chain escrow) | **Shipped** |
| Solvency (long margin) | Spec’d · next |
| Demo UI | Thin / next |

**Today’s demo:** create market → deposit → **open a short on Orca** → close it → show explorer / tests green

**Honest:** Fair MVP prototype — one pool, short path live, longs/premium next.

---

## Slide 5 — Market & why it matters

### Demand
- Traders want **ongoing** hedges, not only weekly expiry
- LPs already sit in Orca ranges — PERMA turns that shape into an options primitive
- Agents / DeFi users need hard risk controls without leveraged-perp blowups

### Competition (honest)
| On Solana today | What it is | vs PERMA |
|-----------------|------------|----------|
| Dual, Chest, DOVs | Weekly vault options | Different machine |
| Manifest / Dual CLOB | Order-book options | Not CLMM-native |
| Zeta / OptiFi | Wound down / dead | — |
| **Panoptic** | Same idea | **Ethereum only** |

**Gap we fill:** No live Solana protocol yet that turns Orca/Raydium ranges into perpetual long/short options with streaming premium.

---

## Slide 6 — Ask / next & safety

### Fair MVP finish line
1. ~~Long mint (inventory gate)~~ shipped  
2. ~~Streaming premium settle~~ shipped  
3. Solvency checks  
4. Thin Trade / Portfolio UI  
5. Release gate green → pitch

### North star (after Fair)
Multi-leg, more pools, stronger risk — still independent of Panoptic code (BUSL)

### Safety (say out loud)
**Prototype. Not audited. Single pool. Do not put real money at risk.**

### One closer
We’re not wrapping options on a spreadsheet — when we short, **Orca’s pool actually moves**.

---
