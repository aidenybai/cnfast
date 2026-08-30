import {
  BENCHMARK_SOURCE_URL_BY_LABEL,
  BUNDLE_SOURCE_URL,
  CORRECTNESS_CALL_GROUP_COUNT,
  CORRECTNESS_CORPUS_COUNT,
  CORRECTNESS_SOURCE_URL,
} from "../constants";
import { formatBytes } from "./format-bytes";
import { formatOperationsPerSecond } from "./format-operations-per-second";
import { formatSpeedup } from "./format-speedup";

export const createBenchmarkSections = (report: BenchmarkReport): BenchmarkSection[] => {
  const throughputRows = report.rows.map((row) => ({
    id: row.label,
    label: row.label,
    detail: row.detail,
    sourceUrl: BENCHMARK_SOURCE_URL_BY_LABEL[row.label],
    cnfast: formatOperationsPerSecond(row.cnfast),
    reference: formatOperationsPerSecond(row.reference),
    cnfastSortValue: row.cnfast,
    referenceSortValue: row.reference,
    isSummary: row.emphasis,
  }));

  const speedupRows = report.rows.map((row) => ({
    id: row.label,
    label: row.label,
    detail: row.detail,
    sourceUrl: BENCHMARK_SOURCE_URL_BY_LABEL[row.label],
    cnfast: formatSpeedup(row.speedup),
    reference: formatSpeedup(1),
    cnfastSortValue: row.speedup,
    referenceSortValue: 1,
    isSummary: row.emphasis,
  }));

  return [
    {
      id: "throughput",
      label: "Throughput",
      description: "Completed workload passes per second. Higher values are faster.",
      higherIsBetter: true,
      isCnfastFirst: true,
      rows: throughputRows,
    },
    {
      id: "speedup",
      label: "Speedup",
      description: "Throughput relative to clsx + tailwind-merge. Higher values are faster.",
      higherIsBetter: true,
      isCnfastFirst: true,
      rows: speedupRows,
    },
    {
      id: "bundle-size",
      label: "Bundle size",
      description: "Production entry bundle after minification and gzip. Lower values are smaller.",
      higherIsBetter: false,
      isCnfastFirst: false,
      rows: [
        {
          id: "minified-gzip",
          label: "Minified + gzipped",
          detail: "package entry with dependencies included",
          sourceUrl: BUNDLE_SOURCE_URL,
          cnfast: formatBytes(report.bundle.cnfastGzip),
          reference: formatBytes(report.bundle.referenceGzip),
          cnfastSortValue: report.bundle.cnfastGzip,
          referenceSortValue: report.bundle.referenceGzip,
          isSummary: false,
        },
      ],
    },
    {
      id: "correctness",
      label: "Correctness",
      description: "Byte-for-byte output parity on harvested real-world cn calls.",
      higherIsBetter: true,
      isCnfastFirst: true,
      rows: [
        {
          id: "real-world-parity",
          label: "Output parity",
          detail: `${CORRECTNESS_CALL_GROUP_COUNT.toLocaleString("en-US")} calls across ${CORRECTNESS_CORPUS_COUNT} apps`,
          sourceUrl: CORRECTNESS_SOURCE_URL,
          cnfast: "Pass",
          reference: "Pass",
          cnfastSortValue: 1,
          referenceSortValue: 1,
          isSummary: false,
        },
      ],
    },
  ];
};
