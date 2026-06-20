import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  corpusWorkloads,
  gridWorkloads,
  microWorkloads,
  pageWorkloads,
} from "../bench/lib/workloads";
import { Bench } from "tinybench";
import {
  BEST_OF,
  TIME_MS,
  gitSha,
  referenceCn,
  runSuite,
  type WorkloadResult,
} from "../bench/lib/harness";
import { cn } from "../src/index.js";
import { measureBundles } from "./lib/measure-bundle";
import {
  renderBenchChart,
  type BenchChartRow,
  type BenchForm,
  type BenchReport,
} from "./lib/render-bench-chart";

const runtime = process.versions.bun
  ? `Bun ${process.versions.bun}`
  : `Node ${process.versions.node}`;

const geomean = (values: number[]): number => {
  if (values.length === 0) return Number.NaN;
  let logSum = 0;
  for (let index = 0; index < values.length; index++) logSum += Math.log(values[index]!);
  return Math.exp(logSum / values.length);
};

const find = (results: WorkloadResult[], group: string, nameIncludes: string): WorkloadResult => {
  const match = results.find(
    (result) => result.group === group && result.name.includes(nameIncludes),
  );
  if (!match) throw new Error(`missing workload: ${group}/${nameIncludes}`);
  return match;
};

const aggregate = (results: WorkloadResult[], group: string): WorkloadResult => {
  const rows = results.filter((result) => result.group === group);
  if (rows.length === 0) throw new Error(`no workloads in group: ${group}`);
  return {
    group,
    name: group,
    cnfast: geomean(rows.map((row) => row.cnfast)),
    reference: geomean(rows.map((row) => row.reference)),
    speedup: geomean(rows.map((row) => row.speedup)),
  };
};

const toRow = (
  result: WorkloadResult,
  label: string,
  detail: string,
  emphasis = false,
): BenchChartRow => ({
  label,
  detail,
  cnfast: result.cnfast,
  reference: result.reference,
  speedup: result.speedup,
  emphasis,
});

const workloads = [
  ...microWorkloads(),
  ...corpusWorkloads(),
  ...pageWorkloads(),
  ...gridWorkloads(),
];

const results = await runSuite(workloads, "chart");
const bundle = await measureBundles();

// Same stable call site rendered three ways, so the ops/s are directly comparable: the baseline
// (clsx + tailwind-merge), cnfast's variadic call, and cnfast's identity-cached tagged template.
// All three run inside ONE Bench so they share warmup/timing and the ratio is stable across runs;
// measuring them in separate benches let JIT/thermal drift swing the cache-hit template wildly.
const TEMPLATE_VARIANTS: (string | false)[] = ["bg-blue-500", false, "bg-red-500", false];
const TEMPLATE_BASE = "rounded-lg border bg-card px-4 py-2 text-sm font-medium shadow-sm";
let formSink = 0;

const formBench = new Bench({ time: Math.max(TIME_MS, 1000), warmupTime: 300 });
formBench
  .add("template", () => {
    for (let index = 0; index < TEMPLATE_VARIANTS.length; index++) {
      const variant = TEMPLATE_VARIANTS[index]!;
      formSink += cn`rounded-lg border bg-card px-4 py-2 text-sm font-medium shadow-sm ${
        variant && variant
      }`.length;
    }
  })
  .add("variadic", () => {
    for (let index = 0; index < TEMPLATE_VARIANTS.length; index++)
      formSink += cn(TEMPLATE_BASE, TEMPLATE_VARIANTS[index]!).length;
  })
  .add("reference", () => {
    for (let index = 0; index < TEMPLATE_VARIANTS.length; index++)
      formSink += referenceCn(TEMPLATE_BASE, TEMPLATE_VARIANTS[index]!).length;
  });
await formBench.run();
if (formSink < 0) throw new Error("unreachable");

const formOps = (taskName: string): number => {
  const result = formBench.getTask(taskName)?.result;
  return result && "throughput" in result ? result.throughput.mean : Number.NaN;
};
const templateOps = formOps("template");
const variadicOps = formOps("variadic");
const referenceOps = formOps("reference");

const forms: BenchForm[] = [
  { label: "cnfast + template", opsPerSec: templateOps, speedup: templateOps / referenceOps },
  { label: "cnfast", opsPerSec: variadicOps, speedup: variadicOps / referenceOps },
  { label: "cn", opsPerSec: referenceOps, speedup: 1 },
];

const overallSpeedup = geomean(
  results.map((result) => result.speedup).filter((value) => Number.isFinite(value)),
);

const rows: BenchChartRow[] = [
  toRow(find(results, "micro", "cached"), "Cached re-render", "repeated class strings, cache hits"),
  toRow(
    find(results, "micro", "merge engine"),
    "Merge engine (cold)",
    "unique strings, every call misses",
  ),
  toRow(aggregate(results, "corpus"), "Component corpus", "harvested app source, geomean"),
  toRow(aggregate(results, "page"), "Page render", "real call sequence, geomean"),
  toRow(find(results, "grid", "dynamic"), "Live data grid", "12K cells, live arbitrary values"),
  toRow(
    {
      group: "overall",
      name: "overall",
      cnfast: geomean(results.map((result) => result.cnfast)),
      reference: geomean(results.map((result) => result.reference)),
      speedup: overallSpeedup,
    },
    "Overall",
    `geometric mean of ${results.length} workloads`,
    true,
  ),
];

const report: BenchReport = {
  generatedAt: new Date().toISOString(),
  gitSha,
  runtime,
  bestOf: BEST_OF,
  timeMs: TIME_MS,
  workloadCount: results.length,
  overallSpeedup,
  bundle: { cnfastGzip: bundle.cnfast.gzipped, referenceGzip: bundle.reference.gzipped },
  rows,
  forms,
};

const jsonPath = fileURLToPath(new URL("../bench/latest.json", import.meta.url));
const svgPath = fileURLToPath(new URL("../bench/chart.svg", import.meta.url));

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(svgPath, await renderBenchChart(report));

console.log(`\nwrote ${jsonPath}`);
console.log(`wrote ${svgPath}`);
