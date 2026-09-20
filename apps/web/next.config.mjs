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
    config.resolve.alias = {
      ...config.resolve.alias,
      "@solana-mobile/wallet-adapter-mobile": false,
    };
    return config;
  },
};

export default nextConfig;
