import { BENCHMARK_SOURCE_URL_BY_LABEL, BUNDLE_SOURCE_URL, UNRANKED_VALUE } from "../constants";
import { formatBytes } from "./format-bytes";
import { formatOperationsPerSecond } from "./format-operations-per-second";
import { formatSpeedup } from "./format-speedup";

export const createPerformanceSection = (
  report: BenchmarkReport,
  siteData: BenchmarkSiteData,
): BenchmarkSection => {
  const throughputRows: BenchmarkTableRow[] = report.rows.map((row) => ({
    id: row.label,
    label: row.label,
    detail: row.detail,
    sourceUrl: BENCHMARK_SOURCE_URL_BY_LABEL[row.label],
    cnfast: row.emphasis ? "—" : formatOperationsPerSecond(row.cnfast),
    reference: row.emphasis ? "—" : formatOperationsPerSecond(row.reference),
    cnfastSortValue: row.emphasis ? UNRANKED_VALUE : row.cnfast,
    referenceSortValue: row.emphasis ? UNRANKED_VALUE : row.reference,
    comparison: formatSpeedup(row.speedup),
    comparisonSortValue: row.speedup,
    higherIsBetter: true,
    isSummary: row.emphasis,
  }));
  const repositoryBenchmarkRows: BenchmarkTableRow[] = siteData.repositories.map((repository) => ({
    id: `repository-${repository.name}`,
    label: repository.name,
    detail: `repository corpus ${repository.benchmark.detail}`,
    sourceUrl: repository.url,
    cnfast: formatOperationsPerSecond(repository.benchmark.cnfast),
    reference: formatOperationsPerSecond(repository.benchmark.reference),
    cnfastSortValue: repository.benchmark.cnfast,
    referenceSortValue: repository.benchmark.reference,
    comparison: formatSpeedup(repository.benchmark.speedup),
    comparisonSortValue: repository.benchmark.speedup,
    higherIsBetter: true,
    isSummary: false,
  }));
  const performanceRows = throughputRows.filter((row) => !row.isSummary);
  performanceRows.push(...repositoryBenchmarkRows);
  performanceRows.push(...throughputRows.filter((row) => row.isSummary));

  return {
    id: "performance",
    label: "Performance",
    description: "Completed workload passes per second. Higher values are faster.",
    higherIsBetter: true,
    isCnfastFirst: true,
    comparisonLabel: "Relative",
    rows: performanceRows,
    relatedSections: [
      {
        id: "bundle-size",
        label: "Bundle size",
        description:
          "Production entry bundle after minification and gzip. Lower values are smaller.",
        higherIsBetter: false,
        isCnfastFirst: false,
        comparisonLabel: "Relative",
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
            comparison: formatSpeedup(report.bundle.cnfastGzip / report.bundle.referenceGzip),
            comparisonSortValue: report.bundle.cnfastGzip / report.bundle.referenceGzip,
            higherIsBetter: false,
            isSummary: false,
          },
        ],
      },
    ],
  };
};
