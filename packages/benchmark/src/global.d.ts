interface BenchmarkReportRow {
  label: string;
  detail: string;
  cnfast: number;
  reference: number;
  speedup: number;
  emphasis: boolean;
}

interface BenchmarkReportForm {
  label: string;
  opsPerSec: number;
  speedup: number;
}

interface BenchmarkRepository {
  name: string;
  url: string;
}

interface BenchmarkRepositoryData extends BenchmarkRepository {
  benchmark: {
    cnfast: number;
    reference: number;
    speedup: number;
    detail: string;
  };
}

interface BenchmarkSiteData {
  benchmarkTimestamp: string;
  repositories: BenchmarkRepositoryData[];
}

interface BenchmarkReport {
  generatedAt: string;
  gitSha: string;
  runtime: string;
  bestOf: number;
  timeMs: number;
  workloadCount: number;
  overallSpeedup: number;
  bundle: {
    cnfastGzip: number;
    referenceGzip: number;
  };
  rows: BenchmarkReportRow[];
  forms: BenchmarkReportForm[];
}

interface BenchmarkTableRow {
  id: string;
  label: string;
  detail: string;
  sourceUrl?: string;
  cnfast: string;
  reference: string;
  cnfastSortValue: number;
  referenceSortValue: number;
  comparison?: string;
  comparisonSortValue?: number;
  higherIsBetter: boolean;
  isSummary: boolean;
}

interface BenchmarkSection {
  id: string;
  label: string;
  description: string;
  higherIsBetter: boolean;
  isCnfastFirst: boolean;
  comparisonLabel?: string;
  rows: BenchmarkTableRow[];
  relatedSections?: BenchmarkSection[];
}

interface BenchmarkSortState {
  column: string;
  direction: string;
}

interface BenchmarkLibraryColumn {
  id: string;
  label: string;
}

interface BenchmarkSourceUrlMap {
  [label: string]: string;
}

interface BenchmarkSectionTableProps {
  hideHeading?: boolean;
  section: BenchmarkSection;
}

interface PerformanceChartProps {
  report: BenchmarkReport;
}

interface SortableBenchmarkHeaderProps {
  alignEnd?: boolean;
  column: string;
  label: string;
  onSort: (column: string) => void;
  sortState: BenchmarkSortState;
}

interface GitHubRepositoryResponse {
  stargazers_count: number;
}

interface ModeSwitcherProps {
  isDark: boolean;
  onDarkModeChange: (isDark: boolean) => void;
}

interface SiteHeaderProps {
  isDark: boolean;
  onDarkModeChange: (isDark: boolean) => void;
}
