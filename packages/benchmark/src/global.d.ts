interface BenchmarkReportRow {
  label: string;
  detail: string;
  cnfast: number;
  reference: number;
  speedup: number;
  cacheState?: string;
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
  workloadGroupCount: number;
  overallSpeedup: number;
  groupBalancedSpeedup: number;
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
  section: BenchmarkSection;
  sortState: BenchmarkSortState;
}

interface PerformanceChartProps {
  report: BenchmarkReport;
}

interface SortableBenchmarkHeaderProps {
  alignEnd?: boolean;
  column: string;
  label: string;
  sectionId: string;
  sortState: BenchmarkSortState;
}

interface BenchmarkSearchParams {
  section?: string | string[];
  column?: string | string[];
  direction?: string | string[];
}

interface BenchmarkPageProps {
  searchParams: Promise<BenchmarkSearchParams>;
}

interface BenchmarkTablesProps {
  searchParams: Promise<BenchmarkSearchParams>;
}

interface RootLayoutProps {
  children: React.ReactNode;
}

interface ThemeProviderProps {
  children: React.ReactNode;
}

interface GitHubLinkContentProps {
  formattedStarCount?: string;
}
