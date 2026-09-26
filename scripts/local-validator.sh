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

# ADR-0004: the mock Pyth receiver is loaded at the real receiver address.
# Refuse to start without it - otherwise every mint fails OracleUnavailable and
# the oracle rejection tests pass for the wrong reason.
MOCK_PYTH=target/mock/mock_pyth_receiver.so
if [[ ! -f "$MOCK_PYTH" ]]; then
  echo "missing $MOCK_PYTH - build it first:" >&2
  echo "  cargo build-sbf --arch v0 --tools-version v1.57 --manifest-path tests/mock-pyth-receiver/Cargo.toml --sbf-out-dir target/mock" >&2
  exit 1
fi

pkill -f solana-test-validator 2>/dev/null || true
sleep 1
rm -rf test-ledger

ARGS=(
  --reset --quiet
  --url https://api.devnet.solana.com
  --clone-upgradeable-program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
  --clone FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR   # WhirlpoolsConfig
  --account 2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G tests/fixtures/pool.json   # snapshot: allowlisted SOL/devUSDC pool
  --account 3uyTv2Pi3pb6Gc2emKiYU8gW845M1HeMMyFr2MTrDGh4 tests/fixtures/pool-vault-a.json   # snapshot: its token_vault_a
  --account 63GvSvGYTsfesX1kmesdtfxHbBQBsFpZT1wVNhNADT5C tests/fixtures/pool-vault-b.json   # snapshot: its token_vault_b
  --clone So11111111111111111111111111111111111111112   # WSOL mint
  --clone BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k   # devUSDC mint
  --clone EgxU92G34jw6QDG9RuTX9StFg1PmHuDqkRKAE5kVEiZ4   # pool with ACTIVE rewards
  --clone 3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt   # a real, UNallowlisted pool
  --account 86pYzhWoHDwaKbYMbM4gNC7EQTQgbv8WTG5rRjVNH571 tests/fixtures/tick-array-m40832.json   # snapshot: TickArray -40832
  --account 49ixSQnGC2AEzgwQAeHkDnLYJYKtB2c9rSgpb7PncFPv tests/fixtures/tick-array-m38720.json   # snapshot: TickArray -38720
  --account ACkArMv6JBtNTM64qLYnNirkMyWgYHUJ9x6CMbLPKZGy tests/fixtures/tick-array-m39424.json   # snapshot: TickArray -39424
  --account J93MdzNbVkKHBh3KwWwS7Y7CjqtqfFHwd1zHgFgw3UZQ tests/fixtures/user-a.json
  --account A728HNbbk6AjiqTsqNt5FbD7cz7xNpeXrx35qetgLcmX tests/fixtures/user-b.json
  --account 3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY tests/fixtures/vault-a.json
  --account HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR tests/fixtures/vault-b.json
  --bpf-program rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ "$MOCK_PYTH"   # mock Pyth receiver
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
