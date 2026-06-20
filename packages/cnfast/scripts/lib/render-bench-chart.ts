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
  overallSpeedup: number;
  bundle: { cnfastGzip: number; referenceGzip: number };
  rows: BenchChartRow[];
  forms: BenchForm[];
}

const COLOR_BACKGROUND = "#ffffff";
const COLOR_TEXT = "#111827";
const COLOR_MUTED = "#6b7280";
const COLOR_GRID = "#e5e7eb";
const COLOR_TEMPLATE = "#2563eb";
const COLOR_FASTCN = "#60a5fa";
const COLOR_BASELINE = "#d1d5db";

const colorFor = (label: string): string => {
  if (label.includes("template")) return COLOR_TEMPLATE;
  if (label.includes("cnfast")) return COLOR_FASTCN;
  return COLOR_BASELINE;
};

const formatOps = (ops: number): string => {
  if (ops >= 1_000_000) return `${(ops / 1_000_000).toFixed(1)}M ops/s`;
  if (ops >= 10_000) return `${Math.round(ops / 1_000)}K ops/s`;
  if (ops >= 1_000) return `${(ops / 1_000).toFixed(1)}K ops/s`;
  return `${Math.round(ops)} ops/s`;
};

const buildSpec = (report: BenchReport): TopLevelSpec => {
  const maxOps = report.forms.reduce((max, form) => Math.max(max, form.opsPerSec), 0);
  const order = report.forms.map((form) => form.label);
  const values = report.forms.map((form) => ({
    form: form.label,
    ops: form.opsPerSec,
    color: colorFor(form.label),
    opsLabel: formatOps(form.opsPerSec),
    speedupLabel: `${form.speedup.toFixed(1)}x`,
  }));

  const baseEncoding = {
    x: {
      field: "form",
      type: "nominal" as const,
      sort: order,
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
      scale: { domain: [0, maxOps * 1.2] },
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
    data: { values },
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

// Deterministic: identical report -> byte-identical SVG (Vega's SVG renderer is pure, no clock,
// no randomness). Regenerate and diff the committed file safely.
export const renderBenchChart = async (report: BenchReport): Promise<string> => {
  const compiled = compile(buildSpec(report)).spec;
  const view = new vega.View(vega.parse(compiled), { renderer: "none" });
  return view.toSVG();
};
