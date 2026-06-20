import { runSuite } from "./lib/harness";
import { microWorkloads } from "./lib/workloads";

// Micro extremes: cache-hit re-renders vs all-miss merge engine.
await runSuite(microWorkloads());
