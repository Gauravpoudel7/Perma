# PERMA on public Solana-devnet — Research Brief

> **Date:** 2026-09-22  
> **Ask:** Stop depending on localnet fixtures / CLI keypair; use **Solana-devnet** + Phantom.  
> **Verdict:** **Phased GO** — Orca is ready on Solana-devnet; **PERMA is not deployed there yet**. Do ops deploy + market init **before** flipping the web UI.

---

## 1. Simple English

Localnet = a Solana network that lives only on your laptop. Test USDC was injected into one special wallet file.

**Solana-devnet** = Solana’s public practice network. Phantom can use it. Orca already has a SOL/devUSDC pool there. Anyone can airdrop practice SOL and swap for **devUSDC**.

But **PERMA’s own program is not on that public network yet** (checked 2026-09-22). Pointing the website at Solana-devnet today would show a dead program / missing market. So: **deploy PERMA to Solana-devnet first**, then switch the app.

---

## 2. What we verified on-chain

| Account | Public Solana-devnet (`api.devnet.solana.com`) |
|---|---|
| Orca Whirlpool `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (SOL/devUSDC, tick spacing 8) | **EXISTS** (owner `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`) |
| PERMA program `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt` | **MISSING** |
| Market PDA `BmfJqNtZkAVdF4QatqRWutQPkmkY1WY82PAG6zgdS2cy` | **MISSING** |

Same whirlpool id is what localnet clones and what Orca’s SDK tutorial lists for Solana-devnet. Good — **no pool migration**.

Sources: live RPC probes; Orca whirlpools tutorial kit; `docs/07-ops-presentation/RUNBOOK-DEVNET.md` (states Solana-devnet deploy not performed as of 2026-09-20).

---

## 3. Tokens / wallet UX on Solana-devnet

| Need | How |
|---|---|
| SOL (fees) | Phantom → Devnet → faucet / `solana airdrop 2 <pubkey> -u solana-devnet` |
| devUSDC mint `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k` | Swap small SOL → devUSDC on Orca Solana-devnet (tutorial / SDK), **not** Circle USDC |
| Phantom network | **Solana-devnet**, not Mainnet, not localhost |

Localnet CLI keypair wallet stays **localnet-only** (already excluded from Solana-devnet builds).

---

## 4. App env target (after deploy)

```bash
NEXT_PUBLIC_CLUSTER=devnet
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com   # or Helius/Triton Solana-devnet if rate-limited
NEXT_PUBLIC_PERMA_PROGRAM_ID=<same id if upgradeable keypair reused, else new id from deploy>
NEXT_PUBLIC_WHIRLPOOL=2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G
# Indexer: host against Solana-devnet RPC or leave unset until hosted
# NEXT_PUBLIC_LOCALNET_FUNDED_WALLET=   # unset / ignore on Solana-devnet
```

ClusterGuard already expects Solana-devnet genesis when `CLUSTER=devnet`.

---

## 5. Ops gaps (from RUNBOOK)

- `anchor deploy --provider.cluster solana-devnet` (document as Solana-devnet) not done
- No first-class `yarn init-market` — today init lives in test `before()` hooks (`tests/factory.ts`)
- No first-class seed-shorts script — pattern in `tests/position-short.ts`
- Indexer currently assumes local ingest; Solana-devnet needs a long-running ingest or UI without indexer (honest empty charts)

---

## 6. Recommendation

| Phase | Action | Who |
|---|---|---|
| **D0** | Keep UI on localnet for demos until D1 green | — |
| **D1** | Deploy PERMA + `initialize_global_config` + allowlist + `create_market` on **public Solana-devnet**; optional short seed | Ops / Claude prompt |
| **D2** | Flip `apps/web` `.env.local` to Solana-devnet; Phantom on Solana-devnet; SOL airdrop + Orca swap for devUSDC | You |
| **D3** | Optional: indexer on Solana-devnet RPC; remove reliance on localnet fixtures for day-to-day UI | Later |

**Do not** only change `.env` to Solana-devnet without D1 — Markets/Trade will break.

---

## 7. Sources

- Live: `solana program show` / `getAccountInfo` on `https://api.devnet.solana.com`
- In-repo: `RUNBOOK-DEVNET.md`, `RELEASE-GATE.md` §5, `FIXTURES-AND-VECTORS.md`, `Anchor.toml` clone urls
- Orca: whirlpools on Solana-devnet; pool `2WUg…`; mint `BRjp…` (devUSDC)
