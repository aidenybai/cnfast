import { runSuite } from "./lib/harness";
import { corpusWorkloads, gridWorkloads, microWorkloads, pageWorkloads } from "./lib/workloads";

// Comprehensive suite: micro extremes + real-app corpora + real page render sequences + a
// conflict-heavy live data grid, measured through one DCE-safe harness with a single geomean.
// SSR (React) lives in its own entry because it pulls in react-dom; run `pnpm bench:ssr`.
const workloads = [
  ...microWorkloads(),
  ...corpusWorkloads(),
  ...pageWorkloads(),
  ...gridWorkloads(),
];

await runSuite(workloads, process.env.BENCH_LABEL ?? "all");
