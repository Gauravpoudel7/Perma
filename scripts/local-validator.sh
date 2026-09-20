#!/usr/bin/env bash
# Start the local validator with the exact clone + fixture set the integration
# suites need. Mirrors `[test.validator]` in Anchor.toml - keep the two in sync.
#
#   ./scripts/local-validator.sh            # shared ledger, all suites
#   ./scripts/local-validator.sh --detach    # background, logs to test-ledger.log
#
# `factory-rewards.ts` allowlists a DIFFERENT pool, so running it against this
# ledger makes every other suite fail PoolNotAllowlisted. Give it its own.
set -euo pipefail
cd "$(dirname "$0")/.."

pkill -f solana-test-validator 2>/dev/null || true
sleep 1
rm -rf test-ledger

ARGS=(
  --reset --quiet
  --url https://api.devnet.solana.com
  --clone-upgradeable-program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
  --clone FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR   # WhirlpoolsConfig
  --clone 2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G   # allowlisted SOL/devUSDC pool
  --clone 3uyTv2Pi3pb6Gc2emKiYU8gW845M1HeMMyFr2MTrDGh4   # its token_vault_a
  --clone 63GvSvGYTsfesX1kmesdtfxHbBQBsFpZT1wVNhNADT5C   # its token_vault_b
  --clone So11111111111111111111111111111111111111112   # WSOL mint
  --clone BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k   # devUSDC mint
  --clone EgxU92G34jw6QDG9RuTX9StFg1PmHuDqkRKAE5kVEiZ4   # pool with ACTIVE rewards
  --clone 3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt   # a real, UNallowlisted pool
  --clone 86pYzhWoHDwaKbYMbM4gNC7EQTQgbv8WTG5rRjVNH571   # TickArray -40832
  --clone 49ixSQnGC2AEzgwQAeHkDnLYJYKtB2c9rSgpb7PncFPv   # TickArray -38720
  --clone ACkArMv6JBtNTM64qLYnNirkMyWgYHUJ9x6CMbLPKZGy   # TickArray -39424
  --account J93MdzNbVkKHBh3KwWwS7Y7CjqtqfFHwd1zHgFgw3UZQ tests/fixtures/user-a.json
  --account A728HNbbk6AjiqTsqNt5FbD7cz7xNpeXrx35qetgLcmX tests/fixtures/user-b.json
  --account 3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY tests/fixtures/vault-a.json
  --account HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR tests/fixtures/vault-b.json
)

if [[ "${1:-}" == "--detach" ]]; then
  nohup solana-test-validator "${ARGS[@]}" > test-ledger.log 2>&1 &
  for _ in $(seq 1 40); do
    sleep 1
    solana program show whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc -u localhost \
      >/dev/null 2>&1 && { echo "validator up, Orca cloned"; exit 0; }
  done
  echo "validator did not come up - see test-ledger.log" >&2
  exit 1
fi

exec solana-test-validator "${ARGS[@]}"
