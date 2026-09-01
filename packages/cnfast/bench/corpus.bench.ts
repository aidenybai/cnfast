import { runSuite } from "./lib/harness";
import { corpusWorkloads } from "./lib/workloads";

const requestedCorpusNames = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));

let workloads;
try {
  workloads = corpusWorkloads(requestedCorpusNames);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (workloads.length === 0) {
  console.error("No corpora found. Extract one first, e.g.:\n\n  pnpm bench:extract calcom\n");
  process.exit(1);
}

await runSuite(workloads, process.env.BENCH_LABEL ?? "corpus");
