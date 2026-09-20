# PERMA — Claude Code Prompt: Component 01B — Fund Vaults + Execute Liquidity CPI + Regressions

**How to use:** New Claude Code chat in repo root `Perma/`. Paste PROMPT → END PROMPT, then the one-liner.  
Do **not** start components 02–11.

---

````text
PROMPT
=====

# Role

You are a senior Solana / Anchor test engineer closing the **only open gap** in PERMA Fair MVP component 01 (CLMM Adapter).

Component 01 already compiles, deploys, and passes validation tests against a real cloned Orca Whirlpool. **Liquidity-moving CPI is implemented but has never successfully moved tokens.** Your job is to fund fixtures, execute real add/remove/collect/close against Orca, run the two mandatory regression guards, and update the impl report.

Fresh chat. Inspect the repo. Do not reinvent the adapter.

# Product / scope lock

- Repo: PERMA (`Gauravpoudel7/Perma` or local clone)
- Only component **01B** (fixture + liquidity CPI proof). No 02–11, no Next.js, no indexer.
- Status: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Authority: `docs/02-mvp-components/01-clmm-adapter-orca.md`, `docs/adr/ADR-0001-orca-cpi-instruction-surface.md`, `docs/audits/IMPL-01-CLMM-ADAPTER-REPORT.md` §5, `docs/audits/IMPL-01-FEASIBILITY.md`

# Already true (re-verify, do not discard)

| Item | Value |
|---|---|
| Stack | `anchor-lang` **1.2.0**, `orca_whirlpools_client` **8.0.0** (no client `anchor` feature), Agave ~4.1.x, `anchor build --arch v0` **mandatory** |
| Program (local last deploy may differ) | see `Anchor.toml` / `declare_id!` |
| Allowlisted Whirlpool | `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` |
| Pair | WSOL (9 dp) / Orca **devUSDC** (6 dp) mint `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k` |
| `tick_spacing` | **8** (`ticks_in_array = 704`) — not 64 |
| Demo range | ticks `[-40176, -38168]` → arrays `-40832` / `-38720` |
| Narrow range | `[-39184, -39104]` → shared `-39424` |
| Tests today | 8/8 unit, 12/12 integration **validation only** |
| Gap | §5 of IMPL-01 report: no funded PERMA vaults → no real `increase_liquidity_v2` / 3-step close executed; `0x1775` and `0x177c` regressions **not run** |
| Close sequence | **exactly** `decrease_liquidity_v2` → `collect_fees_v2` → `close_position` (never insert `update_fees_and_rewards` between decrease and collect) |

# Mission

1. **Phase 0 (short):** Confirm toolchain, `--arch v0`, pool clones in `Anchor.toml`, and that `adapter_add_liquidity` / `adapter_remove_liquidity` still match the client account metas. Write 10 lines into `docs/audits/IMPL-01B-FEASIBILITY.md` with GO / NO-GO. If NO-GO, stop.
2. **Fund fixtures** so PERMA vault ATAs owned by `market_authority` hold enough WSOL + devUSDC to open a small short liquidity position on the allowlisted pool.
3. **Open Orca position** for the demo range; NFT ATA owned by `market_authority` (1:1 per ADR-0001).
4. **Execute real CPI path:**
   - `adapter_add_liquidity` → assert Orca position liquidity increased; PERMA vault balances decreased by **observed** amounts; `LiquidityAdded` event
   - Partial `adapter_remove_liquidity` (no close) → liquidity halved (or known fraction)
   - Full close 3-step via `adapter_remove_liquidity(..., close_after=true)` → position closed, rent reclaimed, `LiquidityRemoved`
5. **Mandatory regressions (must actually fail as specified):**
   - After full decrease, skip `collect_fees_v2` and attempt `close_position` → expect Orca `ClosePositionNotEmpty` **`0x1775`**
   - After full `decrease_liquidity_v2`, call `update_fees_and_rewards` → expect Orca `LiquidityZero` **`0x177c`**
6. Keep existing 8 unit + 12 validation tests green.
7. Update `docs/audits/IMPL-01-CLMM-ADAPTER-REPORT.md` (or add `IMPL-01B-LIQUIDITY-CPI-REPORT.md`) with new test table and fixture method.
8. Stop. Do not start component 02.

# Hard constraints

## Funding strategy (devUSDC cannot be minted locally)

You do **not** hold mint authority for Orca devUSDC. Prefer the path already named in the impl report:

1. Precompute every deterministic address: `market` PDA, `market_authority` PDA, PERMA vault ATAs (authority = `market_authority`), position mint / position / position ATA, TickArrays (already cloned).
2. On **devnet**, obtain funded token accounts (or clone rich accounts) whose **data** you can capture.
3. Inject into local validator via `solana-test-validator --account <pubkey> <file.json>` and/or Anchor.toml `[[test.validator.account]]` entries — **or** clone additional funded ATAs from devnet if they are the exact PDA/ATA addresses you will use.
4. For WSOL: wrapping SOL into the PERMA WSOL ATA is fine if simpler than account injection.
5. Do **not** write a mock Whirlpool program. Real program ID `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` only.
6. Do **not** paper over failures by skipping CPI. If funding is impossible, document NO-GO with exact blocker — do not claim green.

Alternative acceptable only if injection fails after a serious attempt: clone a **devnet funded ATA you control** that you create in a one-time setup script using a wallet that already holds devUSDC on devnet (airdrop/wrap WSOL; acquire devUSDC via Orca swap on devnet), then clone those ATAs — but final PERMA vaults must still be the PDAs/ATAs the program expects (`market_authority`-owned). Prefer transferring into the real vault ATAs inside the test after cloning a “donor” ATA if needed.

## Code rules

- Keep `anchor build --arch v0`.
- Do not enable `orca_whirlpools_client`’s `anchor` feature.
- `CollectFeesV2` account order stays separate from ModifyLiquidityV2.
- TickArray seeds remain `start_tick_index.to_string()`; spacing from live market (=8).
- Observed vault deltas only.
- If `create_market` still uses Orca vaults as PERMA vault placeholders, **fix that for liquidity tests**: introduce real PERMA vault ATAs owned by `market_authority` (minimal change; full Collateral Manager is still component 03 — only what’s required to fund and CPI).
- `open_position` / `initialize_tick_array` may remain prior transactions if tx size is tight (~80 bytes headroom was estimated).

## Tests to add (names suggestive)

In `tests/adapter.ts` (or `tests/adapter-liquidity.ts`):

1. `liquidity: add increases orca position and decreases perma vaults`
2. `liquidity: partial remove`
3. `liquidity: full close 3-step succeeds`
4. `regression: close without collect_fees → 0x1775`
5. `regression: update_fees_and_rewards after full decrease → 0x177c`
6. Optional: slippage / token max exceeded if cheap

All must run under the same validator clone set (+ any new `--account` fixtures). Document how to regenerate fixtures.

# Out of scope

- Components 02–11 product logic
- Next.js / indexer
- Changing allowlisted pool unless current pool is dead (liquidity zero) — if so, re-run factory §A and update fixtures
- Demand-based premium, Raydium, mainnet risk capital
- Rewriting docs pack (only touch fixtures, RELEASE-GATE clone list if needed, and the 01B report)

# Process

1. Read IMPL-01 report §5 + adapter.rs + lib.rs instructions + tests/adapter.ts + Anchor.toml clones.
2. Phase 0 feasibility note (short).
3. Design funding plan; precompute addresses; implement fixtures.
4. Implement/adjust harness only as needed for real vaults + open_position prior tx.
5. Add liquidity tests + both regressions.
6. Run: unit 8/8, validation 12/12, **new liquidity suite all green**.
7. Write `docs/audits/IMPL-01B-LIQUIDITY-CPI-REPORT.md` with: funding method, addresses, test table, CU/tx-size notes, residuals.
8. Update README “Running the CLMM adapter tests” if commands changed.
9. Console summary → **stop**.

# Done when

- At least one successful `increase_liquidity_v2` CPI landed on the cloned Whirlpool
- Partial remove and full 3-step close proven
- `0x1775` and `0x177c` regressions **executed** and assert the expected Orca errors
- Prior 8+12 tests still pass
- Report written; no mock Whirlpool

# Start now

Inspect → Phase 0 → fund fixtures → execute CPI → regressions → report → stop.

END PROMPT
````

## One-liner

```text
Repo is PERMA. Component 01 validation is green; liquidity CPI is the open gap. Run Phase 0 briefly, then fund market_authority vault ATAs (devUSDC via account injection/clone — no fake Whirlpool), execute real increase → partial decrease → 3-step close on pool 2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G (tick_spacing=8), and run regressions 0x1775 and 0x177c. Keep --arch v0 and anchor-lang 1.2.0. Write docs/audits/IMPL-01B-LIQUIDITY-CPI-REPORT.md. No components 02–11.
```
