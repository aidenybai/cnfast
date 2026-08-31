import * as vega from "vega";
import { compile, type TopLevelSpec } from "vega-lite";

export interface BenchChartRow {
  label: string;
  detail: string;
  cnfast: number;
  reference: number;
  speedup: number;
  emphasis?: boolean;
}

export interface BenchForm {
  label: string;
  opsPerSec: number;
  speedup: number;
}

export interface BenchReport {
  generatedAt: string;
  gitSha: string;
  runtime: string;
  bestOf: number;
  timeMs: number;
  workloadCount: number;
  workloadGroupCount: number;
  overallSpeedup: number;
  groupBalancedSpeedup: number;
  bundle: { cnfastGzip: number; referenceGzip: number };
  rows: BenchChartRow[];
  forms: BenchForm[];
}

const COLOR_BACKGROUND = "#ffffff";
const COLOR_TEXT = "#111827";
const COLOR_MUTED = "#6b7280";
const COLOR_GRID = "#e5e7eb";
const COLOR_FASTCN = "#60a5fa";
const COLOR_BASELINE = "#d1d5db";

const getBarColor = (label: string): string => {
  if (label.includes("cnfast")) return COLOR_FASTCN;
  return COLOR_BASELINE;
};

const formatOperationsPerSecond = (operationsPerSecond: number): string => {
  if (operationsPerSecond >= 1_000_000) {
    return `${(operationsPerSecond / 1_000_000).toFixed(1)}M ops/s`;
  }
  if (operationsPerSecond >= 10_000) {
    return `${Math.round(operationsPerSecond / 1_000)}K ops/s`;
  }
  if (operationsPerSecond >= 1_000) {
    return `${(operationsPerSecond / 1_000).toFixed(1)}K ops/s`;
  }
  return `${Math.round(operationsPerSecond)} ops/s`;
};

const createChartSpec = (report: BenchReport): TopLevelSpec => {
  const maximumOperationsPerSecond = report.forms.reduce(
    (maximum, form) => Math.max(maximum, form.opsPerSec),
    0,
  );
  const formOrder = report.forms.map((form) => form.label);
  const formValues = report.forms.map((form) => ({
    form: form.label,
    ops: form.opsPerSec,
    color: getBarColor(form.label),
    opsLabel: formatOperationsPerSecond(form.opsPerSec),
    speedupLabel: `${form.speedup.toFixed(1)}x`,
  }));

  const baseEncoding = {
    x: {
      field: "form",
      type: "nominal" as const,
      sort: formOrder,
      axis: {
        title: null,
        labelAngle: 0,
        labelColor: COLOR_TEXT,
        labelFontSize: 12,
        labelFontWeight: "bold" as const,
        labelPadding: 10,
        domainColor: COLOR_GRID,
        ticks: false,
      },
    },
    y: {
      field: "ops",
      type: "quantitative" as const,
      scale: { domain: [0, maximumOperationsPerSecond * 1.2] },
      axis: null,
    },
  };

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    background: COLOR_BACKGROUND,
    width: 360,
    height: 320,
    padding: 22,
    title: {
      text: "cnfast on a re-rendering call site",
      subtitle: "operations per second, higher is faster",
      color: COLOR_TEXT,
      subtitleColor: COLOR_MUTED,
      fontSize: 17,
      subtitleFontSize: 12,
      anchor: "start",
      offset: 18,
    },
    data: { values: formValues },
    encoding: baseEncoding,
    layer: [
      {
        mark: { type: "bar", width: { band: 0.62 }, cornerRadiusEnd: 6 },
        encoding: { color: { field: "color", type: "nominal", scale: null, legend: null } },
      },
      {
        mark: {
          type: "text",
          baseline: "bottom",
          dy: -22,
          fontSize: 13,
          fontWeight: "bold",
          color: COLOR_TEXT,
        },
        encoding: { text: { field: "opsLabel" } },
      },
      {
        mark: { type: "text", baseline: "bottom", dy: -7, fontSize: 12, color: COLOR_MUTED },
        encoding: { text: { field: "speedupLabel" } },
      },
    ],
    config: { view: { stroke: null } },
  };
};

export const renderBenchChart = async (report: BenchReport): Promise<string> => {
  const compiledSpec = compile(createChartSpec(report)).spec;
  const chartView = new vega.View(vega.parse(compiledSpec), { renderer: "none" });
  return chartView.toSVG();
};
