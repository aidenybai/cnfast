import { runSuite } from "./lib/harness";
import { getToggleWorkloads } from "./workloads/toggle-workloads";

await runSuite(getToggleWorkloads(), process.env.BENCH_LABEL ?? "toggle");
