import {
  BaseSignerWalletAdapter,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletReadyState,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export const LOCALNET_WALLET_NAME = "Localnet CLI keypair (fixtures)" as WalletName<"Localnet CLI keypair (fixtures)">;

/**
 * The part of the adapter the connect dialog needs. It is a separate type
 * because the class uses `#private` fields, which structural typing cannot
 * see — and the dialog must not import the class as a value (that would ship
 * the adapter's code on every cluster).
 */
export interface LocalnetKeypairSigner {
  name: WalletName;
  loadSecretKey(secretKey: Uint8Array): PublicKey;
  disconnect(): Promise<void>;
}

/**
 * A wallet adapter that signs with a Solana CLI keypair the operator loads
 * from a file, for localnet only.
 *
 * It exists because Orca devUSDC cannot be minted on a local validator: the
 * fixtures forge token accounts for one address, and only that address can
 * deposit USDC. Rather than ask people to guess why a deposit fails, they can
 * act as that address here.
 *
 * The secret key lives in this object for the life of the tab and nowhere
 * else: never written to `localStorage`, never serialised, never logged,
 * never sent anywhere. Providers only registers this adapter when the build's
 * `NEXT_PUBLIC_CLUSTER` is `localnet`, so a devnet bundle does not contain it.
 */
export class LocalnetKeypairWalletAdapter extends BaseSignerWalletAdapter {
  name = LOCALNET_WALLET_NAME;
  url = "https://github.com/Gauravpoudel7/Perma#localnet-wallet";
  icon = "";
  supportedTransactionVersions = null;

  #keypair: Keypair | null = null;
  #connecting = false;
  #readyState: WalletReadyState = WalletReadyState.Loadable;

  get readyState(): WalletReadyState {
    return this.#readyState;
  }

  get connecting(): boolean {
    return this.#connecting;
  }

  get publicKey(): PublicKey | null {
    return this.#keypair?.publicKey ?? null;
  }

  get connected(): boolean {
    return this.#keypair !== null;
  }

  /** Called by the connect dialog after the operator picks a keypair file. */
  loadSecretKey(secretKey: Uint8Array): PublicKey {
    const keypair = Keypair.fromSecretKey(secretKey);
    this.#keypair = keypair;
    this.#readyState = WalletReadyState.Installed;
    this.emit("readyStateChange", this.#readyState);
    return keypair.publicKey;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    // A reload clears the in-memory key, so `autoConnect` lands here. Fail
    // with a readable reason instead of hanging on a wallet that cannot sign.
    if (!this.#keypair) {
      const error = new WalletNotReadyError(
        "Load a Solana CLI keypair file to use the localnet wallet."
      );
      this.emit("error", error);
      throw error;
    }
    this.#connecting = true;
    this.#connecting = false;
    this.emit("connect", this.#keypair.publicKey);
  }

  async disconnect(): Promise<void> {
    this.#keypair = null;
    this.#readyState = WalletReadyState.Loadable;
    this.emit("readyStateChange", this.#readyState);
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    const keypair = this.#keypair;
    if (!keypair) throw new WalletNotConnectedError();
    if (transaction instanceof VersionedTransaction) {
      transaction.sign([keypair]);
    } else {
      transaction.partialSign(keypair);
    }
    return transaction;
  }
}
