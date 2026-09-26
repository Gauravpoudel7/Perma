# PERMA — Claude Code Prompt: P3-DEVNET-POOL-PRICE (Option A rebalance)

> **Status (2026-09-25): executed and closed.** Option A worked: the pool `2WUg…` was swapped to Pyth SOL/USD (~$117), the devnet program was upgraded to P3 (ELF 604,992 B, slot 502908043), and `yarn smoke-devnet-p3 --smoke` is green. The "pre-P3" and "do not upgrade" lines below are now history. To keep the pool in band, use the re-tighten steps in `docs/audits/P3-DEVNET-POOL-PRICE.md` and `docs/06-testing/RELEASE-GATE.md` §5.1. Do not re-run this prompt.

**How to use:** New Claude Code chat in the repo root (`/Users/maxcell/perma/Perma`). Paste everything between `PROMPT` and `END PROMPT`, then the one-liner at the bottom.

**Plugins / wrap:**
- **Ponytail / caveman OFF** (or at most `/caveman lite` for Phase 0 notes). Never combine Headroom wrap with a caveman proxy wrap.
- If the PERMA indexer is on **8787**, use `headroom wrap claude --port 8788` (or move indexer to **8799** long-term). Headroom does **not** fix Claude Pro auth.
- Prefer careful literal engineering. No frontend-design skill required (ops/scripts/docs).

**Why this session exists:**  
Localnet **P3** (ADR-0004) is shipped on `main`. Live **Solana-devnet program stays pre-P3** because allowlisted pool `2WUg…` spots near **~$20** practice USDC/SOL while real Pyth **SOL/USD** is ~mainnet dollars. After a P3 upgrade every mint fails `OracleDeviationTooHigh` (2% band). This ticket closes the **pool-price blocker** via **Option A — rebalance the current pool**. It does **not** widen the band and does **not** deploy mock Pyth to Solana-devnet.

**Honesty banner (repeat in feasibility + report):**  
`Prototype. Not audited. Single pool. Not production mainnet risk capital.`

---

````text
PROMPT
=====

# Role

You are a senior Solana ops / protocol engineer executing **PERMA ticket P3-DEVNET-POOL-PRICE — Option A (rebalance current allowlisted Whirlpool on public Solana-devnet)**.

Fresh chat. Work in `/Users/maxcell/perma/Perma` on the current `main`. Prefer **scripts + docs + measurements**. Do **not** rewrite Fair premium/Orca CPI/risk math. Do **not** upgrade the live Solana-devnet program in this session unless Phase A is proven green **and** the human explicitly types `GO UPGRADE` in chat (default = **no upgrade**).

# Product lock

- Banner: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Cluster: public **Solana-devnet** only for live swaps (`https://api.devnet.solana.com` or operator Helius Solana-devnet RPC). Not mainnet. Not localnet pool mutation.
- Allowlisted pool (do **not** change / do **not** create a new market unless Option A is proven impossible):  
  `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` — WSOL (9 dp) / **devUSDC** `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k` (6 dp), `tick_spacing = 8`
- Program id (verify): `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt` — live Solana-devnet binary is **pre-P3** until this ticket’s pool gate is closed
- Admin/CLI wallet (typical ops signer): `7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY`
- Phantom practice wallet (do not drain without warning): `EUqgmpDpC1vSMXjHxzhL7AzaS5qKaWFsMVtw7JrXvL38`
- ADR-0004: feed id SOL/USD `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`; `MAX_DEVIATION_BPS = 200` (2%); **devUSDC treated as USD 1:1** (demo assumption); mock receiver is **localnet-only**
- Authoritative ticket: `docs/audits/P3-DEVNET-POOL-PRICE.md`
- Prior P3 ship: `docs/audits/IMPL-P3-ORACLE-RISK-REPORT.md` §4.1; ADR `docs/adr/ADR-0004-oracle-and-price-aware-risk.md`

# Authority docs (read before any live swap)

1. `docs/audits/P3-DEVNET-POOL-PRICE.md` — Option A checklist; Option B fallback; out-of-scope C/D
2. `docs/adr/ADR-0004-oracle-and-price-aware-risk.md` — deviation math, feed id, mock = localnet only
3. `docs/audits/IMPL-P3-ORACLE-RISK-REPORT.md` — Solana-devnet blocker wording
4. `apps/web/src/lib/whirlpool.ts` — decode `sqrt_price` / tick → USDC/SOL (Spot only)
5. `scripts/init-devnet-market.mjs`, `scripts/measure*.mjs`, `scripts/mock-price.mjs` — patterns; **there is no rebalance script yet**
6. `docs/07-ops-presentation/RUNBOOK-DEVNET.md`, `DEVNET-UI-RESEARCH.md` — Solana-devnet ops honesty
7. `docs/06-testing/FIXTURES-AND-VECTORS.md` §6 — pool constants
8. Orca Whirlpool swap account metas from `orca_whirlpools_client` / Orca docs (CPI or SDK) — verify on disk, do not invent

# Hard constraints (blacklist)

- **Never** deploy / point Solana-devnet at the **localnet mock** Pyth receiver or mock feed PDA.
- **Never** widen `MAX_DEVIATION_BPS` / relax `OracleDeviationTooHigh` for ops convenience.
- **Never** mainnet deploys, mainnet swaps, or real Circle USDC claims. Practice SOL + **devUSDC** only.
- **Never** upgrade/redeploy the Solana-devnet PERMA program in this session unless human sends exact `GO UPGRADE` after Phase A proof.
- **Never** Option C (fake oracle) or Option D (widen band).
- Prefer **Option A**. Option B (new pool + new market + allowlist) only if Phase 0 proves A needs impractical capital or is mechanically impossible — then **STOP**, write the proof, and wait for human GO before touching factory allowlist.
- Do not break localnet (`scripts/local-validator.sh`, `mock-price.mjs --loop`).
- Do not silently close the human’s open practice positions; **warn first** (see Phase 0).
- Do not commit `.env.local`, keypairs, or RPC secrets.

# Research snapshot (HINTS ONLY — re-measure on your Mac; numbers drift)

Drafted 2026-09-23 NPT from Mac checkout + Solana-devnet RPC:

| Fact | Hint |
|---|---|
| Pool spot | tick **≈ -39141**, **≈ 19.96** USDC/SOL (spot currently **inside** demo short band 18–22 = ticks **-40176 / -38168**) |
| Pool liquidity (raw u128 at offset 49) | ≈ `4762722791665` (re-read; depth drives capital) |
| Orca vault balances (hint) | ≈ **108.7 WSOL** + ≈ **3984 devUSDC** in the Whirlpool vaults — re-read live |
| Capital ballpark to ~$150–200 | Raising spot means **devUSDC → WSOL**. Rough upper bound if much of vault SOL is bought through mid prices: **~9–11k+ practice USDC** (far above the ~4k already in-vault). Real need depends on LP outside 18–22 — **Phase 0 must quote/simulate**, not trust this hint. If play capital cannot reach ≤2%, **NO-GO Option A** and propose Option B |
| Pyth SOL/USD | Fetch live Hermes on **your** network (some sandboxes get 403). Feed id above. Target: `\|spot − pyth\| / pyth ≤ 0.02`. Devnet arb may drift price back — re-measure at the end |
| Direction to raise USDC/SOL from ~20 → ~pyth | Swap **devUSDC → WSOL** (buy SOL), in **steps**, re-measure each time. Target ticks roughly **-19k @ $150** / **-16k @ $200** (far above 18–22) |
| Repo gap | **No** rebalance/swap script; **no** `@orca-so/*` in root `package.json`. Create `scripts/rebalance-devnet-pool.mjs` (or pinned Orca SDK one-shot). Existing: `init-devnet-market.mjs`, `measure*.mjs`, `whirlpool.ts` decode only |
| Option B note | Factory allowlist appears to have **no setter** — a new pool path may need a carefully scoped admin/allowlist change; prefer proving A first |
| Web mint on Solana-devnet | Pre-P3 program; client omits `price_update` when `CLUSTER=devnet`. Do not flip Solana-devnet mint path to require oracle until upgrade follow-on |
| Open user positions (as of practice session) | Short **100000** + Long **10000** near **18–22**; optional Size-0 PENDING PREMIUM dust nearby. After rebalance, 18–22 sits **below** new spot (short LP goes one-sided / away-from-spot). Burns/settles still work (oracle-free). New near-spot longs need **new shorts** near the new tick |

Your Phase 0 live inventory overrides this table.

---

# PHASE 0 — FEASIBILITY (mandatory before live swaps)

Write `docs/audits/IMPL-P3-DEVNET-POOL-PRICE-FEASIBILITY.md` with **GO / GO WITH BLOCKERS / NO-GO**.

## Q0 — Live inventory (cite measurements)

1. Solana-devnet pool `sqrt_price`, `tick_current_index`, human **USDC/SOL** spot (use `whirlpool.ts` math; label Spot).
2. Live Pyth SOL/USD (Hermes or on-chain price update after a dry `post_update` read). Record price, conf, publish time, `|spot−pyth|/pyth`.
3. Admin CLI wallet balances: SOL, WSOL ATA, devUSDC ATA. Phantom balances if you will use it (default: **CLI/admin** as swapper).
4. Existing PERMA open positions / short inventory ranges on this market (at least note 18–22 practice band). State clearly: after moving spot to ~Pyth, those ranges are **away-from-spot**; new shorts near spot will be required for useful longs.
5. Capital estimate: stepped swap notionals (devUSDC and/or WSOL) to reach within 2%, using pool depth / quote simulation — not a wild guess. If estimate is absurd vs available faucet/play capital → **NO-GO on A** and document Option B needs.
6. Confirm program on Solana-devnet is still **pre-P3** (binary size / behavior: mint without `price_update` still works). Do not upgrade.
7. RPC plan: public Solana-devnet vs Helius Solana-devnet if rate-limited.

## Phase 0 exit

- **GO**: capital feasible with play tokens; script plan clear; human warned about open 18–22 positions.
- **GO WITH BLOCKERS**: e.g. need more SOL airdrop / more SOL→devUSDC first; list exact top-ups.
- **NO-GO**: Option A impossible → stop; write Option B proposal; no allowlist edits.

Ask the human once if they want to **Close** practice Short/Long at 18–22 before rebalance (recommended for a clean book). If they keep them, document impact and continue.

---

# PHASE 1 — TOOLING (dry-run first)

Add a repeatable script, preferred path:

`scripts/rebalance-devnet-pool.mjs`

**Required behaviors:**

1. `--measure` — print pool spot, tick, liquidity, Pyth SOL/USD, deviation bps. No txs.
2. `--plan --target-deviation-bps 200` — compute / simulate stepped swaps to enter the band; print direction, rough input amounts, expected ticks. No txs (or sim only).
3. `--step <amount>` — execute **one** swap step (devUSDC→WSOL or reverse as needed), then re-measure. Explicit flag; no hidden loops that dump the whole wallet.
4. `--until-within-bps 200` — optional loop of steps with **per-step caps**, max steps, and abort if deviation worsens or balances insufficient. Default off unless human asks.
5. Idempotent logging: every step records sig, spot before/after, pyth, deviation bps.
6. Cluster + keypair from env (`ANCHOR_PROVIDER_URL` / `SOLANA_RPC`, `ANCHOR_WALLET` or documented path). Refuse mainnet URLs.
7. Comments cite Orca instruction used (`swap` / `swap_v2` etc.) and account metas source.

Also add a short section to `docs/07-ops-presentation/RUNBOOK-DEVNET.md`: how to measure, plan, step, and what “within 2%” means. Update `docs/audits/P3-DEVNET-POOL-PRICE.md` checklist progress (do not claim upgrade done).

Reuse existing decode helpers where possible (`apps/web/src/lib/whirlpool.ts` via tsx, or duplicate minimal decode in the mjs with the same offsets — do not drift).

**Dependency rule:** Prefer `@solana/web3.js` + known Orca client already in-repo / documented. If you must add a package for Whirlpool swap building, pin it and document why. No drive-by dependency sprawl.

---

# PHASE 2 — EXECUTE Option A (Solana-devnet play tokens only)

Only after Phase 0 GO (or GO WITH BLOCKERS cleared).

1. Fund CLI wallet as needed: Solana-devnet SOL (airdrop/faucet); obtain **devUSDC** by swapping SOL→devUSDC on this same pool or Orca Solana-devnet UI if required for inventory.
2. Run `--measure` and `--plan`; paste numbers in the report.
3. Swap in **steps**; re-measure after each step until:

   `abs(spot - pyth) / pyth <= 0.02`

   (equivalent to deviation ≤ `MAX_DEVIATION_BPS` 200). Spot = pool USDC/SOL; pyth = SOL/USD; devUSDC = USD 1:1 per ADR.
4. Prefer approaching from below without overshooting wildly; if you overshoot >2% the other way, step back.
5. Note impact on existing short inventory ranges (ticket checklist item 4).
6. **Stop.** Do not upgrade the program. Do not set `NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE=1`. Do not point `NEXT_PUBLIC_PRICE_UPDATE` at a mainnet-style feed for Solana-devnet minting yet.

If Hermes is unreachable from the environment, use a documented fallback to read Pyth (e.g. other Hermes host, or post_update then read the price-update account) — never substitute CoinGecko as the **gate** number (CEX may differ). Display-only cross-checks are OK if labeled.

---

# PHASE 3 — PROOF + REPORT (this session’s DoD)

Write `docs/audits/IMPL-P3-DEVNET-POOL-PRICE-REPORT.md` including:

- Honesty banner
- Before/after spot, tick, pyth, deviation bps
- Swap step table (sig, amount in, amount out, spot after, deviation after)
- Capital used (SOL / WSOL / devUSDC)
- Open-position / inventory impact notes
- Script usage
- Explicit statement: **Solana-devnet program remains pre-P3**; P3 upgrade + Hermes `post_update` client + `NEXT_PUBLIC_PRICE_UPDATE` are **follow-on** (ticket checklist items 5–8)
- Option A vs B decision record

Update `docs/audits/P3-DEVNET-POOL-PRICE.md`:

- Status → **Phase A complete — pool within 2%; program upgrade still blocked on explicit follow-on** (or equivalent honest status)
- Check off items 1–4; leave 5–8 open

## Gates / proof commands (adapt paths)

```bash
# measure-only
node scripts/rebalance-devnet-pool.mjs --measure

# show final deviation in the report (must be ≤ 2%)
solana cluster-version -u devnet   # sanity
```

Localnet regression (must stay green; do not require full 114 if RPC/time boxed — but do not break compile):

```bash
yarn test:unit
# if time allows: existing web checks
cd apps/web && yarn typecheck && yarn test && yarn check-copy
```

## Explicitly OUT of this session (follow-on later)

- Solana-devnet **program upgrade** to P3
- Client Hermes → `post_update` wiring / mint tx packing (43 B short headroom)
- Flipping Solana-devnet env to require `price_update`
- P4 liquidation / force-exercise
- Option B allowlist / new market (unless Phase 0 NO-GO and human GO)
- Mainnet

If the human later sends `GO UPGRADE`, that is a **new** session with a separate prompt.

# Method

1. Phase 0 inventory + feasibility verdict.
2. Implement script with `--measure` / `--plan` before any `--step`.
3. Execute stepped swaps to ≤2% deviation.
4. Report + ticket doc surgery.
5. Stop for human review.

# Definition of Done

- [ ] Feasibility doc with GO / GO WITH BLOCKERS / NO-GO
- [ ] `scripts/rebalance-devnet-pool.mjs` (or equivalent) with measure/plan/step
- [ ] Live Solana-devnet pool spot within **2%** of live Pyth SOL/USD **or** documented NO-GO with Option B proposal
- [ ] RUNBOOK + `P3-DEVNET-POOL-PRICE.md` updated honestly
- [ ] `IMPL-P3-DEVNET-POOL-PRICE-REPORT.md` complete
- [ ] No Solana-devnet program upgrade unless human `GO UPGRADE`
- [ ] No mock Pyth on Solana-devnet; band still 200 bps
- [ ] Unit/web checks not regressing from unrelated edits

END PROMPT
=====
````

**One-liner after paste:**

```text
Read PROMPT. Start Phase 0 inventory + IMPL-P3-DEVNET-POOL-PRICE-FEASIBILITY.md. Do not live-swap until Phase 0 verdict is GO (or blockers cleared) and you have warned about open 18–22 positions. Default: no Solana-devnet program upgrade.
```
