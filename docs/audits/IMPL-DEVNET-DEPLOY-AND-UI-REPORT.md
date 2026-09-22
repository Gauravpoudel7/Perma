# IMPL — Solana-devnet deploy + UI target

> **Scope:** ops tooling, env and docs. No `programs/**` semantics, IDL, or `apps/web/src` change. Localnet path untouched.
> **Date:** 2026-09-22
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## Outcome in one line

**The deploy did not happen: the deploy wallet cannot be funded on public Solana-devnet right now.** Everything that does not require SOL is done and verified — the idempotent init script (exercised end to end against a live cluster), the devnet env block, the user-facing devUSDC/Phantom instructions, and an honest runbook status. Nothing claims a deployment that did not occur, and no `.env` was flipped.

## Funding blocker (measured, not assumed)

| Fact | Value |
|---|---|
| Program on Solana-devnet | `solana program show 4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt -u https://api.devnet.solana.com` → "Unable to find the account" |
| Program binary | `target/deploy/perma.so`, 594,752 bytes; `target/deploy/perma-keypair.json` → `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt` (declared id preserved) |
| Program-data rent | `solana rent $((594752*2+48))` → **6.0435744 SOL** (plus ~0.0015 for the program account and fees) |
| Deploy wallet | `7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY`, **0 SOL** on devnet |
| Airdrops attempted | 8 requests across 2 SOL / 1 SOL / 0.5 SOL and a second endpoint — every one returned `Error: airdrop request failed. This can happen when the rate limit is reached.` Balance still 0. |

Public devnet caps an airdrop at 2 SOL and rate-limits per address and IP, so ~6.1 SOL needs at least four successful requests. To unblock: fund `7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY` on devnet from an existing devnet balance, from `faucet.solana.com` (needs a GitHub login), or from a provider RPC's faucet, then run §1–§2 of `RUNBOOK-DEVNET.md`. Tooling versions are ready: `anchor-cli 1.2.0`, `cargo 1.98.1` (both under `~/.cargo/bin` / `~/.avm/bin`, not on the default PATH), `solana-cli 3.0.0`.

## What shipped

### `scripts/init-devnet-market.mjs` (`yarn init-market`)
Bootstraps a cluster PERMA has never run on, and is safe to re-run:
1. Refuses to do anything if the program is not deployed on the target cluster, printing the deploy command.
2. Reads `token_mint_a` / `token_mint_b` **live from the Whirlpool account** (offsets 101 and 181 — see below), never from a constant.
3. Creates the two PERMA vaults if missing, as ATAs of the `market_authority` PDA (off-curve) for those mints. `create_market` requires them to exist already and checks their mint and owner (`programs/perma/src/lib.rs`).
4. `initialize_global_config(pool)` if `GlobalConfig` is missing; otherwise skips and warns if its `admin` is not the signer or its `allowlisted_whirlpool` is a different pool.
5. `create_market()` if the market PDA is missing; otherwise skips.
6. Prints the address table this runbook needs.

**Verified against a live cluster** (the running local validator, which clones the same Orca pool). Two bugs the run caught, both now fixed: the second mint is at offset **181**, not `mint_a + 64` (`fee_growth_global_a` sits between them) — the wrong offset made the ATA instruction fail with `IncorrectProgramId`; and the config field is `allowlisted_whirlpool`, not `allowlistedPool`. After the fixes the script derives exactly the fixture vaults `3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY` / `HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR`, and reports every account as already existing (idempotent). Run against devnet it stops at step 1 with the deploy instruction, as intended.

Addresses it printed on the local cluster — the same PDAs devnet will produce, since they derive from the program id and pool:

```
program            4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt
global config      3twNiDaKAQ9vqvYjDPY7AUtVfqk4XmREaDiDgRt2keYe
market             BmfJqNtZkAVdF4QatqRWutQPkmkY1WY82PAG6zgdS2cy
market authority   3AZgtdzChALF3ArkiUd489xtn7Hp2pKbCKBEtwfnvwtN
whirlpool          2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G
vault A / B        3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY / HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR
token mint A / B   So11111111111111111111111111111111111111112 / BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k
admin              7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY
tick spacing       8 · premium rate 1000000 · multiplier 1000 · paused false
```

### Docs and env
- `apps/web/.env.example`: commented Solana-devnet block beside the localnet one, with notes that an unset indexer means honest empty charts and that the localnet funded-wallet variable does not apply.
- `apps/web/README.md`: new "Solana-devnet" section — Phantom on Devnet, SOL airdrop, **devUSDC** `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k` by swapping on Orca's devnet app (explicitly not Circle USDC, no faucet, cannot be minted), connect, deposit.
- `RUNBOOK-DEVNET.md`: status line replaced with the measured blocker above; the "no `yarn scripts:init-market`" TODO replaced by the real command and the script's guarantees; the seed-shorts TODO kept, with the devUSDC prerequisite named.
- `.env.local` was deliberately **not** changed: it is gitignored operator state and flipping it would break the working localnet setup. The exact block to paste is in `.env.example` and the README.

## Deferred, as agreed
Seeding a demo short. It needs devUSDC in the admin wallet (an Orca swap), and until one exists Trade shows the verbatim "No short liquidity in this range. A long needs existing short liquidity to open against."

## Gate
| Check | Result |
|---|---|
| `apps/web` `yarn typecheck` | clean |
| `apps/web` `yarn test` | 8 files, 63 tests passed |
| `apps/web` `yarn check-copy` | "No banned phrases found." |
| Devnet build excludes the localnet wallet | `NEXT_PUBLIC_CLUSTER=devnet yarn build` → `grep -rl "Localnet CLI keypair (fixtures)" .next/static` returns nothing |
| `yarn init-market` on a live cluster | Idempotent; full address table printed |
| `yarn init-market` against devnet | Stops with "The program is not deployed on this cluster" |

No `apps/web/src` file changed in this task, so the three web gates are regression checks.

## What to run once the wallet is funded
```bash
export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"
anchor build --arch v0
anchor deploy --provider.cluster devnet
solana program show 4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt -u https://api.devnet.solana.com
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json yarn init-market
```
If `anchor deploy` fails mid-upload, resume with `solana program deploy --buffer target/deploy/perma-upgrade-buffer.json` rather than restarting.

Then the manual smoke, which needs a browser wallet: Phantom on Devnet with the env block → Markets and Trade load with no cluster alarm → airdrop SOL → swap for devUSDC on Orca devnet → Vault deposit succeeds.


## Follow-up — deploy completed (2026-09-22)

Funding cleared (10 SOL). `anchor deploy --provider.cluster solana-devnet` then `yarn init-market` succeeded on public Solana-devnet.

| Item | Value |
|---|---|
| Program | `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt` (slot 502540621) |
| Market | `BmfJqNtZkAVdF4QatqRWutQPkmkY1WY82PAG6zgdS2cy` |
| Global config | `3twNiDaKAQ9vqvYjDPY7AUtVfqk4XmREaDiDgRt2keYe` |
| Remaining SOL | ~6.97 |
| IDL | Failed post-deploy (`~/.npm` EACCES); program itself is live |
| `apps/web/.env.local` | Flipped to `CLUSTER=devnet` / public RPC; indexer unset |

Seed shorts still deferred.
