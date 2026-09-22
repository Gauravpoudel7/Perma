// Test-only env defaults so lib/constants.ts's requireEnv() doesn't throw
// when pure-function modules (lib/pda.ts, lib/perma.ts) are imported by unit
// tests. These are never used to send a real transaction — no test in this
// suite connects to a live RPC.
process.env.NEXT_PUBLIC_CLUSTER ??= "localnet";
process.env.NEXT_PUBLIC_RPC_URL ??= "http://127.0.0.1:8899";
process.env.NEXT_PUBLIC_PERMA_PROGRAM_ID ??= "4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt";
process.env.NEXT_PUBLIC_WHIRLPOOL ??= "2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G";
// lib/indexerApi.ts reads this once at module load. Set here so the client is
// "configured" under test; every test stubs `fetch`, so nothing is requested.
process.env.NEXT_PUBLIC_INDEXER_URL ??= "http://127.0.0.1:8787/v1";
