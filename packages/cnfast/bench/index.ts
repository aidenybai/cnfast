import { runSuite } from "./lib/harness";
import { corpusWorkloads, gridWorkloads, microWorkloads, pageWorkloads } from "./lib/workloads";

const workloads = [
  ...microWorkloads(),
  ...corpusWorkloads(),
  ...pageWorkloads(),
  ...gridWorkloads(),
];

await runSuite(workloads, process.env.BENCH_LABEL ?? "all");
