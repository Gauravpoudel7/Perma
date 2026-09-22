/**
 * Localnet only: which wallet the test fixtures actually funded.
 *
 * `scripts/make-fixtures.mjs` hand-crafts WSOL and Orca devUSDC token accounts
 * for one address, because devUSDC has no local mint authority and cannot be
 * airdropped. Connecting any other wallet gives a deposit that simulates to a
 * bare "Unexpected error". Knowing the funded address lets the UI say that
 * before the user signs. This is display-only: no gate, no transaction path.
 */

/** Static literal access — see the DefinePlugin note in `constants.ts`. */
export const LOCALNET_FUNDED_WALLET =
  process.env.NEXT_PUBLIC_LOCALNET_FUNDED_WALLET ?? null;

export type LocalnetFundingStatus =
  /** Not localnet, or no wallet connected: nothing to say. */
  | "n/a"
  /** Localnet, but nobody ran `yarn sync-fixture-wallet`, so the check cannot run. */
  | "unconfigured"
  | "funded"
  | "mismatch";

export function localnetFundingStatus(input: {
  cluster: string;
  fundedWallet: string | null;
  connectedWallet: string | null;
}): LocalnetFundingStatus {
  if (input.cluster !== "localnet" || !input.connectedWallet) return "n/a";
  if (!input.fundedWallet) return "unconfigured";
  return input.connectedWallet === input.fundedWallet ? "funded" : "mismatch";
}
