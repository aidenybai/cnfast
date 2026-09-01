import { runSuite } from "./lib/harness";
import { microWorkloads } from "./lib/workloads";

await runSuite(microWorkloads());
