# CLAUDE-IMPLEMENT — Solana-devnet deploy + point UI at Solana-devnet

> **Cluster name:** public **Solana-devnet** (`https://api.devnet.solana.com`). Not localnet.  
> **Read first:** `docs/07-ops-presentation/DEVNET-UI-RESEARCH.md`, `RUNBOOK-DEVNET.md`, `docs/06-testing/RELEASE-GATE.md` §5, `FIXTURES-AND-VECTORS.md` §6, `tests/factory.ts` (init pattern), `tests/position-short.ts` (seed pattern), `apps/web/README.md`, `perma-no-break`, `perma-honesty`.  
> **Plugins:** frontend-design only if touching UI copy. Ponytail/caveman OFF.  
> **Model:** strongest available.

## Goal

1. **Deploy** PERMA to public Solana-devnet and initialize GlobalConfig + allowlisted market for whirlpool `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G`.
2. **Optionally seed** a short in the demo range so longs can open.
3. **Point** `apps/web` at Solana-devnet and document Phantom + SOL airdrop + Orca swap for **devUSDC**.
4. Prove with `solana program show` + a smoke deposit (or scripted deposit) from a normal Phantom Solana-devnet wallet.

## Hard facts (do not reopen)

- Whirlpool **already exists** on Solana-devnet (verified). Same id as localnet clone.
- Program `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt` was **MISSING** on Solana-devnet as of research date — deploy required.
- Orca **devUSDC** mint `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k` — not Circle USDC.
- Build with `anchor build --arch v0` (mandatory).
- Do **not** change `programs/**` semantics unless deploy tooling requires a no-op; prefer scripts + docs + env.

## In scope

### D1 — Deploy + init (must)

1. Confirm wallet has Solana-devnet SOL (`solana airdrop` / faucet). Rate limits possible — retry or use a provider RPC.
2. `anchor build --arch v0` then `anchor deploy --provider.cluster solana-devnet` (or equivalent `solana program deploy` per RELEASE-GATE). Record final **program id**.
3. Extract init into a **repeatable script** (new `scripts/init-devnet-market.mjs` or `apps/web` tsx) that:
   - `initialize_global_config` with allowlisted whirlpool `2WUg…` (match factory tests)
   - `create_market` for that pool
   - Is idempotent / fails clearly if already initialized
4. Verify: `solana program show <PROGRAM_ID> -u solana-devnet`; market PDA account exists.
5. Optional but recommended: seed one short in ticks `-40176`/`-38168` (18–22 USDC range) so Trade longs work — follow `mintShort` pattern; document amounts.
6. Update `RUNBOOK-DEVNET.md`: remove “not performed yet”; paste exact commands + program id + market pubkey.

### D2 — UI env + docs (must after D1 green)

1. Document `.env.local` for Solana-devnet (CLUSTER=devnet, RPC, PROGRAM_ID, WHIRLPOOL). Unset `NEXT_PUBLIC_LOCALNET_FUNDED_WALLET` and indexer or point indexer at Solana-devnet if you stand one up.
2. Do **not** force-commit secrets. Provide `.env.example` Solana-devnet block.
3. Short user doc: Phantom → Solana-devnet → airdrop SOL → get **devUSDC** via Orca Solana-devnet swap → Connect → Vault deposit.
4. Confirm Localnet CLI wallet **absent** when `CLUSTER=devnet`.
5. Honest empty charts if indexer unset.

### D3 — Smoke (must)

- [ ] Program show succeeds on Solana-devnet  
- [ ] Web loads Markets/Trade against Solana-devnet RPC without cluster alarm  
- [ ] Deposit with Phantom (Solana-devnet) succeeds once funded with SOL+devUSDC  
- [ ] `yarn typecheck && yarn test && yarn check-copy` in `apps/web` still green  
- [ ] IMPL: `docs/audits/IMPL-DEVNET-DEPLOY-AND-UI-REPORT.md`

## Out of scope / Forbidden

- Mainnet deploy / audit claims  
- Changing Fair risk model / inventing USDC mint authority  
- Pretending Circle USDC works on Solana-devnet  
- Breaking localnet path (keep localnet docs working)  
- Silent `.env` flip before program exists on Solana-devnet  

## Method

1. Read research + RUNBOOK + factory test init.  
2. Deploy → init script → verify accounts → (seed) → flip example env → smoke.  
3. If public RPC rate-limits, switch operator RPC to Helius/Triton Solana-devnet and document.  
4. Report every address (program, market, whirlpool, admin).

## Gate / proof

```bash
solana program show <PROGRAM_ID> -u https://api.devnet.solana.com
# market account exists
cd apps/web && yarn typecheck && yarn test && yarn check-copy
```

Manual: Phantom on Solana-devnet deposits to Vault.
