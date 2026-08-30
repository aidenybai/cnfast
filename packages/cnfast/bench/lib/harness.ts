import { appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Bench } from "tinybench";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { cn } from "../../src/index.js";
import {
  BENCHMARK_WARMUP_TIME_MS,
  DEFAULT_BENCHMARK_ATTEMPT_COUNT,
  DEFAULT_BENCHMARK_TIME_MS,
} from "../constants";

export type ClassListArgs = (string | number | false | null | undefined)[];
export interface ClassNameImplementation {
  (...classListArguments: ClassListArgs): string;
}

interface BenchmarkTask {
  result?: unknown;
}

interface ThroughputResult {
  throughput: {
    mean: number;
  };
}

export interface ImplementationBenchmarkResult {
  cnfast: number;
  reference: number;
}

export const referenceCn: ClassNameImplementation = (...inputs) => twMerge(clsx(inputs));

export const BENCHMARK_ATTEMPT_COUNT = Number(
  process.env.BENCH_BEST_OF ?? DEFAULT_BENCHMARK_ATTEMPT_COUNT,
);
export const BENCHMARK_TIME_MS = Number(process.env.BENCH_TIME_MS ?? DEFAULT_BENCHMARK_TIME_MS);
export const BENCHMARK_LABEL = process.env.BENCH_LABEL ?? "adhoc";

const getGitCommitHash = (): string => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

export const GIT_COMMIT_HASH = getGitCommitHash();

const resultsPath = fileURLToPath(new URL("../results.jsonl", import.meta.url));

let resultLengthSink = 0;
export const keepAlive = (): void => {
  if (resultLengthSink === -1) throw new Error(`unreachable ${resultLengthSink}`);
};

const getMeanOperationsPerSecond = (task: BenchmarkTask): number => {
  const taskResult = task.result;
  return taskResult && typeof taskResult === "object" && "throughput" in taskResult
    ? (taskResult as ThroughputResult).throughput.mean
    : Number.NaN;
};

export interface Workload {
  group: string;
  name: string;
  meta?: string;
  run: (implementation: ClassNameImplementation) => number;
}

export interface WorkloadResult {
  group: string;
  name: string;
  meta?: string;
  cnfast: number;
  reference: number;
  speedup: number;
}

export const runImplementationBenchmark = async (
  runWorkload: (implementation: ClassNameImplementation) => number,
): Promise<ImplementationBenchmarkResult> => {
  let cnfast = 0;
  let reference = 0;
  for (let attempt = 0; attempt < BENCHMARK_ATTEMPT_COUNT; attempt++) {
    const bench = new Bench({
      time: BENCHMARK_TIME_MS,
      warmupTime: BENCHMARK_WARMUP_TIME_MS,
    });
    bench
      .add("cnfast", () => {
        resultLengthSink += runWorkload(cn);
      })
      .add("reference", () => {
        resultLengthSink += runWorkload(referenceCn);
      });
    await bench.run();
    cnfast = Math.max(cnfast, getMeanOperationsPerSecond(bench.tasks[0]!));
    reference = Math.max(reference, getMeanOperationsPerSecond(bench.tasks[1]!));
  }
  return { cnfast, reference };
};

const runWorkloadBenchmark = async (workload: Workload): Promise<WorkloadResult> => {
  const { cnfast, reference } = await runImplementationBenchmark(workload.run);
  return {
    group: workload.group,
    name: workload.name,
    meta: workload.meta,
    cnfast,
    reference,
    speedup: cnfast / reference,
  };
};

const getGeometricMean = (values: number[]): number => {
  if (values.length === 0) return Number.NaN;
  let logSum = 0;
  for (let index = 0; index < values.length; index++) logSum += Math.log(values[index]!);
  return Math.exp(logSum / values.length);
};

const printSummary = (workloadResults: WorkloadResult[], suiteLabel: string): void => {
  const resultsByGroup = new Map<string, WorkloadResult[]>();
  for (const workloadResult of workloadResults) {
    const groupResults = resultsByGroup.get(workloadResult.group) ?? [];
    groupResults.push(workloadResult);
    resultsByGroup.set(workloadResult.group, groupResults);
  }

  console.log(
    `\nlabel=${suiteLabel} sha=${GIT_COMMIT_HASH} ` +
      `best-of-${BENCHMARK_ATTEMPT_COUNT} @ ${BENCHMARK_TIME_MS}ms`,
  );
  for (const [group, groupResults] of resultsByGroup) {
    console.log(`\n== ${group} ==`);
    console.table(
      groupResults.map((result) => ({
        workload: result.meta ? `${result.name} ${result.meta}` : result.name,
        "cnfast ops/s": Math.round(result.cnfast).toLocaleString("en-US"),
        "reference ops/s": Math.round(result.reference).toLocaleString("en-US"),
        speedup: `${result.speedup.toFixed(2)}x`,
      })),
    );
  }

  const workloadSpeedups = workloadResults
    .map((result) => result.speedup)
    .filter((value) => Number.isFinite(value));
  const overallSpeedup = getGeometricMean(workloadSpeedups);
  const slowestResult = workloadResults.reduce((slowest, result) =>
    result.speedup < slowest.speedup ? result : slowest,
  );
  console.log(
    `\noverall: ${overallSpeedup.toFixed(2)}x geomean across ${workloadSpeedups.length} workloads ` +
      `(worst: ${slowestResult.name} ${slowestResult.speedup.toFixed(2)}x)`,
  );
};

export const runSuite = async (
  workloads: Workload[],
  suiteLabel: string = BENCHMARK_LABEL,
): Promise<WorkloadResult[]> => {
  const timestamp = new Date().toISOString();
  const workloadResults: WorkloadResult[] = [];
  for (const workload of workloads) {
    const workloadResult = await runWorkloadBenchmark(workload);
    workloadResults.push(workloadResult);
    appendFileSync(
      resultsPath,
      `${JSON.stringify({
        timestamp,
        label: suiteLabel,
        gitSha: GIT_COMMIT_HASH,
        group: workloadResult.group,
        corpus: workloadResult.meta
          ? `${workloadResult.name} ${workloadResult.meta}`
          : workloadResult.name,
        cnfast: workloadResult.cnfast,
        reference: workloadResult.reference,
        speedup: workloadResult.speedup,
      })}\n`,
    );
  }
  printSummary(workloadResults, suiteLabel);
  keepAlive();
  return workloadResults;
};
