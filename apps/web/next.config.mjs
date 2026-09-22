import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCALNET_WALLET_MODULE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "src/components/wallet/LocalnetKeypairWallet.ts"
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // @solana/web3.js and wallet-adapter packages assume Node-style module
    // resolution in a few internal paths; harmless fallbacks for the browser bundle.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, os: false, path: false };

    // @solana/wallet-adapter-react bundles Mobile Wallet Adapter (MWA) support
    // by default via @solana-mobile/wallet-adapter-mobile, which pulls in
    // @solana/kit — and the exact versions yarn resolves here have a broken
    // export (`getTransactionMessageComputeUnitLimit` missing from
    // @solana/transaction-messages), which fails the build outright. This
    // Fair MVP doesn't need mobile deep-link wallet connection (Wallet
    // Standard auto-detection covers every desktop browser extension), so
    // the module is aliased out rather than worked around with a version
    // pin that could drift back out of sync on the next `yarn upgrade`.
    // The localnet CLI-keypair wallet adapter exists for local development
    // only. On a devnet build its dynamic import already sits in a statically
    // dead branch, but webpack would still emit the chunk; aliasing the module
    // to `false` means its code is never built. Anything other than an
    // explicit "devnet" keeps it (the dev default is localnet).
    if (process.env.NEXT_PUBLIC_CLUSTER === "devnet") {
      config.resolve.alias = {
        ...config.resolve.alias,
        [LOCALNET_WALLET_MODULE]: false,
      };
    }

    config.resolve.alias = {
      ...config.resolve.alias,
      "@solana-mobile/wallet-adapter-mobile": false,
    };
    return config;
  },
};

export default nextConfig;
