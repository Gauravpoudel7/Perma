import { PublicKey } from "@solana/web3.js";

/**
 * Every value here is either a public, stable constant (the Orca Whirlpool
 * program ID is the same on every cluster) or read from `NEXT_PUBLIC_*` env
 * vars. Nothing here is a market-specific address (vaults, mints, tick
 * spacing) — those come from the live `Market` account, never a hardcoded
 * constant, unlike the Anchor test fixtures which hardcode devnet addresses
 * for speed. See docs/adr and IMPL-UI-FEASIBILITY.md Q2.
 */

/**
 * `process.env.NEXT_PUBLIC_*` must appear as a static, literal property
 * access at each call site — webpack's DefinePlugin only inlines those
 * exact expressions into the client bundle. Reading via a dynamic key
 * (`process.env[name]`) is invisible to that replacement, so the value
 * silently comes back `undefined` in the browser even though the same
 * code works fine server-side (where real `process.env` exists at
 * runtime). This function takes the already-read value, never the name,
 * to avoid reintroducing that bug.
 */
function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy apps/web/.env.example to .env.local and fill it in.`
    );
  }
  return value;
}

export const CLUSTER = (process.env.NEXT_PUBLIC_CLUSTER ?? "localnet") as
  | "localnet"
  | "devnet";

export const RPC_URL = requireEnv("NEXT_PUBLIC_RPC_URL", process.env.NEXT_PUBLIC_RPC_URL);

export const PERMA_PROGRAM_ID = new PublicKey(
  requireEnv("NEXT_PUBLIC_PERMA_PROGRAM_ID", process.env.NEXT_PUBLIC_PERMA_PROGRAM_ID)
);

export const WHIRLPOOL = new PublicKey(
  requireEnv("NEXT_PUBLIC_WHIRLPOOL", process.env.NEXT_PUBLIC_WHIRLPOOL)
);

/**
 * Pyth `PriceUpdateV2` (SOL/USD) every `mint_position` must pass (ADR-0004).
 * Defaults to the localnet mock receiver's tag-0 feed, kept fresh by
 * `node scripts/mock-price.mjs --loop`. Devnet has no usable value yet: its
 * pool trades far from real SOL/USD (ticket P3-DEVNET-POOL-PRICE).
 */
export const PRICE_UPDATE = new PublicKey(
  process.env.NEXT_PUBLIC_PRICE_UPDATE ?? "2SicEErwKeJkYv3ZUL35axMrGxqeKKUqsq3K7UH88Jrf"
);

/** The Orca Whirlpool program. Public, stable, same address on every cluster. */
export const WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
);

/** Number of ticks per Orca TickArray. Fixed by the Whirlpool program itself. */
export const TICK_ARRAY_SIZE = 88;

/** `state::leg_type` — matches programs/perma/src/state.rs exactly. */
export const LEG_SHORT = 0;
export const LEG_LONG = 1;

/** `state::position_status` — matches programs/perma/src/state.rs exactly. */
export const STATUS_OPEN = 0;
export const STATUS_CLOSED = 1;
export const STATUS_PENDING_PREMIUM = 2;

/** `risk::MAX_OPEN_LONGS` — matches programs/perma/src/risk.rs exactly. */
export const MAX_OPEN_LONGS = 8;

/** `premium::PREMIUM_SCALE` — matches programs/perma/src/premium.rs exactly. */
export const PREMIUM_SCALE = 1_000_000_000_000n;

/**
 * `initialize_tick_array`'s 8-byte Anchor discriminator, from the vendored
 * `orca_whirlpools_client` 8.0.0 crate
 * (generated/instructions/initialize_tick_array.rs). Verified against the
 * crate source directly, not assumed — Orca has no published TS IDL we
 * depend on here, so this is the one place a raw discriminator is hand-coded.
 */
export const INITIALIZE_TICK_ARRAY_DISCRIMINATOR = Uint8Array.from([
  11, 188, 193, 214, 141, 91, 149, 184,
]);

export const EXPLORER_BASE = "https://explorer.solana.com";
