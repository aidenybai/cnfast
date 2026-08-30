#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

LABEL="${1:-adhoc}"

echo "== [1/3] parity gate =="
pnpm test

echo "== [2/3] benchmark (label=$LABEL) =="
BENCH_LABEL="$LABEL" pnpm bench

echo "== [3/3] bundle size =="
pnpm size

echo "== done: $LABEL =="
