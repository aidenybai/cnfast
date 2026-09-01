import { appendFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Bench } from "tinybench";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { cn, type ClassValue } from "../../src/index.js";
import {
  BENCHMARK_WARMUP_TIME_MS,
  DEFAULT_BENCHMARK_ATTEMPT_COUNT,
  DEFAULT_BENCHMARK_TIME_MS,
} from "../constants";
import { getGeometricMean } from "../utils/get-geometric-mean";

export type ClassListArgs = ClassValue[];
export interface ClassNameImplementation {
  (...classListArguments: ClassListArgs): string;
}

export interface WorkloadImplementationPair {
  cnfast: ClassNameImplementation;
  reference: ClassNameImplementation;
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

const defaultImplementations: WorkloadImplementationPair = { cnfast: cn, reference: referenceCn };

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
const shouldRecordResults = process.env.BENCH_RECORD_RESULTS !== "0";

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
  classListCases?: ClassListArgs[];
  implementations?: WorkloadImplementationPair;
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
  implementations: WorkloadImplementationPair = defaultImplementations,
): Promise<ImplementationBenchmarkResult> => {
  let cnfast = 0;
  let reference = 0;
  for (let attempt = 0; attempt < BENCHMARK_ATTEMPT_COUNT; attempt++) {
    const bench = new Bench({
      time: BENCHMARK_TIME_MS,
      warmupTime: BENCHMARK_WARMUP_TIME_MS,
    });
    const addCnfast = (): void => {
      bench.add("cnfast", () => {
        resultLengthSink += runWorkload(implementations.cnfast);
      });
    };
    const addReference = (): void => {
      bench.add("reference", () => {
        resultLengthSink += runWorkload(implementations.reference);
      });
    };
    if (attempt % 2 === 0) {
      addCnfast();
      addReference();
    } else {
      addReference();
      addCnfast();
    }
    await bench.run();
    cnfast = Math.max(cnfast, getMeanOperationsPerSecond(bench.getTask("cnfast")!));
    reference = Math.max(reference, getMeanOperationsPerSecond(bench.getTask("reference")!));
  }
  return { cnfast, reference };
};

const runWorkloadBenchmark = async (workload: Workload): Promise<WorkloadResult> => {
  const { cnfast, reference } = await runImplementationBenchmark(
    workload.run,
    workload.implementations,
  );
  return {
    group: workload.group,
    name: workload.name,
    meta: workload.meta,
    cnfast,
    reference,
    speedup: cnfast / reference,
  };
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
    const groupSpeedup = getGeometricMean(groupResults.map((result) => result.speedup));
    const slowestGroupResult = groupResults.reduce((slowest, result) =>
      result.speedup < slowest.speedup ? result : slowest,
    );
    console.log(
      `${group}: ${groupSpeedup.toFixed(2)}x geomean across ${groupResults.length} workloads ` +
        `(worst: ${slowestGroupResult.name} ${slowestGroupResult.speedup.toFixed(2)}x)`,
    );
  }

  const workloadSpeedups = workloadResults
    .map((result) => result.speedup)
    .filter((value) => Number.isFinite(value));
  const overallSpeedup = getGeometricMean(workloadSpeedups);
  const groupSpeedups: number[] = [];
  for (const groupResults of resultsByGroup.values()) {
    groupSpeedups.push(getGeometricMean(groupResults.map((result) => result.speedup)));
  }
  const groupBalancedSpeedup = getGeometricMean(groupSpeedups);
  const slowestResult = workloadResults.reduce((slowest, result) =>
    result.speedup < slowest.speedup ? result : slowest,
  );
  console.log(
    `\noverall: ${groupBalancedSpeedup.toFixed(2)}x group-balanced geomean across ` +
      `${groupSpeedups.length} groups and ${workloadSpeedups.length} workloads\n` +
      `workload geomean: ${overallSpeedup.toFixed(2)}x ` +
      `(worst: ${slowestResult.name} ${slowestResult.speedup.toFixed(2)}x)`,
  );
};

const knownDivergentInputs = new Set(
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../known-parity-divergences.json", import.meta.url)),
        "utf8",
      ),
    ) as ClassListArgs[]
  ).map((classListArguments) => JSON.stringify(classListArguments)),
);

const verifyWorkloads = (workloads: Workload[]): void => {
  let knownDivergenceCount = 0;
  for (const workload of workloads) {
    let hasKnownDivergence = false;
    const implementations = workload.implementations ?? defaultImplementations;
    if (workload.classListCases) {
      for (let index = 0; index < workload.classListCases.length; index++) {
        const classListArguments = workload.classListCases[index]!;
        const cnfastResult = implementations.cnfast(...classListArguments);
        const referenceResult = implementations.reference(...classListArguments);
        if (cnfastResult !== referenceResult) {
          if (knownDivergentInputs.has(JSON.stringify(classListArguments))) {
            knownDivergenceCount++;
            hasKnownDivergence = true;
            continue;
          }
          throw new Error(
            `${workload.group}/${workload.name} case ${index} differs:\n` +
              `input: ${JSON.stringify(classListArguments)}\n` +
              `cnfast: ${JSON.stringify(cnfastResult)}\n` +
              `reference: ${JSON.stringify(referenceResult)}`,
          );
        }
      }
    }
    if (hasKnownDivergence) continue;
    const cnfastChecksum = workload.run(implementations.cnfast);
    const referenceChecksum = workload.run(implementations.reference);
    if (cnfastChecksum !== referenceChecksum) {
      throw new Error(
        `${workload.group}/${workload.name} checksum differs: ` +
          `cnfast=${cnfastChecksum}, reference=${referenceChecksum}`,
      );
    }
  }
  if (knownDivergenceCount > 0) {
    console.log(`allowed ${knownDivergenceCount} known pinned-reference divergences`);
  }
};

export const runSuite = async (
  workloads: Workload[],
  suiteLabel: string = BENCHMARK_LABEL,
): Promise<WorkloadResult[]> => {
  verifyWorkloads(workloads);
  const timestamp = new Date().toISOString();
  const workloadResults: WorkloadResult[] = [];
  for (const workload of workloads) {
    const workloadResult = await runWorkloadBenchmark(workload);
    workloadResults.push(workloadResult);
    if (shouldRecordResults) {
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
  }
  printSummary(workloadResults, suiteLabel);
  keepAlive();
  return workloadResults;
};
