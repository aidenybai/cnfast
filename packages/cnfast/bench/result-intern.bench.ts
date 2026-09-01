import { runSuite } from "./lib/harness";
import { getResultReuseWorkloads } from "./workloads/result-reuse-workloads";

await runSuite(getResultReuseWorkloads(), process.env.BENCH_LABEL ?? "result-reuse");
