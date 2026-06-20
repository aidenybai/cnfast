import { appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Bench } from "tinybench";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { cn } from "../../src/index.js";

export type ClassListArgs = (string | number | false | null | undefined)[];
export type Impl = (...args: ClassListArgs) => string;

export const referenceCn: Impl = (...inputs) => twMerge(clsx(inputs));

export const BEST_OF = Number(process.env.BENCH_BEST_OF ?? 3);
export const TIME_MS = Number(process.env.BENCH_TIME_MS ?? 800);
export const LABEL = process.env.BENCH_LABEL ?? "adhoc";

export const gitSha = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();

const resultsPath = fileURLToPath(new URL("../results.jsonl", import.meta.url));

// DCE guard. `cn` is side-effect-free on inputs that bypass its cache (single bare tokens,
// no-op merges), so a benchmark that discards results lets V8/JSC dead-code-eliminate those
// calls and report wildly inflated throughput. Every workload MUST return a numeric sink (the
// summed length of its results); we accumulate it into this module global and read it at the end
// via `keepAlive`, which makes the whole call chain observable and defeats DCE.
let sink = 0;
export const keepAlive = (): void => {
  if (sink === -1) throw new Error(`unreachable ${sink}`);
};

const meanOps = (task: { result?: unknown }): number => {
  const result = task.result;
  return result && typeof result === "object" && "throughput" in result
    ? (result as { throughput: { mean: number } }).throughput.mean
    : Number.NaN;
};

export interface Workload {
  /** Coarse bucket for grouped reporting, e.g. "micro", "corpus", "page", "grid". */
  group: string;
  /** Row label within the group. */
  name: string;
  /** Optional extra detail (call count, unique keys, ...). */
  meta?: string;
  /**
   * Runs one iteration and returns a numeric sink (typically the summed `.length` of every result).
   * MUST consume every `impl(...)` result so the harness can defeat dead-code elimination.
   */
  run: (impl: Impl) => number;
}

export interface WorkloadResult {
  group: string;
  name: string;
  meta?: string;
  fastcn: number;
  reference: number;
  speedup: number;
}

// Best-of-N ops/s for fastcn vs the reference over one `run`. The `sink +=` accumulation is what
// makes the comparison DCE-safe, so every benchmark in the repo should go through here.
export const benchRun = async (
  run: (impl: Impl) => number,
): Promise<{ fastcn: number; reference: number }> => {
  let fastcn = 0;
  let reference = 0;
  for (let attempt = 0; attempt < BEST_OF; attempt++) {
    const bench = new Bench({ time: TIME_MS, warmupTime: 150 });
    bench
      .add("fastcn", () => {
        sink += run(cn);
      })
      .add("reference", () => {
        sink += run(referenceCn);
      });
    await bench.run();
    fastcn = Math.max(fastcn, meanOps(bench.tasks[0]!));
    reference = Math.max(reference, meanOps(bench.tasks[1]!));
  }
  return { fastcn, reference };
};

// Best-of-N ops/s for a single sink-returning function, DCE-safe via the shared sink. Used by
// benchmarks (e.g. tagged templates) where the two sides have different call shapes and so cannot
// share one `run(impl)`.
export const benchOne = async (run: () => number): Promise<number> => {
  let best = 0;
  for (let attempt = 0; attempt < BEST_OF; attempt++) {
    const bench = new Bench({ time: TIME_MS, warmupTime: 150 });
    bench.add("fn", () => {
      sink += run();
    });
    await bench.run();
    best = Math.max(best, meanOps(bench.tasks[0]!));
  }
  return best;
};

const benchWorkload = async (workload: Workload): Promise<WorkloadResult> => {
  const { fastcn, reference } = await benchRun(workload.run);
  return {
    group: workload.group,
    name: workload.name,
    meta: workload.meta,
    fastcn,
    reference,
    speedup: fastcn / reference,
  };
};

const geomean = (values: number[]): number => {
  if (values.length === 0) return Number.NaN;
  let logSum = 0;
  for (let index = 0; index < values.length; index++) logSum += Math.log(values[index]!);
  return Math.exp(logSum / values.length);
};

const printSummary = (results: WorkloadResult[], suiteLabel: string): void => {
  const byGroup = new Map<string, WorkloadResult[]>();
  for (const result of results) {
    const bucket = byGroup.get(result.group) ?? [];
    bucket.push(result);
    byGroup.set(result.group, bucket);
  }

  console.log(`\nlabel=${suiteLabel} sha=${gitSha} best-of-${BEST_OF} @ ${TIME_MS}ms`);
  for (const [group, rows] of byGroup) {
    console.log(`\n== ${group} ==`);
    console.table(
      rows.map((row) => ({
        workload: row.meta ? `${row.name} ${row.meta}` : row.name,
        "fastcn ops/s": Math.round(row.fastcn).toLocaleString("en-US"),
        "reference ops/s": Math.round(row.reference).toLocaleString("en-US"),
        speedup: `${row.speedup.toFixed(2)}x`,
      })),
    );
  }

  const speedups = results
    .map((result) => result.speedup)
    .filter((value) => Number.isFinite(value));
  const overall = geomean(speedups);
  const slowest = results.reduce((min, row) => (row.speedup < min.speedup ? row : min));
  console.log(
    `\noverall: ${overall.toFixed(2)}x geomean across ${speedups.length} workloads ` +
      `(worst: ${slowest.name} ${slowest.speedup.toFixed(2)}x)`,
  );
};

export const runSuite = async (
  workloads: Workload[],
  suiteLabel: string = LABEL,
): Promise<WorkloadResult[]> => {
  const timestamp = new Date().toISOString();
  const results: WorkloadResult[] = [];
  for (const workload of workloads) {
    const result = await benchWorkload(workload);
    results.push(result);
    appendFileSync(
      resultsPath,
      `${JSON.stringify({
        timestamp,
        label: suiteLabel,
        gitSha,
        group: result.group,
        corpus: result.meta ? `${result.name} ${result.meta}` : result.name,
        fastcn: result.fastcn,
        reference: result.reference,
        speedup: result.speedup,
      })}\n`,
    );
  }
  printSummary(results, suiteLabel);
  keepAlive();
  return results;
};
