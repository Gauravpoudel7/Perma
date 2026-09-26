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
 * Localnet mock receiver tag-0 feed. Kept fresh by `node scripts/mock-price.mjs --loop`.
 * Never deploy this account, or the mock program, to Solana-devnet (ADR-0004).
 */
export const LOCALNET_MOCK_PRICE_UPDATE_ADDRESS = "2SicEErwKeJkYv3ZUL35axMrGxqeKKUqsq3K7UH88Jrf";

/**
 * Pyth's sponsored SOL/USD `PriceUpdateV2` on Solana-devnet: push-oracle PDA
 * `[shard 0, feed id]` under `pythWSnsw…`, owned by the receiver `rec5EKM…`.
 * ADR-0004 feed id. It is often older than 60s, so a P3 mint posts a fresh
 * full-verification update when this account is stale (`lib/pythUpdate.ts`).
 */
export const DEVNET_SOL_USD_PRICE_UPDATE_ADDRESS = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE";

/**
 * Which `PriceUpdateV2` address a build uses when the caller does not pass one.
 *
 * `NEXT_PUBLIC_PRICE_UPDATE` wins when it is non-empty. Otherwise Solana-devnet
 * uses the sponsored SOL/USD feed and every other cluster uses the localnet mock.
 * `process.env.NEXT_PUBLIC_*` is a static property access so Next inlines it.
 */
export function defaultPriceUpdateAddress(
  cluster: string = process.env.NEXT_PUBLIC_CLUSTER ?? "localnet",
  override: string | undefined = process.env.NEXT_PUBLIC_PRICE_UPDATE
): string {
  const chosen = override?.trim();
  if (chosen) return chosen;
  return cluster === "devnet" ? DEVNET_SOL_USD_PRICE_UPDATE_ADDRESS : LOCALNET_MOCK_PRICE_UPDATE_ADDRESS;
}

/**
 * Pyth `PriceUpdateV2` (SOL/USD) for a P3 `mint_position` (ADR-0004).
 * `mintExpectsPriceUpdate` decides whether a mint includes this key.
 * On Solana-devnet with the flag on, `planMintPriceUpdate` may replace it
 * with a `post_update` account signed together with the mint.
 */
export const PRICE_UPDATE = new PublicKey(defaultPriceUpdateAddress());

/**
 * Whether `mint_position` must include the P3 `price_update` account.
 *
 * The checked-in IDL is P3: `price_update` is a required named account. A
 * pre-P3 program has no such account: Anchor still appends the meta, the
 * program reads it as `remaining_accounts`, and the mint fails with
 * UnexpectedRemainingAccounts (6024) before the transaction lands.
 *
 * Default: include on every cluster except `devnet`. Solana-devnet runs P3
 * since 2026-09-25 (`docs/audits/P3-DEVNET-POOL-PRICE.md`), so a devnet
 * build sets `NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE=1`. `=0` forces the
 * pre-P3 account list on any cluster (including localnet).
 *
 * `process.env.NEXT_PUBLIC_*` is read as a static property access so Next
 * inlines it into the client bundle. See the note on `requireEnv`.
 */
export function mintExpectsPriceUpdate(
  cluster: string = process.env.NEXT_PUBLIC_CLUSTER ?? "localnet",
  flag: string | undefined = process.env.NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE
): boolean {
  const override = flag?.trim().toLowerCase();
  if (override === "1" || override === "true") return true;
  if (override === "0" || override === "false") return false;
  return cluster !== "devnet";
}

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
