import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderBenchChart, type BenchReport } from "./lib/render-bench-chart";

const jsonPath = fileURLToPath(new URL("../bench/latest.json", import.meta.url));
const svgPath = fileURLToPath(new URL("../bench/chart.svg", import.meta.url));

const report = JSON.parse(readFileSync(jsonPath, "utf8")) as BenchReport;
writeFileSync(svgPath, await renderBenchChart(report));

console.log(`wrote ${svgPath}`);
