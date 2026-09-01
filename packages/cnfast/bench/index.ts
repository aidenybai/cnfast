import { runSuite } from "./lib/harness";
import { corpusWorkloads, gridWorkloads, microWorkloads, pageWorkloads } from "./lib/workloads";
import { getCacheWorkloads } from "./workloads/cache-workloads";
import { getCvaWorkloads } from "./workloads/cva-workloads";
import { getInputShapeWorkloads } from "./workloads/input-shape-workloads";
import { getMergeSyntaxWorkloads } from "./workloads/merge-syntax-workloads";
import { getResultReuseWorkloads } from "./workloads/result-reuse-workloads";
import { getToggleWorkloads } from "./workloads/toggle-workloads";

const workloads = [
  ...microWorkloads(),
  ...getInputShapeWorkloads(),
  ...getMergeSyntaxWorkloads(),
  ...getCacheWorkloads(),
  ...getToggleWorkloads(),
  ...getResultReuseWorkloads(),
  ...getCvaWorkloads(),
  ...corpusWorkloads(),
  ...pageWorkloads(),
  ...gridWorkloads(),
];

await runSuite(workloads, process.env.BENCH_LABEL ?? "all");
