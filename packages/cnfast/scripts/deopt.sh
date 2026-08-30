#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== tracing deopts (best-of-1, short run) =="
BENCH_BEST_OF=1 BENCH_TIME_MS=300 \
  node --import tsx --trace-deopt bench/cn.bench.ts 2>&1 \
  | grep -i "deoptimizing" \
  | grep -E "resolveClassValue|clsx|mergeClassList|computeClassDescriptor|parseClassName|getClassGroupId|getGroupRecursive|sortModifiers|toValue|twJoin|tailwindMerge|getConflictingClassGroupIds" \
  | sed -E 's/0x[0-9a-f]+//g; s/opt id [0-9]+//g; s/sfi = [0-9]*//g; s/bytecode offset [0-9]+//g; s/deopt exit [0-9]+//g; s/FP to SP delta [0-9]+//g' \
  | sort | uniq -c | sort -rn \
  || echo "No deopts found in cnfast hot-path frames."
