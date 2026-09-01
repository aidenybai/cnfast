import { BENCHMARK_SOURCE_URL_BY_LABEL, BUNDLE_SOURCE_URL, UNRANKED_VALUE } from "../constants";
import { formatBytes } from "./format-bytes";
import { formatOperationsPerSecond } from "./format-operations-per-second";
import { formatSpeedup } from "./format-speedup";

const createThroughputRow = (row: BenchmarkReportRow): BenchmarkTableRow => ({
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
});

const createRepositoryRow = (repository: BenchmarkRepositoryData): BenchmarkTableRow => ({
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
});

const createThroughputSection = (
  id: string,
  label: string,
  description: string,
  rows: BenchmarkTableRow[],
): BenchmarkSection => ({
  id,
  label,
  description,
  higherIsBetter: true,
  isCnfastFirst: true,
  comparisonLabel: "Relative",
  rows,
});

const createBundleSection = (report: BenchmarkReport): BenchmarkSection => ({
  id: "bundle-size",
  label: "Bundle size",
  description: "Production entry bundle after minification and gzip. Lower values are smaller.",
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
});

export const createPerformanceSection = (
  report: BenchmarkReport,
  siteData: BenchmarkSiteData,
): BenchmarkSection => {
  const workloadRows: BenchmarkTableRow[] = [];
  const scenarioRows: BenchmarkTableRow[] = [];

  for (const reportRow of report.rows) {
    const tableRow = createThroughputRow(reportRow);
    if (reportRow.cacheState) workloadRows.push(tableRow);
    else scenarioRows.push(tableRow);
  }

  const summaryRows = scenarioRows.filter((row) => row.isSummary);
  const applicationRows = scenarioRows.filter((row) => !row.isSummary);
  applicationRows.push(...siteData.repositories.map(createRepositoryRow), ...summaryRows);

  const workloadSection = createThroughputSection(
    "workload-performance",
    "Workload performance",
    "Working sets that fit in both implementations' caches alongside working sets that exceed them.",
    workloadRows,
  );
  workloadSection.relatedSections = [
    createThroughputSection(
      "application-performance",
      "Application workloads",
      "Repository, page, and cache-boundary workloads with naturally mixed reuse.",
      applicationRows,
    ),
    createBundleSection(report),
  ];
  return workloadSection;
};
