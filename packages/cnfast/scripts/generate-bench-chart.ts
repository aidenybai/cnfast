import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  corpusWorkloads,
  gridWorkloads,
  microWorkloads,
  pageWorkloads,
} from "../bench/lib/workloads";
import { getCacheWorkloads } from "../bench/workloads/cache-workloads";
import { getCvaWorkloads } from "../bench/workloads/cva-workloads";
import { getInputShapeWorkloads } from "../bench/workloads/input-shape-workloads";
import { getMergeSyntaxWorkloads } from "../bench/workloads/merge-syntax-workloads";
import { getResultReuseWorkloads } from "../bench/workloads/result-reuse-workloads";
import { getToggleWorkloads } from "../bench/workloads/toggle-workloads";
import {
  CHART_BENCHMARK_MINIMUM_TIME_MS,
  CHART_BENCHMARK_WARMUP_TIME_MS,
} from "../bench/constants";
import { Bench } from "tinybench";
import {
  BENCHMARK_ATTEMPT_COUNT,
  BENCHMARK_TIME_MS,
  GIT_COMMIT_HASH,
  referenceCn,
  runSuite,
  type WorkloadResult,
} from "../bench/lib/harness";
import { getGeometricMean } from "../bench/utils/get-geometric-mean";
import { cn } from "../src/index.js";
import { measureBundles } from "./lib/measure-bundle";
import {
  renderBenchChart,
  type BenchChartRow,
  type BenchForm,
  type BenchReport,
} from "./lib/render-bench-chart";

const runtimeName = process.versions.bun
  ? `Bun ${process.versions.bun}`
  : `Node ${process.versions.node}`;

const getWorkloadResult = (
  workloadResults: WorkloadResult[],
  group: string,
  nameIncludes: string,
): WorkloadResult => {
  const matchingResult = workloadResults.find(
    (result) => result.group === group && result.name.includes(nameIncludes),
  );
  if (!matchingResult) throw new Error(`missing workload: ${group}/${nameIncludes}`);
  return matchingResult;
};

const aggregateWorkloadGroup = (
  workloadResults: WorkloadResult[],
  group: string,
): WorkloadResult => {
  const groupResults = workloadResults.filter((result) => result.group === group);
  if (groupResults.length === 0) throw new Error(`no workloads in group: ${group}`);
  return {
    group,
    name: group,
    cnfast: getGeometricMean(groupResults.map((result) => result.cnfast)),
    reference: getGeometricMean(groupResults.map((result) => result.reference)),
    speedup: getGeometricMean(groupResults.map((result) => result.speedup)),
  };
};

const createChartRow = (
  result: WorkloadResult,
  label: string,
  detail: string,
  cacheState?: "cached" | "uncached",
  emphasis = false,
): BenchChartRow => ({
  label,
  detail,
  cnfast: result.cnfast,
  reference: result.reference,
  speedup: result.speedup,
  cacheState,
  emphasis,
});

const benchmarkWorkloads = [
  ...microWorkloads(),
  ...getInputShapeWorkloads(),
  ...getMergeSyntaxWorkloads(),
  ...getCacheWorkloads(),
  ...getToggleWorkloads(),
  ...getResultReuseWorkloads(),
  ...getCvaWorkloads(),
  ...corpusWorkloads(),
  ...pageWorkloads(),
  ...gridWorkloads(),
];

const workloadResults = await runSuite(benchmarkWorkloads, "chart");
const bundleComparison = await measureBundles();

const RENDER_VARIANTS: (string | false)[] = ["bg-blue-500", false, "bg-red-500", false];
const RENDER_BASE = "rounded-lg border bg-card px-4 py-2 text-sm font-medium shadow-sm";
let formResultLengthSum = 0;

const formBench = new Bench({
  time: Math.max(BENCHMARK_TIME_MS, CHART_BENCHMARK_MINIMUM_TIME_MS),
  warmupTime: CHART_BENCHMARK_WARMUP_TIME_MS,
});
formBench
  .add("variadic", () => {
    for (let index = 0; index < RENDER_VARIANTS.length; index++) {
      formResultLengthSum += cn(RENDER_BASE, RENDER_VARIANTS[index]!).length;
    }
  })
  .add("reference", () => {
    for (let index = 0; index < RENDER_VARIANTS.length; index++) {
      formResultLengthSum += referenceCn(RENDER_BASE, RENDER_VARIANTS[index]!).length;
    }
  });
await formBench.run();
if (formResultLengthSum < 0) throw new Error("unreachable");

const getFormOperationsPerSecond = (taskName: string): number => {
  const taskResult = formBench.getTask(taskName)?.result;
  return taskResult && "throughput" in taskResult ? taskResult.throughput.mean : Number.NaN;
};
const variadicOperationsPerSecond = getFormOperationsPerSecond("variadic");
const referenceOperationsPerSecond = getFormOperationsPerSecond("reference");

const benchmarkForms: BenchForm[] = [
  {
    label: "cnfast",
    opsPerSec: variadicOperationsPerSecond,
    speedup: variadicOperationsPerSecond / referenceOperationsPerSecond,
  },
  { label: "cn", opsPerSec: referenceOperationsPerSecond, speedup: 1 },
];

const overallSpeedup = getGeometricMean(
  workloadResults.map((result) => result.speedup).filter((value) => Number.isFinite(value)),
);
const workloadGroups = [...new Set(workloadResults.map((result) => result.group))];
const aggregatedGroupResults = workloadGroups.map((group) =>
  aggregateWorkloadGroup(workloadResults, group),
);
const groupBalancedSpeedup = getGeometricMean(
  aggregatedGroupResults.map((result) => result.speedup),
);
const groupBalancedCnfast = getGeometricMean(aggregatedGroupResults.map((result) => result.cnfast));
const groupBalancedReference = getGeometricMean(
  aggregatedGroupResults.map((result) => result.reference),
);

const chartRows: BenchChartRow[] = [
  createChartRow(
    aggregateWorkloadGroup(workloadResults, "cached"),
    "Cached workloads",
    "re-render and working sets shared by both caches",
    "cached",
  ),
  createChartRow(
    aggregateWorkloadGroup(workloadResults, "uncached"),
    "Uncached workloads",
    "working sets larger than both caches",
    "uncached",
  ),
  createChartRow(
    aggregateWorkloadGroup(workloadResults, "input shape"),
    "Input shapes",
    "strings, arrays, objects, conditionals, geomean",
    "cached",
  ),
  createChartRow(
    aggregateWorkloadGroup(workloadResults, "merge syntax"),
    "Tailwind syntax",
    "conflicts, modifiers, arbitrary forms, geomean",
    "uncached",
  ),
  createChartRow(
    aggregateWorkloadGroup(workloadResults, "cache boundary"),
    "Cache boundaries",
    "working sets that fit only one cache or rotate generations",
  ),
  createChartRow(
    aggregateWorkloadGroup(workloadResults, "toggle"),
    "Conditional renders",
    "2, 3, and 5 argument state changes, geomean",
    "cached",
  ),
  createChartRow(
    aggregateWorkloadGroup(workloadResults, "result reuse"),
    "Result reuse",
    "nested calls and keyed consumers, geomean",
    "uncached",
  ),
  createChartRow(
    aggregateWorkloadGroup(workloadResults, "cva"),
    "CVA variants",
    "class-variance-authority port, geomean",
    "cached",
  ),
  createChartRow(
    aggregateWorkloadGroup(workloadResults, "corpus"),
    "Component corpus",
    "harvested app source, geomean",
  ),
  createChartRow(
    aggregateWorkloadGroup(workloadResults, "page"),
    "Page render",
    "real call sequence, geomean",
  ),
  createChartRow(
    getWorkloadResult(workloadResults, "grid", "dynamic"),
    "Live data grid",
    "12K cells, live arbitrary values",
    "uncached",
  ),
  createChartRow(
    {
      group: "overall",
      name: "overall",
      cnfast: groupBalancedCnfast,
      reference: groupBalancedReference,
      speedup: groupBalancedSpeedup,
    },
    "Overall",
    `group-balanced mean of ${workloadGroups.length} groups and ${workloadResults.length} workloads`,
    undefined,
    true,
  ),
];

const benchmarkReport: BenchReport = {
  generatedAt: new Date().toISOString(),
  gitSha: GIT_COMMIT_HASH,
  runtime: runtimeName,
  bestOf: BENCHMARK_ATTEMPT_COUNT,
  timeMs: BENCHMARK_TIME_MS,
  workloadCount: workloadResults.length,
  workloadGroupCount: workloadGroups.length,
  overallSpeedup,
  groupBalancedSpeedup,
  bundle: {
    cnfastGzip: bundleComparison.cnfast.gzipped,
    referenceGzip: bundleComparison.reference.gzipped,
  },
  rows: chartRows,
  forms: benchmarkForms,
};

const jsonPath = fileURLToPath(new URL("../bench/latest.json", import.meta.url));
const svgPath = fileURLToPath(new URL("../bench/chart.svg", import.meta.url));

writeFileSync(jsonPath, `${JSON.stringify(benchmarkReport, null, 2)}\n`);
writeFileSync(svgPath, await renderBenchChart(benchmarkReport));

console.log(`\nwrote ${jsonPath}`);
console.log(`wrote ${svgPath}`);
