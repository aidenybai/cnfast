import { runSuite } from "./lib/harness";
import { corpusWorkloads } from "./lib/workloads";

// Raw cn throughput over class lists harvested from real app source. Positional args (not flags)
// select specific corpora, e.g. `pnpm bench:corpus calcom shadcn-ui`; none = every extracted corpus.
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

let workloads;
try {
  workloads = corpusWorkloads(requested);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (workloads.length === 0) {
  console.error("No corpora found. Extract one first, e.g.:\n\n  pnpm bench:extract calcom\n");
  process.exit(1);
}

await runSuite(workloads, process.env.BENCH_LABEL ?? "corpus");
