/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/perma.json`.
 */
export type Perma = {
  "address": "4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt",
  "metadata": {
    "name": "perma",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "PERMA - perpetual options powered by Solana liquidity (Fair MVP)"
  },
  "instructions": [
    {
      "name": "adapterAddLiquidity",
      "docs": [
        "Add Orca liquidity for a short position.",
        "",
        "Assumes the Orca position already exists and both TickArrays are",
        "initialized - `initialize_tick_array` and `open_position` run as prior",
        "instructions, never as a CPI from this path (spec section C.5).",
        "",
        "Token amounts recorded are **observed vault deltas**, not the caller's quote."
      ],
      "discriminator": [
        83,
        37,
        115,
        128,
        36,
        144,
        123,
        213
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "permaPosition"
          ]
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          },
          "relations": [
            "permaPosition"
          ]
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "permaPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  97,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "permaPosition.nonce",
                "account": "permaPosition"
              }
            ]
          }
        },
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "orcaPosition",
          "writable": true
        },
        {
          "name": "positionTokenAccount"
        },
        {
          "name": "tokenMintA"
        },
        {
          "name": "tokenMintB"
        },
        {
          "name": "vaultA",
          "writable": true
        },
        {
          "name": "vaultB",
          "writable": true
        },
        {
          "name": "orcaVaultA",
          "writable": true
        },
        {
          "name": "orcaVaultB",
          "writable": true
        },
        {
          "name": "tickArrayLower",
          "writable": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true
        },
        {
          "name": "tokenProgramA"
        },
        {
          "name": "tokenProgramB"
        },
        {
          "name": "memoProgram"
        },
        {
          "name": "whirlpoolProgram"
        },
        {
          "name": "rangeState",
          "docs": [
            "derived and compared in the handler, so the harness guard cannot be",
            "skipped by omitting it. May be uninitialized, which proves no short ever",
            "traded this range."
          ]
        }
      ],
      "args": [
        {
          "name": "tickLower",
          "type": "i32"
        },
        {
          "name": "tickUpper",
          "type": "i32"
        },
        {
          "name": "liquidityAmount",
          "type": "u128"
        },
        {
          "name": "tokenMaxA",
          "type": "u64"
        },
        {
          "name": "tokenMaxB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "adapterClosePosition",
      "docs": [
        "Burn the Orca position NFT and reclaim its rent.",
        "",
        "**Step 3 of the full close.** Callers run",
        "`adapter_remove_liquidity(close_after = true)` first, which performs",
        "`decrease_liquidity_v2` then `collect_fees_v2`. Invoking this while",
        "liquidity or fees remain yields Orca `ClosePositionNotEmpty` (`0x1775`) -",
        "that propagation is a deliberate regression guard, not a bug."
      ],
      "discriminator": [
        189,
        177,
        135,
        168,
        70,
        116,
        138,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Receives the reclaimed rent from both the Orca position and its mint."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "permaPosition"
          ]
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          },
          "relations": [
            "permaPosition"
          ]
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "permaPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  97,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "permaPosition.nonce",
                "account": "permaPosition"
              }
            ]
          }
        },
        {
          "name": "orcaPosition",
          "writable": true
        },
        {
          "name": "positionMint",
          "writable": true
        },
        {
          "name": "positionTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "whirlpoolProgram"
        }
      ],
      "args": []
    },
    {
      "name": "adapterOpenPosition",
      "docs": [
        "Create the Orca position for a new short and register it with PERMA.",
        "",
        "Runs as a **prior transaction** to `adapter_add_liquidity` - bundling",
        "both plus a TickArray init left only ~80 bytes of transaction headroom.",
        "",
        "The position NFT lands in an ATA owned by `market_authority`, so every",
        "later `position_authority` check passes and no user key can ever move",
        "the position (ADR-0001)."
      ],
      "discriminator": [
        4,
        13,
        157,
        239,
        28,
        70,
        72,
        20
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Funds the Orca position, mint, ATA, and the PERMA position record."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "permaPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  97,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "whirlpool"
        },
        {
          "name": "orcaPosition",
          "writable": true
        },
        {
          "name": "positionMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "positionTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "whirlpoolProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tickLower",
          "type": "i32"
        },
        {
          "name": "tickUpper",
          "type": "i32"
        },
        {
          "name": "nonce",
          "type": "u64"
        }
      ]
    },
    {
      "name": "adapterRemoveLiquidity",
      "docs": [
        "Remove Orca liquidity for a short.",
        "",
        "`close_after = true` runs `decrease_liquidity_v2` -> `collect_fees_v2`.",
        "The caller issues `close_position` as the final instruction. Partial",
        "removes pass `false` and skip the fee collection."
      ],
      "discriminator": [
        119,
        57,
        252,
        59,
        123,
        233,
        43,
        61
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "permaPosition"
          ]
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          },
          "relations": [
            "permaPosition"
          ]
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "permaPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  97,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "permaPosition.nonce",
                "account": "permaPosition"
              }
            ]
          }
        },
        {
          "name": "whirlpool",
          "writable": true
        },
        {
          "name": "orcaPosition",
          "writable": true
        },
        {
          "name": "positionTokenAccount"
        },
        {
          "name": "tokenMintA"
        },
        {
          "name": "tokenMintB"
        },
        {
          "name": "vaultA",
          "writable": true
        },
        {
          "name": "vaultB",
          "writable": true
        },
        {
          "name": "orcaVaultA",
          "writable": true
        },
        {
          "name": "orcaVaultB",
          "writable": true
        },
        {
          "name": "tickArrayLower",
          "writable": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true
        },
        {
          "name": "tokenProgramA"
        },
        {
          "name": "tokenProgramB"
        },
        {
          "name": "memoProgram"
        },
        {
          "name": "whirlpoolProgram"
        },
        {
          "name": "rangeState",
          "docs": [
            "derived and compared in the handler, so the harness guard cannot be",
            "skipped by omitting it. May be uninitialized, which proves no short ever",
            "traded this range."
          ]
        }
      ],
      "args": [
        {
          "name": "tickLower",
          "type": "i32"
        },
        {
          "name": "tickUpper",
          "type": "i32"
        },
        {
          "name": "liquidityAmount",
          "type": "u128"
        },
        {
          "name": "tokenMinA",
          "type": "u64"
        },
        {
          "name": "tokenMinB",
          "type": "u64"
        },
        {
          "name": "closeAfter",
          "type": "bool"
        }
      ]
    },
    {
      "name": "burnPosition",
      "docs": [
        "**Close a position.** Branches on leg; see the per-leg docs below.",
        "",
        "**Close a short.** Runs the full 3-step Orca close, releases the",
        "collateral this position locked, and credits whatever Orca returned.",
        "",
        "`returned` differs from `locked` under impermanent loss or accrued fees;",
        "the difference is realized PnL absorbed into free balance. See",
        "`position.rs` for why any other rule breaks conservation.",
        "",
        "**Forward dependency:** when component 08 lands, this must call",
        "`settle_premium` *before* the close sequence (`08-burn-settle.md` §E)."
      ],
      "discriminator": [
        30,
        153,
        249,
        118,
        191,
        140,
        213,
        60
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "userCollateral",
            "permaPosition"
          ]
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          },
          "relations": [
            "userCollateral",
            "permaPosition"
          ]
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "userCollateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "permaPosition",
          "docs": [
            "**Not** `close = owner`. A short that still has an unfunded premium",
            "claim ends `PendingPremium` and its account must survive to carry it;",
            "the handler closes the account explicitly on every other path."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  97,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "permaPosition.nonce",
                "account": "permaPosition"
              }
            ]
          }
        },
        {
          "name": "premiumIndex",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  101,
                  109,
                  105,
                  117,
                  109,
                  95,
                  105,
                  110,
                  100,
                  101,
                  120
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "rangeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  110,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "permaPosition.tickLower",
                "account": "permaPosition"
              },
              {
                "kind": "account",
                "path": "permaPosition.tickUpper",
                "account": "permaPosition"
              }
            ]
          }
        },
        {
          "name": "rangeVault",
          "docs": [
            "Premium escrow for this range. Mandatory on **both** legs: a long pays",
            "into it before it may close, a short claims out of it before its",
            "liquidity leaves the denominator."
          ],
          "writable": true
        },
        {
          "name": "whirlpool",
          "writable": true,
          "optional": true
        },
        {
          "name": "orcaPosition",
          "writable": true,
          "optional": true
        },
        {
          "name": "positionMint",
          "writable": true,
          "optional": true
        },
        {
          "name": "positionTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenMintA",
          "optional": true
        },
        {
          "name": "tokenMintB",
          "optional": true
        },
        {
          "name": "vaultA",
          "writable": true,
          "optional": true
        },
        {
          "name": "vaultB",
          "writable": true,
          "optional": true
        },
        {
          "name": "orcaVaultA",
          "writable": true,
          "optional": true
        },
        {
          "name": "orcaVaultB",
          "writable": true,
          "optional": true
        },
        {
          "name": "tickArrayLower",
          "writable": true,
          "optional": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true
        },
        {
          "name": "memoProgram",
          "optional": true
        },
        {
          "name": "whirlpoolProgram",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "tokenMinA",
          "type": "u64"
        },
        {
          "name": "tokenMinB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createMarket",
      "docs": [
        "Register the single allowlisted Orca market.",
        "",
        "Admin-only and allowlist-gated (component 02). `tick_spacing`, mints,",
        "and vaults are read from the **live** Whirlpool account - never passed",
        "in, never hardcoded.",
        "",
        "Takes no `pool_address` argument: the whirlpool arrives as an account",
        "and the `Market` PDA derives from it, so a parameter would be a",
        "redundant value that must equal `whirlpool.key()`."
      ],
      "discriminator": [
        103,
        226,
        97,
        235,
        200,
        188,
        251,
        254
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Must equal `global_config.admin`; checked in the handler."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "globalConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "docs": [
            "`init` also enforces one market per pool - a second call surfaces",
            "Anchor's account-already-in-use error, mapped to `MarketAlreadyExists`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "whirlpool"
              }
            ]
          }
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "whirlpool"
        },
        {
          "name": "vaultA"
        },
        {
          "name": "vaultB"
        },
        {
          "name": "whirlpoolProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "depositCollateral",
      "docs": [
        "Move WSOL and/or devUSDC from the user's ATAs into the market vaults.",
        "",
        "Side `a` is the market's `token_mint_a` (WSOL), side `b` is",
        "`token_mint_b` (devUSDC). \"SOL collateral\" is **wrapped** SOL - raw",
        "lamports are never tracked (see `IMPL-03-FEASIBILITY.md` Q1)."
      ],
      "discriminator": [
        156,
        131,
        142,
        116,
        146,
        247,
        162,
        120
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "userCollateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "userTokenA",
          "writable": true
        },
        {
          "name": "userTokenB",
          "writable": true
        },
        {
          "name": "vaultA",
          "writable": true
        },
        {
          "name": "vaultB",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amountA",
          "type": "u64"
        },
        {
          "name": "amountB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "forceExercise",
      "docs": [
        "**Force-exercise** a long whose range is far out of the money",
        "(ADR-0005 §2), freeing the short liquidity it pins.",
        "",
        "The pool tick must be `oracle::FX_BAND_TICKS` beyond the range *and*",
        "agree with a fresh Pyth reference, so spot alone never triggers it.",
        "The owner's premium is paid in full (else this fails and liquidation",
        "is the path), and the caller pays the owner a fee. Long P&L stays 0.",
        "",
        "remaining_accounts: the **caller's** full open-long list, for the fee."
      ],
      "discriminator": [
        243,
        68,
        199,
        59,
        67,
        124,
        157,
        146
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "callerCollateral",
          "docs": [
            "The bonus lands here, or the fee leaves from here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "caller"
              }
            ]
          }
        },
        {
          "name": "owner",
          "docs": [
            "from `caller`, or one `UserCollateral` would be written twice."
          ],
          "writable": true,
          "relations": [
            "userCollateral",
            "permaPosition"
          ]
        },
        {
          "name": "market",
          "docs": [
            "`mut` only for the shortfall auto-pause."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          },
          "relations": [
            "callerCollateral",
            "userCollateral",
            "permaPosition"
          ]
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "userCollateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "permaPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  97,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "permaPosition.nonce",
                "account": "permaPosition"
              }
            ]
          }
        },
        {
          "name": "premiumIndex",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  101,
                  109,
                  105,
                  117,
                  109,
                  95,
                  105,
                  110,
                  100,
                  101,
                  120
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "rangeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  110,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "permaPosition.tickLower",
                "account": "permaPosition"
              },
              {
                "kind": "account",
                "path": "permaPosition.tickUpper",
                "account": "permaPosition"
              }
            ]
          }
        },
        {
          "name": "rangeVault",
          "writable": true
        },
        {
          "name": "vaultB",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "whirlpool",
          "docs": [
            "`force_exercise` only; checked against `market.whirlpool`."
          ],
          "optional": true
        },
        {
          "name": "priceUpdate",
          "docs": [
            "`force_exercise` only. CHECK: `oracle::load_price_update`."
          ],
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "initializeGlobalConfig",
      "docs": [
        "Set the protocol admin and the single-pool allowlist.",
        "",
        "The caller becomes `admin`. There is **no setter**: the allowlist is",
        "fixed at init so an admin-key compromise cannot repoint the protocol at",
        "an attacker-controlled pool. See `factory.rs`."
      ],
      "discriminator": [
        113,
        216,
        122,
        131,
        225,
        209,
        22,
        55
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Becomes the protocol admin."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "globalConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "allowlistedWhirlpool",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "liquidateLong",
      "docs": [
        "**Liquidate one long** of an account below maintenance (ADR-0005 §1).",
        "",
        "Permissionless and price-free: eligibility is premium over time, as in",
        "ADR-0003, so no spot or oracle move can make an account liquidatable.",
        "One long per call; each call re-checks the whole account, so a split",
        "liquidation stops as soon as the account is healthy again.",
        "",
        "remaining_accounts: the **owner's** full open-long list."
      ],
      "discriminator": [
        132,
        118,
        230,
        137,
        241,
        193,
        136,
        93
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "callerCollateral",
          "docs": [
            "The bonus lands here, or the fee leaves from here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "caller"
              }
            ]
          }
        },
        {
          "name": "owner",
          "docs": [
            "from `caller`, or one `UserCollateral` would be written twice."
          ],
          "writable": true,
          "relations": [
            "userCollateral",
            "permaPosition"
          ]
        },
        {
          "name": "market",
          "docs": [
            "`mut` only for the shortfall auto-pause."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          },
          "relations": [
            "callerCollateral",
            "userCollateral",
            "permaPosition"
          ]
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "userCollateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "permaPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  97,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "permaPosition.nonce",
                "account": "permaPosition"
              }
            ]
          }
        },
        {
          "name": "premiumIndex",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  101,
                  109,
                  105,
                  117,
                  109,
                  95,
                  105,
                  110,
                  100,
                  101,
                  120
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "rangeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  110,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "permaPosition.tickLower",
                "account": "permaPosition"
              },
              {
                "kind": "account",
                "path": "permaPosition.tickUpper",
                "account": "permaPosition"
              }
            ]
          }
        },
        {
          "name": "rangeVault",
          "writable": true
        },
        {
          "name": "vaultB",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "whirlpool",
          "docs": [
            "`force_exercise` only; checked against `market.whirlpool`."
          ],
          "optional": true
        },
        {
          "name": "priceUpdate",
          "docs": [
            "`force_exercise` only. CHECK: `oracle::load_price_update`."
          ],
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "lockCollateral",
      "docs": [
        "Reserve free collateral against a short. Accounting only - no tokens move.",
        "",
        "User-signed in component 03 because mint does not exist yet; component",
        "05 will compose this into `mint_options` in the same transaction as the",
        "adapter CPI."
      ],
      "discriminator": [
        161,
        216,
        135,
        122,
        12,
        104,
        211,
        101
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "userCollateral"
          ]
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          },
          "relations": [
            "userCollateral"
          ]
        },
        {
          "name": "userCollateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "amountA",
          "type": "u64"
        },
        {
          "name": "amountB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "mintPosition",
      "docs": [
        "**Open a short.** The product path: lock collateral, create the Orca",
        "position, and add real Whirlpool liquidity - in one atomic instruction.",
        "",
        "Everything below `adapter_*` is harness-level; this is what a user",
        "actually calls. Doing it in one transaction means a failure cannot leave",
        "an orphaned Orca position holding rent with no PERMA position behind it.",
        "",
        "`token_max_a/b` are slippage caps supplied by the client (PERMA does not",
        "quote Whirlpool math on-chain). Free balance must cover them, but what",
        "gets **locked is the observed spend**, not the cap - see `position.rs`."
      ],
      "discriminator": [
        251,
        31,
        179,
        3,
        138,
        134,
        203,
        28
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "userCollateral"
          ]
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          },
          "relations": [
            "userCollateral"
          ]
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "userCollateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "permaPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  97,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "premiumIndex",
          "docs": [
            "Premium clock for this market. Lazily created on first mint."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  101,
                  109,
                  105,
                  117,
                  109,
                  95,
                  105,
                  110,
                  100,
                  101,
                  120
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "rangeState",
          "docs": [
            "Per-range inventory + entitlement ledger. Created by the first short in",
            "the range; a long can only ever find it already there.",
            "",
            "Seeds use `to_le_bytes()` - NOT the `to_string()` form Orca's TickArray",
            "PDA uses. See `state::seeds::RANGE`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  110,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "arg",
                "path": "tickLower"
              },
              {
                "kind": "arg",
                "path": "tickUpper"
              }
            ]
          }
        },
        {
          "name": "rangeVault",
          "docs": [
            "Per-range premium escrow (USDC). Created alongside the range by the",
            "first short, so every settle path can assume it exists and the",
            "invariant `range_vault.amount == premium_pool + dust` holds from t=0.",
            "",
            "**Not** `Market.vault_b` - keeping the escrow separate is what makes the",
            "collateral conservation check independently verifiable (ADR-0002).",
            "token account with mint `token_mint_b` and owner `market_authority`,",
            "derived and created in the handler. **Not** the canonical ATA of",
            "(`market_authority`, `token_mint_b`): that address *is* `Market.vault_b`,",
            "and an early prototype of this component derived exactly that by",
            "mistake. `UncheckedAccount` because `anchor-spl` is deliberately absent",
            "from this program (ADR-0001) - adding it risks pulling a second",
            "`solana-*` crate family alongside the Orca client."
          ],
          "writable": true
        },
        {
          "name": "whirlpool",
          "writable": true,
          "optional": true
        },
        {
          "name": "orcaPosition",
          "writable": true,
          "optional": true
        },
        {
          "name": "positionMint",
          "writable": true,
          "signer": true,
          "optional": true
        },
        {
          "name": "positionTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenMintA",
          "optional": true
        },
        {
          "name": "tokenMintB",
          "optional": true
        },
        {
          "name": "vaultA",
          "writable": true,
          "optional": true
        },
        {
          "name": "vaultB",
          "writable": true,
          "optional": true
        },
        {
          "name": "orcaVaultA",
          "writable": true,
          "optional": true
        },
        {
          "name": "orcaVaultB",
          "writable": true,
          "optional": true
        },
        {
          "name": "tickArrayLower",
          "writable": true,
          "optional": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "optional": true
        },
        {
          "name": "memoProgram",
          "optional": true
        },
        {
          "name": "whirlpoolProgram",
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "priceUpdate",
          "docs": [
            "Pyth `PriceUpdateV2` for SOL/USD, both legs (ADR-0004). Required, not",
            "`Option`: a mint without a reference fails closed.",
            "validated in `oracle::load_price_update`."
          ]
        }
      ],
      "args": [
        {
          "name": "leg",
          "type": "u8"
        },
        {
          "name": "tickLower",
          "type": "i32"
        },
        {
          "name": "tickUpper",
          "type": "i32"
        },
        {
          "name": "liquidity",
          "type": "u128"
        },
        {
          "name": "tokenMaxA",
          "type": "u64"
        },
        {
          "name": "tokenMaxB",
          "type": "u64"
        },
        {
          "name": "nonce",
          "type": "u64"
        }
      ]
    },
    {
      "name": "pauseMarket",
      "docs": [
        "Trip the circuit breaker (component 10). Admin only.",
        "",
        "Blocks every path that *adds* risk or adds funds that could back new",
        "risk - `mint_position`, `deposit_collateral`, `lock_collateral`,",
        "`adapter_open_position`, `adapter_add_liquidity`. Every exit path stays",
        "open, subject to its own gates: `burn_position`, `settle_premium`,",
        "`withdraw_collateral` (09 solvency), `unlock_collateral`",
        "(`PositionsOutstanding`), and the adapter close/remove harness. The",
        "full matrix is `docs/02-mvp-components/10-pause-admin.md`.",
        "",
        "Idempotent: pausing an already-paused market is a no-op and emits",
        "nothing, so an ops script can retry without producing duplicate events."
      ],
      "discriminator": [
        216,
        238,
        4,
        164,
        65,
        11,
        162,
        91
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Must equal `global_config.admin`; checked in the handler."
          ],
          "signer": true
        },
        {
          "name": "globalConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "setMarketRiskParams",
      "docs": [
        "Set the ADR-0003 long-margin parameters (component 10). Admin only.",
        "",
        "Writes exactly `long_margin_horizon_slots` and `long_margin_buffer_usdc`",
        "- never `premium_rate` / `premium_multiplier`, which `set_premium_params`",
        "owns. Before writing, `risk::validate_risk_params` proves the",
        "margin at `risk::MARGIN_NOTIONAL_BOUND` (×`MAX_OPEN_LONGS`) still fits",
        "`u64` under the market's current rate and multiplier: an overflow at",
        "mint merely fails the mint, but an overflow at *withdraw* would lock",
        "every existing long's collateral. Rejects with `InvalidRiskParams`."
      ],
      "discriminator": [
        120,
        32,
        209,
        165,
        167,
        72,
        217,
        50
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Must equal `global_config.admin`; checked in the handler."
          ],
          "signer": true
        },
        {
          "name": "globalConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "longMarginHorizonSlots",
          "type": "u64"
        },
        {
          "name": "longMarginBufferUsdc",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setPremiumParams",
      "docs": [
        "Set the premium rate and multiplier (ADR-0006). Admin only.",
        "",
        "A long pays `rate × mult / 1e12` of its notional per slot; the deployed",
        "values are 11_111 × 1 (0.01 % per hour). Both are bounded by",
        "`risk::MAX_PREMIUM_RATE` / `MAX_PREMIUM_MULTIPLIER`, and the margin",
        "overflow bound is re-proved at the current horizon, else",
        "`InvalidPremiumParams`. The index is advanced at the **old** rate first,",
        "so the change only prices slots after this one."
      ],
      "discriminator": [
        109,
        191,
        78,
        125,
        119,
        46,
        38,
        53
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Must equal `global_config.admin`; checked in the handler."
          ],
          "signer": true
        },
        {
          "name": "globalConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "premiumIndex",
          "docs": [
            "the first mint creates it, and the rate must be settable before that."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  101,
                  109,
                  105,
                  117,
                  109,
                  95,
                  105,
                  110,
                  100,
                  101,
                  120
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "premiumRate",
          "type": "u64"
        },
        {
          "name": "premiumMultiplier",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settlePremium",
      "docs": [
        "**Settle premium in cash.** The instruction component 08 exists for.",
        "",
        "Every path here moves USDC *and* updates the books in the same function",
        "body, so no caller can ever clear a liability without the matching",
        "transfer - the single failure mode this component was written to remove",
        "(ADR-0002 addendum; `08-burn-settle.md` §C-D).",
        "",
        "**LONG (§C) - permissionless.** Any signer may crank any open long:",
        "premium is a pure function of elapsed slots and `payable_from` floors",
        "with carry, so cranking often and cranking once cost the long exactly",
        "the same. That is what makes \"anybody may call this\" safe.",
        "",
        "**SHORT (§D) - owner only.** It credits the owner's free balance, so a",
        "stranger has no business calling it. A short whose claim outruns the",
        "pool is paid what the pool holds and carries the rest on",
        "`premium_receivable`; when the balance finally clears, a",
        "`PendingPremium` position closes and refunds its rent.",
        "",
        "**P&L is not settled here.** Component 09 owns valuation; this moves",
        "premium and nothing else."
      ],
      "discriminator": [
        26,
        28,
        150,
        131,
        97,
        242,
        104,
        47
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Whoever is paying for the transaction. For a LONG this may be anybody",
            "(§C); for a SHORT the handler requires it to equal `owner`."
          ],
          "signer": true
        },
        {
          "name": "owner",
          "docs": [
            "stranger. Receives the rent when a `PendingPremium` short finally",
            "closes, which is why it is `mut`."
          ],
          "writable": true,
          "relations": [
            "userCollateral",
            "permaPosition"
          ]
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          },
          "relations": [
            "userCollateral",
            "permaPosition"
          ]
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "userCollateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "permaPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  97,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "permaPosition.nonce",
                "account": "permaPosition"
              }
            ]
          }
        },
        {
          "name": "premiumIndex",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  101,
                  109,
                  105,
                  117,
                  109,
                  95,
                  105,
                  110,
                  100,
                  101,
                  120
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "rangeState",
          "docs": [
            "Seeded from the *position's* ticks, so a caller cannot settle against",
            "some other range's accumulator."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  110,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "permaPosition.tickLower",
                "account": "permaPosition"
              },
              {
                "kind": "account",
                "path": "permaPosition.tickUpper",
                "account": "permaPosition"
              }
            ]
          }
        },
        {
          "name": "rangeVault",
          "docs": [
            "`Market.vault_b` - see `MintPosition::range_vault`."
          ],
          "writable": true
        },
        {
          "name": "vaultB",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "transferAdmin",
      "docs": [
        "Hand protocol admin to another key (P1). Current admin only.",
        "",
        "This is the whole multisig story on-chain: PERMA never learns what a",
        "Squads vault *is*, it just checks `require_keys_eq!` against whatever",
        "pubkey sits in `GlobalConfig.admin`. Pointing that at a vault retires",
        "the single-EOA risk without making the circuit breaker depend on a",
        "second program - a pause that needs a multisig CPI to work is not",
        "hardening, it is one more thing that can be down during an incident.",
        "",
        "Writes the existing `admin` bytes in place: no realloc, no migration.",
        "The allowlist stays setter-less, so this cannot repoint the protocol at",
        "another pool. Idempotent: transferring to the current admin is a no-op",
        "and emits nothing, exactly as `pause_market` is."
      ],
      "discriminator": [
        42,
        242,
        66,
        106,
        228,
        10,
        111,
        156
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Must equal `global_config.admin`; checked in the handler."
          ],
          "signer": true
        },
        {
          "name": "globalConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "unlockCollateral",
      "docs": [
        "Release reserved collateral back to free.",
        "",
        "Refuses while `open_positions > 0`. That counter is always zero until",
        "component 05 increments it on mint, so this is inert today and prevents",
        "unlocking collateral behind a live short the moment mint ships."
      ],
      "discriminator": [
        167,
        213,
        221,
        147,
        129,
        209,
        132,
        190
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "userCollateral"
          ]
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          },
          "relations": [
            "userCollateral"
          ]
        },
        {
          "name": "userCollateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "amountA",
          "type": "u64"
        },
        {
          "name": "amountB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "unpauseMarket",
      "docs": [
        "Clear the circuit breaker (component 10). Admin only. Idempotent, as",
        "`pause_market` is."
      ],
      "discriminator": [
        219,
        203,
        199,
        170,
        212,
        45,
        170,
        80
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Must equal `global_config.admin`; checked in the handler."
          ],
          "signer": true
        },
        {
          "name": "globalConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "unwindEmptyRange",
      "docs": [
        "Sweep the premium residue out of a fully unwound range and close it (P1).",
        "Admin only.",
        "",
        "The gap this closes is real: floor-with-carry leaves a residue that",
        "belongs to nobody, it accumulates inside `premium_pool` where it is",
        "indistinguishable from unclaimed entitlement, and until now nothing",
        "could move it (`ADR-0002` consequences, IMPL-08 residuals #2-#3). The",
        "rule was already written - \"swept to the protocol only when a range",
        "fully unwinds, never credited to any party mid-life\" - this implements",
        "exactly that sentence and nothing wider.",
        "",
        "**Fails closed.** Every signal that the range is still alive is checked",
        "before a single lamport moves. `receivable == 0` is the load-bearing",
        "one: a `PENDING_PREMIUM` short has already left `total_short_liquidity`",
        "but is still owed cash, and sweeping past it would forfeit a claim the",
        "protocol promised never to expire (`08-burn-settle.md` invariant 8).",
        "",
        "Moves **unattributable residue only** - never `Market.vault_a/b`, never",
        "a user's free or locked collateral, never a position's",
        "`premium_receivable`. That is why it does not become \"an admin path that",
        "moves user funds\"."
      ],
      "discriminator": [
        200,
        150,
        130,
        112,
        39,
        214,
        116,
        81
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Must equal `global_config.admin`; checked in the handler. `mut` because",
            "it receives the rent from both closed accounts."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "globalConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "rangeState",
          "docs": [
            "Seeded from its own recorded ticks, so the caller cannot point the",
            "instruction at one range's books while passing another's vault."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  110,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "rangeState.tickLower",
                "account": "rangePremiumState"
              },
              {
                "kind": "account",
                "path": "rangeState.tickUpper",
                "account": "rangePremiumState"
              }
            ]
          }
        },
        {
          "name": "rangeVault",
          "docs": [
            "re-derived, key-checked, and mint/owner-checked in the handler, as",
            "every other `range_vault` site does. `UncheckedAccount` because",
            "`anchor-spl` is deliberately absent (ADR-0001)."
          ],
          "writable": true
        },
        {
          "name": "destination",
          "docs": [
            "`check_user_ata` in the handler. Constraining the owner to the signer is",
            "the entire destination policy - see `IMPL-P1-FEASIBILITY.md` Q3a."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "validateShortRange",
      "docs": [
        "Validate a prospective short range without touching Orca.",
        "",
        "Runs the full section C.8 preamble and reports the derived TickArrays, so",
        "a client can discover which arrays need initializing **before** it builds",
        "the mint transaction."
      ],
      "discriminator": [
        43,
        254,
        56,
        216,
        101,
        181,
        180,
        223
      ],
      "accounts": [
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "whirlpool"
        },
        {
          "name": "tickArrayLower"
        },
        {
          "name": "tickArrayUpper"
        },
        {
          "name": "whirlpoolProgram"
        }
      ],
      "args": [
        {
          "name": "tickLower",
          "type": "i32"
        },
        {
          "name": "tickUpper",
          "type": "i32"
        }
      ]
    },
    {
      "name": "withdrawCollateral",
      "docs": [
        "Return free collateral from the market vaults to the user's ATAs.",
        "",
        "Gated by [`risk::check_withdraw_allowed`] - the single seam component 09",
        "will replace with full solvency. Locked collateral is unreachable here",
        "by construction: only free balance is debited."
      ],
      "discriminator": [
        115,
        135,
        168,
        106,
        139,
        214,
        138,
        150
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "userCollateral"
          ]
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.whirlpool",
                "account": "market"
              }
            ]
          },
          "relations": [
            "userCollateral"
          ]
        },
        {
          "name": "marketAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "userCollateral",
          "docs": [
            "`has_one = owner` is what stops one user draining another's ledger."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "userTokenA",
          "writable": true
        },
        {
          "name": "userTokenB",
          "writable": true
        },
        {
          "name": "vaultA",
          "writable": true
        },
        {
          "name": "vaultB",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "premiumIndex",
          "docs": [
            "The premium clock, read-only, for projecting open-long liability",
            "(component 09). `UncheckedAccount` on purpose: on a fresh ledger a user",
            "can withdraw before any mint has lazily created it, so it may not exist",
            "- and then it is not needed, because no long can exist either. The",
            "handler derives the PDA and deserializes only when `open_longs > 0`."
          ]
        }
      ],
      "args": [
        {
          "name": "amountA",
          "type": "u64"
        },
        {
          "name": "amountB",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "globalConfig",
      "discriminator": [
        149,
        8,
        156,
        202,
        160,
        252,
        176,
        217
      ]
    },
    {
      "name": "globalPremiumIndex",
      "discriminator": [
        246,
        241,
        19,
        45,
        158,
        138,
        202,
        152
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "permaPosition",
      "discriminator": [
        180,
        137,
        51,
        148,
        26,
        238,
        52,
        229
      ]
    },
    {
      "name": "rangePremiumState",
      "discriminator": [
        160,
        237,
        73,
        68,
        52,
        144,
        198,
        55
      ]
    },
    {
      "name": "userCollateral",
      "discriminator": [
        105,
        117,
        183,
        100,
        173,
        169,
        109,
        65
      ]
    }
  ],
  "events": [
    {
      "name": "adminTransferred",
      "discriminator": [
        255,
        147,
        182,
        5,
        199,
        217,
        38,
        179
      ]
    },
    {
      "name": "collateralDeposited",
      "discriminator": [
        244,
        62,
        77,
        11,
        135,
        112,
        61,
        96
      ]
    },
    {
      "name": "collateralLocked",
      "discriminator": [
        185,
        146,
        119,
        8,
        41,
        179,
        88,
        96
      ]
    },
    {
      "name": "collateralUnlocked",
      "discriminator": [
        195,
        248,
        152,
        155,
        116,
        178,
        189,
        221
      ]
    },
    {
      "name": "collateralWithdrawn",
      "discriminator": [
        51,
        224,
        133,
        106,
        74,
        173,
        72,
        82
      ]
    },
    {
      "name": "globalConfigInitialized",
      "discriminator": [
        5,
        221,
        172,
        158,
        77,
        87,
        157,
        113
      ]
    },
    {
      "name": "liquidityAdded",
      "discriminator": [
        154,
        26,
        221,
        108,
        238,
        64,
        217,
        161
      ]
    },
    {
      "name": "liquidityRemoved",
      "discriminator": [
        225,
        105,
        216,
        39,
        124,
        116,
        169,
        189
      ]
    },
    {
      "name": "longBurned",
      "discriminator": [
        127,
        126,
        61,
        30,
        250,
        214,
        207,
        136
      ]
    },
    {
      "name": "longForceExercised",
      "discriminator": [
        63,
        141,
        165,
        166,
        171,
        113,
        58,
        216
      ]
    },
    {
      "name": "longLiquidated",
      "discriminator": [
        118,
        100,
        250,
        117,
        155,
        0,
        21,
        241
      ]
    },
    {
      "name": "longMinted",
      "discriminator": [
        245,
        102,
        24,
        224,
        43,
        47,
        108,
        24
      ]
    },
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "marketPauseCleared",
      "discriminator": [
        28,
        250,
        219,
        15,
        67,
        24,
        231,
        254
      ]
    },
    {
      "name": "marketPauseSet",
      "discriminator": [
        225,
        139,
        3,
        28,
        185,
        26,
        121,
        144
      ]
    },
    {
      "name": "marketPremiumParamsSet",
      "discriminator": [
        122,
        204,
        149,
        122,
        41,
        73,
        52,
        47
      ]
    },
    {
      "name": "marketRiskParamsSet",
      "discriminator": [
        14,
        139,
        38,
        111,
        252,
        109,
        229,
        223
      ]
    },
    {
      "name": "positionClosed",
      "discriminator": [
        157,
        163,
        227,
        228,
        13,
        97,
        138,
        121
      ]
    },
    {
      "name": "positionOpened",
      "discriminator": [
        237,
        175,
        243,
        230,
        147,
        117,
        101,
        121
      ]
    },
    {
      "name": "premiumSettled",
      "discriminator": [
        18,
        115,
        229,
        0,
        187,
        80,
        211,
        69
      ]
    },
    {
      "name": "rangeUnwound",
      "discriminator": [
        233,
        50,
        109,
        150,
        85,
        243,
        164,
        237
      ]
    },
    {
      "name": "rangeValidated",
      "discriminator": [
        218,
        202,
        144,
        145,
        249,
        51,
        192,
        66
      ]
    },
    {
      "name": "shortBurned",
      "discriminator": [
        195,
        121,
        68,
        114,
        49,
        0,
        185,
        23
      ]
    },
    {
      "name": "shortMinted",
      "discriminator": [
        204,
        32,
        239,
        164,
        59,
        2,
        55,
        78
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "insufficientFunds",
      "msg": "Insufficient free collateral for this action"
    },
    {
      "code": 6001,
      "name": "insolventWithdrawal",
      "msg": "Withdrawal would leave open obligations uncovered"
    },
    {
      "code": 6002,
      "name": "insufficientCollateralForLoss",
      "msg": "Collateral cannot cover the premium owed"
    },
    {
      "code": 6003,
      "name": "positionsOutstanding",
      "msg": "Cannot unlock collateral while positions are open"
    },
    {
      "code": 6004,
      "name": "invalidLegType",
      "msg": "Unknown leg type"
    },
    {
      "code": 6005,
      "name": "positionAlreadyClosed",
      "msg": "Position is already closed"
    },
    {
      "code": 6006,
      "name": "noShortInventory",
      "msg": "Not enough available short liquidity in this range"
    },
    {
      "code": 6007,
      "name": "inventoryInvariantViolated",
      "msg": "Short burn would leave longs without backing inventory"
    },
    {
      "code": 6008,
      "name": "harnessPathUnavailable",
      "msg": "Harness path unavailable: this range has open longs"
    },
    {
      "code": 6009,
      "name": "nothingToSettle",
      "msg": "Nothing to settle"
    },
    {
      "code": 6010,
      "name": "rangeStateMismatch",
      "msg": "Range state does not match the position's ticks"
    },
    {
      "code": 6011,
      "name": "premiumPoolUnderfunded",
      "msg": "Premium pool underfunded for this claim"
    },
    {
      "code": 6012,
      "name": "zeroAmount",
      "msg": "Amount must be non-zero"
    },
    {
      "code": 6013,
      "name": "marketPaused",
      "msg": "Market is paused"
    },
    {
      "code": 6014,
      "name": "poolNotAllowlisted",
      "msg": "The requested CLMM pool is not approved for PERMA"
    },
    {
      "code": 6015,
      "name": "unauthorized",
      "msg": "The caller does not have the required admin privileges"
    },
    {
      "code": 6016,
      "name": "marketAlreadyExists",
      "msg": "A market already exists for this pool"
    },
    {
      "code": 6017,
      "name": "invalidAllowlistEntry",
      "msg": "Allowlisted whirlpool must not be the default pubkey"
    },
    {
      "code": 6018,
      "name": "wrongWhirlpoolProgram",
      "msg": "CPI target is not the Orca Whirlpool program"
    },
    {
      "code": 6019,
      "name": "whirlpoolNotAllowlisted",
      "msg": "Whirlpool is not the allowlisted market pool"
    },
    {
      "code": 6020,
      "name": "tickArrayNotInitialized",
      "msg": "Required TickArray is not initialized or does not match its derived PDA"
    },
    {
      "code": 6021,
      "name": "tickNotAlignedToSpacing",
      "msg": "Tick is not aligned to the pool tick spacing"
    },
    {
      "code": 6022,
      "name": "tickOutOfBounds",
      "msg": "Tick index is out of bounds"
    },
    {
      "code": 6023,
      "name": "positionAuthorityMismatch",
      "msg": "Orca position authority must be the PERMA market authority PDA"
    },
    {
      "code": 6024,
      "name": "unexpectedRemainingAccounts",
      "msg": "Unexpected remaining accounts supplied"
    },
    {
      "code": 6025,
      "name": "slippageExceeded",
      "msg": "Slippage bounds exceeded"
    },
    {
      "code": 6026,
      "name": "closePositionNotEmpty",
      "msg": "Orca position is not empty; run decrease -> collect_fees -> close"
    },
    {
      "code": 6027,
      "name": "invalidRange",
      "msg": "Invalid tick range: lower must be strictly less than upper"
    },
    {
      "code": 6028,
      "name": "invalidAsset",
      "msg": "Whirlpool asset does not match the market configuration"
    },
    {
      "code": 6029,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6030,
      "name": "invalidWhirlpoolAccount",
      "msg": "Failed to deserialize the Whirlpool account"
    },
    {
      "code": 6031,
      "name": "insolventMint",
      "msg": "Insufficient free USDC to back this long"
    },
    {
      "code": 6032,
      "name": "missingOpenLong",
      "msg": "Remaining accounts must be exactly the user's open longs"
    },
    {
      "code": 6033,
      "name": "tooManyOpenLongs",
      "msg": "Too many open longs"
    },
    {
      "code": 6034,
      "name": "invalidRiskParams",
      "msg": "Risk parameters would overflow the margin bound"
    },
    {
      "code": 6035,
      "name": "invalidAdmin",
      "msg": "New admin must be a real pubkey"
    },
    {
      "code": 6036,
      "name": "rangeNotEmpty",
      "msg": "Range still has inventory or an unfunded premium claim"
    },
    {
      "code": 6037,
      "name": "oracleUnavailable",
      "msg": "Reference price account is missing or invalid"
    },
    {
      "code": 6038,
      "name": "oracleStale",
      "msg": "Reference price is stale"
    },
    {
      "code": 6039,
      "name": "oracleConfidenceTooWide",
      "msg": "Reference price confidence is too wide"
    },
    {
      "code": 6040,
      "name": "oracleDeviationTooHigh",
      "msg": "Pool spot deviates too far from the reference price"
    },
    {
      "code": 6041,
      "name": "accountSolvent",
      "msg": "Account is above maintenance; nothing to liquidate"
    },
    {
      "code": 6042,
      "name": "notExercisable",
      "msg": "Long is not far enough out of range to force-exercise"
    },
    {
      "code": 6043,
      "name": "selfTarget",
      "msg": "Cannot liquidate or force-exercise your own position"
    },
    {
      "code": 6044,
      "name": "rangeTooNarrow",
      "msg": "Range is narrower than the minimum width"
    },
    {
      "code": 6045,
      "name": "invalidPremiumParams",
      "msg": "Premium parameters are out of bounds"
    }
  ],
  "types": [
    {
      "name": "adminTransferred",
      "docs": [
        "Protocol admin handed to another key. Emitted only on a real change, so a",
        "retried ops script does not produce a phantom handoff in the log."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "globalConfig",
            "type": "pubkey"
          },
          {
            "name": "oldAdmin",
            "type": "pubkey"
          },
          {
            "name": "newAdmin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "collateralDeposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amountA",
            "type": "u64"
          },
          {
            "name": "amountB",
            "type": "u64"
          },
          {
            "name": "balanceA",
            "type": "u64"
          },
          {
            "name": "balanceB",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "collateralLocked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amountA",
            "type": "u64"
          },
          {
            "name": "amountB",
            "type": "u64"
          },
          {
            "name": "lockedA",
            "type": "u64"
          },
          {
            "name": "lockedB",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "collateralUnlocked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amountA",
            "type": "u64"
          },
          {
            "name": "amountB",
            "type": "u64"
          },
          {
            "name": "lockedA",
            "type": "u64"
          },
          {
            "name": "lockedB",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "collateralWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amountA",
            "type": "u64"
          },
          {
            "name": "amountB",
            "type": "u64"
          },
          {
            "name": "balanceA",
            "type": "u64"
          },
          {
            "name": "balanceB",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "globalConfig",
      "docs": [
        "Protocol-wide admin and allowlist. Singleton: `PDA([\"global_config\"])`.",
        "",
        "Fair MVP allowlists **exactly one** Whirlpool, so the allowlist is a single",
        "`Pubkey` rather than a collection - the type enforces what `PRD.md` Part A",
        "mandates, and the check costs one `require_keys_eq!`.",
        "",
        "There is deliberately **no setter**. The allowlist is fixed at init, so an",
        "admin-key compromise cannot repoint the protocol at an attacker-controlled",
        "pool while markets hold real Orca positions."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "The only key permitted to call `create_market`."
            ],
            "type": "pubkey"
          },
          {
            "name": "allowlistedWhirlpool",
            "docs": [
              "The single Whirlpool PERMA will trade against."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "globalConfigInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "allowlistedWhirlpool",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "globalPremiumIndex",
      "docs": [
        "Protocol-wide premium clock. `PDA([\"premium_index\", market])`.",
        "",
        "A pure function of elapsed slots: `current_index += elapsed × premium_rate`.",
        "That is why the poke reward is **zero** - a late poke catches up exactly, so",
        "nothing is lost by not calling it (`07-premium-engine.md` §E)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "currentIndex",
            "docs": [
              "Monotonically increasing. Never decreases."
            ],
            "type": "u128"
          },
          {
            "name": "lastUpdateSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "liquidityAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "permaPosition",
            "type": "pubkey"
          },
          {
            "name": "orcaPosition",
            "type": "pubkey"
          },
          {
            "name": "tickLower",
            "type": "i32"
          },
          {
            "name": "tickUpper",
            "type": "i32"
          },
          {
            "name": "liquidity",
            "type": "u128"
          },
          {
            "name": "amountA",
            "type": "u64"
          },
          {
            "name": "amountB",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "liquidityRemoved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "permaPosition",
            "type": "pubkey"
          },
          {
            "name": "orcaPosition",
            "type": "pubkey"
          },
          {
            "name": "liquidity",
            "type": "u128"
          },
          {
            "name": "amountA",
            "type": "u64"
          },
          {
            "name": "amountB",
            "type": "u64"
          },
          {
            "name": "closed",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "longBurned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "permaPosition",
            "type": "pubkey"
          },
          {
            "name": "size",
            "type": "u128"
          },
          {
            "name": "premiumPaidUsdc",
            "docs": [
              "USDC actually transferred into the range vault by this burn."
            ],
            "type": "u64"
          },
          {
            "name": "totalLongLiquidity",
            "type": "u128"
          },
          {
            "name": "availableAfter",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "longForceExercised",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "exercisor",
            "type": "pubkey"
          },
          {
            "name": "permaPosition",
            "type": "pubkey"
          },
          {
            "name": "size",
            "type": "u128"
          },
          {
            "name": "premiumPaid",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "tick",
            "type": "i32"
          },
          {
            "name": "referencePrice",
            "type": "i64"
          },
          {
            "name": "conf",
            "type": "u64"
          },
          {
            "name": "publishTime",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "longLiquidated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "liquidator",
            "type": "pubkey"
          },
          {
            "name": "permaPosition",
            "type": "pubkey"
          },
          {
            "name": "size",
            "type": "u128"
          },
          {
            "name": "premiumPaid",
            "type": "u64"
          },
          {
            "name": "bonus",
            "type": "u64"
          },
          {
            "name": "shortfall",
            "docs": [
              "Premium the owner could not pay. Non-zero pauses the market."
            ],
            "type": "u64"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "longMinted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "permaPosition",
            "type": "pubkey"
          },
          {
            "name": "tickLower",
            "type": "i32"
          },
          {
            "name": "tickUpper",
            "type": "i32"
          },
          {
            "name": "size",
            "type": "u128"
          },
          {
            "name": "entryIndex",
            "type": "u128"
          },
          {
            "name": "totalShortLiquidity",
            "docs": [
              "Unchanged by a long - the shorts still provide it all."
            ],
            "type": "u128"
          },
          {
            "name": "totalLongLiquidity",
            "type": "u128"
          },
          {
            "name": "availableAfter",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "market",
      "docs": [
        "The single allowlisted Orca market.",
        "",
        "`tick_spacing`, mints, and vaults are **read from the live Whirlpool account**",
        "at `create_market` and cached here - never hardcoded. See",
        "`docs/02-mvp-components/02-factory-allowlisted-market.md` section A."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "whirlpool",
            "docs": [
              "The allowlisted Whirlpool. Every adapter CPI is checked against this."
            ],
            "type": "pubkey"
          },
          {
            "name": "whirlpoolsConfig",
            "docs": [
              "`Whirlpool.whirlpools_config` - cluster sanity check."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenMintA",
            "type": "pubkey"
          },
          {
            "name": "tokenMintB",
            "type": "pubkey"
          },
          {
            "name": "tokenVaultA",
            "type": "pubkey"
          },
          {
            "name": "tokenVaultB",
            "type": "pubkey"
          },
          {
            "name": "vaultA",
            "docs": [
              "PERMA-side vaults (ATAs owned by `market_authority`)."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultB",
            "type": "pubkey"
          },
          {
            "name": "tickSpacing",
            "docs": [
              "Copied from the live Whirlpool. Drives every tick alignment check."
            ],
            "type": "u16"
          },
          {
            "name": "hasActiveRewards",
            "docs": [
              "Must be false for Fair MVP: the close sequence omits `collect_reward_v2`."
            ],
            "type": "bool"
          },
          {
            "name": "isPaused",
            "type": "bool"
          },
          {
            "name": "authorityBump",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "premiumRate",
            "docs": [
              "Index units per slot. Default `premium_defaults::PREMIUM_RATE`."
            ],
            "type": "u64"
          },
          {
            "name": "premiumMultiplier",
            "docs": [
              "Converts index × liquidity into µUSDC. Default",
              "`premium_defaults::PREMIUM_MULTIPLIER`."
            ],
            "type": "u64"
          },
          {
            "name": "longMarginHorizonSlots",
            "docs": [
              "Slots of future premium a long must be able to pay from free USDC.",
              "Default `risk_defaults::LONG_MARGIN_HORIZON_SLOTS`."
            ],
            "type": "u64"
          },
          {
            "name": "longMarginBufferUsdc",
            "docs": [
              "Flat µUSDC floor per long, so a dust-sized long still needs real money.",
              "Default `risk_defaults::LONG_MARGIN_BUFFER_USDC`."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "docs": [
        "Additive only - existing consumers keep the first three fields."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "whirlpool",
            "type": "pubkey"
          },
          {
            "name": "tickSpacing",
            "type": "u16"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "premiumRate",
            "type": "u64"
          },
          {
            "name": "premiumMultiplier",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketPauseCleared",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "marketPauseSet",
      "docs": [
        "Component 10. Named `*PauseSet` / `*PauseCleared` rather than",
        "`MarketPaused` / `MarketUnpaused` (the spec's draft names) because",
        "`PermaError::MarketPaused` already owns that identifier. Emitted only on a",
        "real transition - see `pause_market`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "marketPremiumParamsSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "premiumRate",
            "type": "u64"
          },
          {
            "name": "premiumMultiplier",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketRiskParamsSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "longMarginHorizonSlots",
            "type": "u64"
          },
          {
            "name": "longMarginBufferUsdc",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "permaPosition",
      "docs": [
        "One PERMA short <-> one Orca position (ADR-0001).",
        "",
        "**Seed deviation.** `04-position-engine-1leg.md` specifies",
        "`[\"position\", market, owner, position_id]`; the shipped seeds are",
        "`[\"perma_position\", market, owner, nonce]`. Renaming would change every",
        "derivable address in the working 01B and 03 suites for no behavioural gain,",
        "and there is no deployed state to migrate. Recorded in",
        "`IMPL-04-05-FEASIBILITY.md` Q2.",
        "",
        "**Premium checkpoints are absent on purpose.** `entry_index`,",
        "`accrued_scaled`, `entry_acc_q64`, and `premium_receivable` belong to",
        "components 07/08. Shipping them zeroed would make the account look wired",
        "when nothing writes it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "orcaPosition",
            "docs": [
              "The Orca `Position` PDA, derived from `position_mint`."
            ],
            "type": "pubkey"
          },
          {
            "name": "positionMint",
            "docs": [
              "The Orca position NFT mint. Re-derives `orca_position` at close."
            ],
            "type": "pubkey"
          },
          {
            "name": "tickLower",
            "type": "i32"
          },
          {
            "name": "tickUpper",
            "type": "i32"
          },
          {
            "name": "liquidity",
            "docs": [
              "Liquidity currently held in the Orca position."
            ],
            "type": "u128"
          },
          {
            "name": "inOrcaA",
            "docs": [
              "**Current** token exposure sitting inside the Orca position - observed",
              "vault deltas, not quotes.",
              "",
              "Replaces the old `deposited_a/b`, which added on every increase and was",
              "never decremented on decrease. That made it cumulative rather than",
              "current, so it could not serve as `orca_exposure` and component 03 had",
              "to pin a conservation baseline instead of asserting the real invariant.",
              "With these fields maintained on both paths, conservation is exactly",
              "checkable: `vault_s + Σ in_orca_s == Σ_users (balance_s + locked_s)`."
            ],
            "type": "u64"
          },
          {
            "name": "inOrcaB",
            "type": "u64"
          },
          {
            "name": "lockedA",
            "docs": [
              "Collateral this position locked at mint, so burn unlocks the right",
              "amount when several shorts are open at once."
            ],
            "type": "u64"
          },
          {
            "name": "lockedB",
            "type": "u64"
          },
          {
            "name": "legType",
            "docs": [
              "`leg_type::SHORT` or `leg_type::LONG`.",
              "",
              "For a LONG the Orca fields (`orca_position`, `position_mint`) are",
              "`Pubkey::default()` and `in_orca_*` / `locked_*` stay zero - a long has",
              "no Orca position and moves no tokens. `liquidity` is its size."
            ],
            "type": "u8"
          },
          {
            "name": "status",
            "docs": [
              "`position_status::OPEN` or `CLOSED`."
            ],
            "type": "u8"
          },
          {
            "name": "entryIndex",
            "docs": [
              "LONG: `GlobalPremiumIndex.current_index` at open or last settle."
            ],
            "type": "u128"
          },
          {
            "name": "accruedScaled",
            "docs": [
              "LONG: unpaid sub-unit remainder, in `µUSDC × PREMIUM_SCALE`.",
              "Carried rather than rounded, so settle frequency cannot change the total",
              "(`07-premium-engine.md` §C)."
            ],
            "type": "u128"
          },
          {
            "name": "entryAccQ64",
            "docs": [
              "SHORT: `acc_premium_per_short_q64` at open or last claim. Checkpointing",
              "at mint is what stops a late short earning for periods before it existed."
            ],
            "type": "u128"
          },
          {
            "name": "premiumReceivable",
            "docs": [
              "SHORT: premium earned but not yet funded by any long (µUSDC).",
              "",
              "Entitlement accrues on elapsed time; cash arrives only when a long",
              "settles. This field is the gap, and it is what keeps a short that exits",
              "early from forfeiting what it earned (ADR-0002 decision 2)."
            ],
            "type": "u64"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "positionClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "permaPosition",
            "type": "pubkey"
          },
          {
            "name": "orcaPosition",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "positionOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "permaPosition",
            "type": "pubkey"
          },
          {
            "name": "orcaPosition",
            "type": "pubkey"
          },
          {
            "name": "positionMint",
            "type": "pubkey"
          },
          {
            "name": "tickLower",
            "type": "i32"
          },
          {
            "name": "tickUpper",
            "type": "i32"
          }
        ]
      }
    },
    {
      "name": "premiumSettled",
      "docs": [
        "Emitted by every `settle_premium` path. `amount` is the USDC that actually",
        "moved - there is no settle event without a transfer."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "permaPosition",
            "type": "pubkey"
          },
          {
            "name": "legType",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "stillOwed",
            "docs": [
              "SHORT only: entitlement the pool could not cover, carried forward."
            ],
            "type": "u64"
          },
          {
            "name": "premiumPool",
            "type": "u64"
          },
          {
            "name": "premiumOwedUsdc",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rangePremiumState",
      "docs": [
        "Per-range premium ledger and inventory.",
        "`PDA([\"range\", market, tick_lower_le, tick_upper_le])`.",
        "",
        "Created by the **first short mint** in a range. A long can never create it:",
        "a missing range means no short ever provided liquidity there, which is",
        "exactly `NoShortInventory`.",
        "",
        "# Cash fields (component 08)",
        "",
        "`premium_pool` and `receivable` are live: the first counts µUSDC actually",
        "sitting in the range vault, the second the entitlement no long has funded",
        "yet. `dust` is still **declared but never written** - see its own doc."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "tickLower",
            "type": "i32"
          },
          {
            "name": "tickUpper",
            "type": "i32"
          },
          {
            "name": "totalShortLiquidity",
            "docs": [
              "Sum of all open short liquidity. **The premium pro-rata denominator.**",
              "",
              "Never reduced by a long. Using the available remainder as the",
              "denominator would over-pay shorts as longs open, breaking zero-sum",
              "(`06-long-mint-inventory.md`)."
            ],
            "type": "u128"
          },
          {
            "name": "totalLongLiquidity",
            "docs": [
              "Sum of all open long liquidity. Drives entitlement accrual."
            ],
            "type": "u128"
          },
          {
            "name": "accPremiumPerShortQ64",
            "docs": [
              "Cumulative µUSDC earned per unit of short liquidity, Q64.64."
            ],
            "type": "u128"
          },
          {
            "name": "lastIndex",
            "docs": [
              "`GlobalPremiumIndex.current_index` at the last poke."
            ],
            "type": "u128"
          },
          {
            "name": "premiumPool",
            "docs": [
              "µUSDC actually escrowed in the range vault.",
              "",
              "Maintained so that `range_vault.amount == premium_pool + dust` holds",
              "after every settle path, reconciled over RPC in `tests/settle-premium.ts`",
              "and `scripts/reconcile.mjs`."
            ],
            "type": "u64"
          },
          {
            "name": "receivable",
            "docs": [
              "µUSDC shorts have earned that no long has funded yet - the sum of every",
              "position's `premium_receivable` in this range."
            ],
            "type": "u64"
          },
          {
            "name": "dust",
            "docs": [
              "Floor residue. **Declared, never written.**",
              "",
              "The rounding residue is real but it is not separable: it stays in",
              "`premium_pool`, where it is indistinguishable from entitlement nobody",
              "has claimed yet. Splitting the two would mean recomputing every open",
              "short's claim on every poke, which is the O(n) work the accumulator",
              "exists to avoid. The field is kept because the identity above is stated",
              "with it and because a future component may account for it separately;",
              "it must not be read as \"residue so far\"."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "rangeUnwound",
      "docs": [
        "A fully unwound range was swept and closed. `amount_usdc` is the residue",
        "that left the protocol's escrow - the only path by which the protocol ever",
        "receives premium (ADR-0002)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "tickLower",
            "type": "i32"
          },
          {
            "name": "tickUpper",
            "type": "i32"
          },
          {
            "name": "amountUsdc",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rangeValidated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "tickLower",
            "type": "i32"
          },
          {
            "name": "tickUpper",
            "type": "i32"
          },
          {
            "name": "tickArrayLower",
            "type": "pubkey"
          },
          {
            "name": "tickArrayUpper",
            "type": "pubkey"
          },
          {
            "name": "currentTick",
            "type": "i32"
          },
          {
            "name": "sqrtPriceX64",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "shortBurned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "permaPosition",
            "type": "pubkey"
          },
          {
            "name": "liquidity",
            "type": "u128"
          },
          {
            "name": "unlockedA",
            "docs": [
              "Collateral released (what mint locked)."
            ],
            "type": "u64"
          },
          {
            "name": "unlockedB",
            "type": "u64"
          },
          {
            "name": "returnedA",
            "docs": [
              "What Orca actually returned. `returned - unlocked` is realized PnL."
            ],
            "type": "u64"
          },
          {
            "name": "returnedB",
            "type": "u64"
          },
          {
            "name": "premiumClaimed",
            "docs": [
              "Premium paid out of the range vault during this burn."
            ],
            "type": "u64"
          },
          {
            "name": "premiumReceivable",
            "docs": [
              "Entitlement the pool could not cover; carried on the position."
            ],
            "type": "u64"
          },
          {
            "name": "status",
            "docs": [
              "`CLOSED`, or `PENDING_PREMIUM` when `premium_receivable > 0`."
            ],
            "type": "u8"
          },
          {
            "name": "openPositions",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "shortMinted",
      "docs": [
        "The product-path events. `adapter_*` emit the lower-level",
        "`PositionOpened`/`LiquidityAdded`/... pair instead."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "permaPosition",
            "type": "pubkey"
          },
          {
            "name": "orcaPosition",
            "type": "pubkey"
          },
          {
            "name": "tickLower",
            "type": "i32"
          },
          {
            "name": "tickUpper",
            "type": "i32"
          },
          {
            "name": "liquidity",
            "type": "u128"
          },
          {
            "name": "lockedA",
            "docs": [
              "The **observed** spend that was locked, not the caller's cap."
            ],
            "type": "u64"
          },
          {
            "name": "lockedB",
            "type": "u64"
          },
          {
            "name": "openPositions",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "userCollateral",
      "docs": [
        "Per-user collateral ledger for one market. `PDA([\"collateral\", market, owner])`.",
        "",
        "**Assets are SPL tokens only.** \"SOL collateral\" means **wrapped SOL**: side",
        "`a` is the market's `token_mint_a` (WSOL, 9 dp) and side `b` is",
        "`token_mint_b` (devUSDC, 6 dp). Raw lamports are never tracked here - the",
        "vaults and the Orca adapter are SPL end-to-end, so a second representation",
        "of the same asset could not be conserved. The spec's `sol_balance` /",
        "`usdc_balance` names are superseded; see `IMPL-03-FEASIBILITY.md` Q1.",
        "",
        "Tokens themselves live in `Market.vault_a` / `Market.vault_b`. This account",
        "records **who owns how much of them**, which is what makes the conservation",
        "invariant checkable:",
        "",
        "```text",
        "vault_s.amount + orca_exposure_s == Σ_users (balance_s + locked_s)",
        "```",
        "",
        "`orca_exposure_s` is component 05's job; in component 03 it is always zero."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "balanceA",
            "docs": [
              "Free WSOL - withdrawable, lockable."
            ],
            "type": "u64"
          },
          {
            "name": "lockedA",
            "docs": [
              "WSOL committed to open shorts. Never withdrawable."
            ],
            "type": "u64"
          },
          {
            "name": "balanceB",
            "docs": [
              "Free devUSDC."
            ],
            "type": "u64"
          },
          {
            "name": "lockedB",
            "docs": [
              "devUSDC committed to open shorts."
            ],
            "type": "u64"
          },
          {
            "name": "premiumOwedUsdc",
            "docs": [
              "Accrued, unsettled premium this user owes as a long (µUSDC).",
              "",
              "**Enforced now, written later.** Withdraw already refuses to leave free",
              "USDC below this figure (premium seniority, ADR-0002); components 07/08",
              "are what will ever set it above zero."
            ],
            "type": "u64"
          },
          {
            "name": "openPositions",
            "docs": [
              "Open short positions backed by `locked_*`.",
              "",
              "Gates `unlock_collateral`. Always `0` until component 05 increments it",
              "on mint - so behaviour is unchanged today, but a user can never unlock",
              "collateral backing a live position once mint exists. Closing the hole by",
              "construction rather than by a comment 05 has to remember."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "openLongs",
            "docs": [
              "Open LONG positions for this user on this market.",
              "",
              "The solvency gate takes every open long as a remaining account and",
              "requires the count to match this exactly (`MissingOpenLong`), so a",
              "caller cannot omit one to under-count their liability. Maintained by",
              "`position::open_long` / `close_long`; bounded by `risk::MAX_OPEN_LONGS`."
            ],
            "type": "u16"
          }
        ]
      }
    }
  ]
};
