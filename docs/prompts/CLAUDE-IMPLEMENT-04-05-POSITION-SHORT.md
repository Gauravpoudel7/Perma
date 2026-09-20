# PERMA — Claude Code Prompt: Components 04+05 — Position Engine + Short Mint

**How to use:** New Claude Code chat in `Perma/` repo root. Paste `PROMPT` → `END PROMPT`, then the one-liner.

**Next step after 03:** PRD §A11 says: adapter → market+collateral → **short mint (real CPI)** → long mint → premium → solvency → UI.

Docs call these **04 Position Engine** + **05 Short Mint**. Implement them together as one product slice: **user deposits → locks → opens a short that really adds Orca liquidity → closes/burns short and unlocks**.

**Do not** implement full premium engine (07), burn premium settle (08), or full solvency (09) in this session. Long mint (06) only if Phase 0 says inventory can ship without 07 — default **defer long mint**.

---

````text
PROMPT
=====

# Role

You are a senior Solana / Anchor engineer implementing **PERMA Fair MVP components 04 + 05**: Position Engine (1-leg) orchestration and **Short Mint** end-to-end.

Fresh chat. Extend the live program. Do not rewrite adapter/factory/collateral. Keep all prior suites green (update helpers only).

# Product lock

- Fair MVP, one allowlisted WSOL/devUSDC Whirlpool, 1-leg
- Banner: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Authority: `PRD.md` Part A (A5, A11), `04-position-engine-1leg.md`, `05-short-mint.md`
- Related (read, mostly defer): `06-long-mint-inventory.md`, `07-premium-engine.md`, `08-burn-settle.md`, `09-risk-solvency.md`
- Stack: `anchor-lang` 1.2.0, `orca_whirlpools_client` 8.0.0 (no `anchor` feature), **`anchor build --arch v0`**
- Pool: `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (tick_spacing 8)

# Already shipped (reuse)

| Piece | Location |
|---|---|
| Orca adapter CPIs + 3-step close | `adapter.rs`, `adapter_*` ix in `lib.rs` |
| GlobalConfig + create_market | `factory.rs` |
| UserCollateral deposit/withdraw/lock/unlock | `collateral.rs` |
| `UserCollateral.open_positions` gate on unlock | set only by mint/burn in **this** session |
| `PermaPosition` (short↔Orca 1:1) | `state.rs` — seeds `[perma_position, market, owner, nonce]` |
| Harness: open/add/remove/close as separate adapter ix | works but is **not** the user product path |

**03 residual you must close:** mint must increment `open_positions`; burn must decrement; unlock stays blocked while &gt; 0.

**03 residual on conservation:** track current Orca exposure properly on short add/remove (fix `deposited_*` over-count on partial remove — use `liquidity` + observed vault deltas or dedicated `in_orca_a/b` current fields).

---

# PHASE 0 — FEASIBILITY (mandatory)

Write `docs/audits/IMPL-04-05-FEASIBILITY.md` with GO / GO WITH BLOCKERS / NO-GO.

## Q1 — One user instruction vs many adapter harness ix

Product path should be something like:

- `mint_options` / `mint_position` (SHORT): validate → compute required amounts → **lock** → open Orca position (if needed) → increase liquidity → init/update `PermaPosition` → `open_positions += 1`
- `burn_options` / `burn_position` (SHORT, Fair MVP without premium): decrease→collect→close (3-step) → **unlock** observed amounts → `open_positions -= 1` → close or zero position account

Decide: keep low-level `adapter_*` for tests **or** make them `#[cfg]` / document as harness-only. Prefer keeping them for regression but route product tests through mint/burn.

## Q2 — PDA / account model

Spec `04` wants `PDA(["position", market, owner, position_id])` with `leg_type`, premium fields, `PendingPremium`.

Live code has `PermaPosition` with Orca fields + `nonce`.

**Decision required:**

- **Recommended:** Evolve `PermaPosition` in place: add `leg_type` (Short=0 for now), optional premium fields zeroed until 07, keep Orca 1:1 fields, keep nonce seeds (or rename seed constant but don’t break derivable addresses without migration plan). Document seed deviation from spec in ADR/report (like 02 did for allowlist).
- Reject inventing a second parallel Position account for shorts.

## Q3 — Required assets for lock before CPI

Short mint must lock WSOL/USDC **before** `increase_liquidity_v2`. Options:

- Client passes `token_max_a/b` and program locks those maxes, then CPI with same maxes; refund unused to free (or leave locked until burn) — define clearly
- Program quotes from Whirlpool math (risky/heavy on-chain)

**Recommended:** user/client supplies `liquidity` + `token_max_a` + `token_min_*` slippage guards; program locks `token_max_*` from free balances; CPI uses those maxes; after CPI, unlock unused (`max - observed_spent`) back to free; keep `observed_spent` locked for the life of the short.

## Q4 — Long mint in this session?

Full long mint needs `RangePremiumState`, index poke ordering, premium checkpoints (06/07/08).

**Default: OUT OF SCOPE.** If you include anything, only a **compile-disabled stub** or inventory PDA skeleton with no user long mint ix. Do not ship a fake long that skips inventory.

## Q5 — Burn without premium engine

Full burn settles premium first (08). Without 07/08:

- Short burn = adapter full close + unlock locked collateral matching remaining obligation + clear position
- No `PendingPremium` path until 08
- Document that burn will later call `settle_premium` first

## Q6 — Tx size / CU

01B measured open/add/remove/close as separate ix with headroom. Mint may need **two transactions** (open_position prior, then mint add) — same as 01B. Measure; don’t force one tx if it won’t fit.

## Q7 — Risk on mint

No numeric margin in 09. Short mint solvency = sufficient free balance to lock maxes. Do not invent margin %. `InsolventMint` only if you define a real check; else use `InsufficientFunds`.

End Phase 0 with explicit in/out list.

---

# PHASE 1 — IMPLEMENT

## Target user flows (must demo in tests)

1. `initialize_global_config` → `create_market` → `deposit_collateral` → **`mint_position` SHORT** → Orca liquidity up, `locked_*` up, `open_positions == 1`
2. **`burn_position` SHORT** → Orca position gone, locked released to free (or withdrawn path), `open_positions == 0`
3. Cannot `unlock_collateral` while short open
4. Cannot mint short with insufficient free balance
5. Prior suites still green

## Instructions to add

### `mint_position` / `mint_options` (name per INSTRUCTIONS.md — pick one canonical, update docs if needed)

Params: `leg_type` (only Short accepted), `tick_lower`, `tick_upper`, `liquidity`, `token_max_a`, `token_max_b`, `token_min_a`, `token_min_b`, `nonce`

Behavior for Short:

1. Pause check; validate ticks via existing adapter helpers
2. Lock `token_max_a/b` (internal call, not separate user unlock path)
3. Ensure Orca position exists (CPI open if new nonce) — may be prior ix in tests
4. `increase_liquidity_v2`; record **observed** vault deltas
5. Unlock unused max−spent to free; keep spent in locked
6. Write `PermaPosition` (liquidity, deposited current fields fixed properly)
7. `user.open_positions = open_positions.saturating_add(1)`
8. Emit `PositionMinted` / `ShortMinted`

### `burn_position` / `burn_options` (Short only this session)

1. Owner check; status open
2. Full remove close_after path + `adapter_close_position` (same tx if fits, else documented two-ix client pattern with program supporting both)
3. Unlock remaining locked amounts attributable to this position (define attribution: store `locked_a/b` on position at mint)
4. `open_positions -= 1`
5. Close `PermaPosition` account / mark closed
6. Emit `PositionBurned` (pnl/premium = 0 for now, or omit fields)

**Store per-position locked amounts** at mint time so burn unlocks the right totals under multiple shorts.

## Module layout

```text
programs/perma/src/position.rs  # NEW — mint/burn orchestration
# wire in lib.rs
# touch collateral.rs only for open_positions helpers if needed
# adapter.rs unchanged except tiny hooks if required
```

## Tests

New `tests/position-short.ts` (name flexible):

1. End-to-end short mint via deposit → mint_position
2. Burn short restores free collateral (net of Orca PnL/fees as observed — be honest about fee dust)
3. Unlock while open → `PositionsOutstanding`
4. Insufficient funds mint fails
5. Second short (different nonce) works; open_positions == 2; burn one → == 1
6. Optional: partial remove still via harness if mint doesn’t expose partial yet

Regression: unit, collateral, factory, factory-rewards, adapter, adapter-liquidity.

Prefer migrating adapter-liquidity toward mint/burn **or** keep harness and add product-path suite — don’t delete CPI proof.

## Docs

- `IMPL-04-05-FEASIBILITY.md`, `IMPL-04-05-POSITION-SHORT-REPORT.md`
- Tick done boxes on 04/05 that are truly done; note long/premium deferred
- README run instructions
- ADR only if seeds/leg model deviate from spec

## Out of scope

- Long mint / inventory / RangePremiumState accrual (06+)
- Premium index, settle_premium, PendingPremium funding (07/08)
- Full solvency / liquidation (09/10)
- Next.js UI
- Enabling `orca_whirlpools_client` `anchor` feature

# Process

Phase 0 → implement mint/burn short → tests → report → **STOP** (no 06/07).

# Done when

- [ ] User-facing short mint locks collateral and adds real Orca liquidity in one product flow
- [ ] Short burn closes Orca via 3-step and unlocks
- [ ] `open_positions` increments/decrements correctly
- [ ] Exposure/locked attribution doesn’t break multi-short or partial-remove accounting
- [ ] Prior suites green
- [ ] Reports written

# Start now

Phase 0 first.

END PROMPT
````

## One-liner

```text
Repo is PERMA. 01–03 done. Next per PRD A11: implement components 04+05 ONLY — Position Engine short path + Short Mint (deposit→lock→real Orca add→burn/close→unlock). Increment open_positions. Defer long mint and premium engine. Phase 0 first → IMPL-04-05-FEASIBILITY.md then IMPL-04-05-POSITION-SHORT-REPORT.md. Keep --arch v0 and all prior suites green.
```
