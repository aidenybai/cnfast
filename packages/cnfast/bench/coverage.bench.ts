import { runSuite } from "./lib/harness";
import { getCacheWorkloads } from "./workloads/cache-workloads";
import { getInputShapeWorkloads } from "./workloads/input-shape-workloads";
import { getMergeSyntaxWorkloads } from "./workloads/merge-syntax-workloads";
import { getResultReuseWorkloads } from "./workloads/result-reuse-workloads";
import { getToggleWorkloads } from "./workloads/toggle-workloads";

await runSuite(
  [
    ...getInputShapeWorkloads(),
    ...getMergeSyntaxWorkloads(),
    ...getCacheWorkloads(),
    ...getToggleWorkloads(),
    ...getResultReuseWorkloads(),
  ],
  process.env.BENCH_LABEL ?? "coverage",
);
