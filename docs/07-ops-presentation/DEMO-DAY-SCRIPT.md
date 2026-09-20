# PERMA — Demo Day Spoken Script (~1.5–2 minutes)

**Tone:** calm, clear, no jargon walls. Practice once out loud; aim for **~180–220 words** (~1:30–1:45).  
**Prop:** terminal or explorer ready — deposit → mint short → burn short (or a recorded take if live RPC is flaky).

---

## Script (speak this)

Hi — we’re building **PERMA**.

Most crypto options die on a Friday. You pick a date, and when that date hits, the option is gone. PERMA is different: it’s a **perpetual option** on Solana. You can hold as long as you want, and instead of a one-time premium, you pay a small fee over time.

Here’s the special part. We don’t invent a fake options pool. We use **Orca**, a real Solana exchange with concentrated liquidity. When I open a **short**, PERMA locks my collateral and **adds real liquidity** into an Orca price range. So my trade also helps the pool. When someone later goes **long**, they use that inventory and pay the streaming fee. Shorts earn; longs pay.

For the hackathon we’re shipping a **Fair MVP**: one allowlisted SOL/USDC pool, one-leg positions, fully tested before we show it. Today you can see the whole loop live — deposit, open a short that hits Orca on-chain, open a long against it, watch premium move as real USDC into an on-chain escrow, and close both cleanly. Solvency margin is next on the build list; the spec and its ADR are already written.

Why this matters: Solana has options vaults and order books, but nothing like Panoptic’s “options from LP ranges” is live here yet. That gap is our lane.

Quick safety note: this is a **prototype**, not audited, single pool — not for real risk capital.

Thanks — happy to show the transaction and take questions.

---

## Timing guide

| Part | ~Seconds |
|------|----------|
| What is PERMA / no Friday expiry | 25 |
| Orca short = real liquidity | 35 |
| MVP scope + what demo shows | 25 |
| Market gap vs Solana / Panoptic | 20 |
| Safety + close | 15 |
| **Total** | **~2:00** (trim market line to hit 1:30) |

## If you only have 90 seconds

Cut the “Why this matters” paragraph. End after “Solvency margin is next” + safety line.

## Demo click path (while you talk, or right after)

1. Show allowlisted market / program ID  
2. Deposit collateral  
3. `mint_position` short → show Orca liquidity / explorer CPI  
4. `burn_position` → position closed, collateral back  

Say while clicking: “This isn’t a mock — that CPI is Orca’s real increase-liquidity.”

## Backup if live demo fails

Open `docs/audits/IMPL-08-BURN-SETTLE-REPORT.md` or a saved explorer link / test output: “66 integration + 54 unit tests green on a real cloned Whirlpool; both money identities reconciled to zero from outside the program.”
