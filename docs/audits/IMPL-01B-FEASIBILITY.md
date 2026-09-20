# Component 01B — Phase 0 Feasibility Note

**Date**: 2026-09-19 · **Scope**: fund vaults, execute real liquidity CPI, run the `0x1775` / `0x177c` regressions.

## Verdict: **GO**

| Check | Result |
|---|---|
| Toolchain | anchor-cli `1.2.0`, rustc `1.98.1`, node `24.11.1`, yarn `1.22.22` ✅ |
| Solana CLI | **`3.0.0`** — drifted from the `4.1.2` in the docs (avm swapped it). Re-pin docs to what works. |
| `anchor build --arch v0` | still mandatory; `v3` ELF is rejected by the loader |
| Pool `2WUgXb…ym9G` | **alive, unchanged** — liquidity `4 762 722 691 665`, `tick_spacing 8`, tick `-39140`, ≈$19.97/SOL |
| Program ID | `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt` unchanged → all fixture PDAs stable |
| Funding sizing | `L = 100_000_000` needs ≈ `0.0336` WSOL / `0.713` devUSDC → fund 10 / 1 000 for ~300× headroom |
| Injection viability | SPL token layout confirmed against Orca vault `63GvSv…DT5C`: 165 bytes, rent `2039280` ✅ |
| `update_fees_and_rewards` | 4 accounts, **no signer** → the `0x177c` regression can be sent straight from TS ✅ |
| `close_position` | requires `invoke_signed` → must be a PERMA instruction ✅ |

## Three gaps found — larger than "just fixtures"

1. **`close_position` was never implemented.** Only comments referenced it; no `ClosePositionCpi` import, no instruction. The documented 3-step close could not complete. The 01 report's claim that "the caller issues `close_position` last" is **wrong** — `position_authority` is a PDA, so only the program can sign it.
2. **Nothing initialises `PermaPosition`.** `adapter_add_liquidity` requires it to pre-exist (`bump = perma_position.bump`) but no instruction creates it.
3. **`create_market` does not validate vaults.** `vault_a` / `vault_b` were bare `UncheckedAccount`s recorded verbatim — which is why the existing test passed *Orca's own vaults* as placeholders.

All three are fixed in 01B. Without them the liquidity path is unreachable, so this was never only a fixture problem.

## Decisions

- **`adapter_open_position`** — CPIs Orca `open_position` (owner = `market_authority`) and inits `PermaPosition`. Closes gap 2 and proves the 4th of five Done-Definition CPIs.
- **`adapter_close_position`** — standalone instruction. Full close = `adapter_remove_liquidity(close_after=true)` → `adapter_close_position`; the `0x1775` regression composes naturally from `close_after=false` + close, so no test-only backdoor is added to the program.

## Funding method

Inject pre-funded SPL token accounts at the two deterministic ATA addresses via `solana-test-validator --account`. **The devUSDC mint stays byte-identical to devnet** — no forged mint authority, no mock Whirlpool.

| Account | Address |
|---|---|
| `market` (bump 255) | `BmfJqNtZkAVdF4QatqRWutQPkmkY1WY82PAG6zgdS2cy` |
| `market_authority` (bump 255) | `3AZgtdzChALF3ArkiUd489xtn7Hp2pKbCKBEtwfnvwtN` |
| `vault_a` WSOL ATA | `3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY` |
| `vault_b` devUSDC ATA | `HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR` |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
