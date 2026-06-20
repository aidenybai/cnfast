#!/usr/bin/env bash
# Autoresearch optimization iteration:
#   1. parity gate (full test suite incl. differential fuzz vs real twMerge)
#   2. benchmark (best-of-N) vs clsx + tailwind-merge, appended to bench/results.jsonl
#   3. bundle size vs clsx + tailwind-merge
# Usage: scripts/optimize-iter.sh <label>
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
