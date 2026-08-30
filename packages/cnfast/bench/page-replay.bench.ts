import { runSuite } from "./lib/harness";
import { pageWorkloads } from "./lib/workloads";

const workloads = pageWorkloads();
if (workloads.length === 0) {
  console.error("No frozen pages. Capture first: pnpm bench:capture");
  process.exit(1);
}

await runSuite(workloads, process.env.BENCH_LABEL ?? "page");
