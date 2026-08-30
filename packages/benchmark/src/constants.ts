export const BENCHMARK_THEME_STORAGE_KEY = "cnfast-benchmark-theme";
export const BENCHMARK_REPOSITORY_URL = "https://github.com/aidenybai/cnfast";
export const BENCHMARK_REPOSITORY_API_URL = "https://api.github.com/repos/aidenybai/cnfast";
export const BENCHMARK_SOURCE_BASE_URL = `${BENCHMARK_REPOSITORY_URL}/blob/main`;
export const BENCHMARK_COMMIT_BASE_URL = `${BENCHMARK_REPOSITORY_URL}/commit`;
export const BYTES_PER_KIBIBYTE = 1024;
export const VALUE_DECIMAL_PLACES = 2;
export const DEFAULT_SORT_COLUMN = "default";
export const DEFAULT_SORT_DIRECTION = "ascending";
export const CHART_LABEL_WIDTH_PX = 180;
export const CHART_BAR_HEIGHT_PX = 32;
export const CHART_RIGHT_MARGIN_PX = 96;
export const UNRANKED_VALUE = 0;
export const CNFAST_CHART_COLOR = "var(--color-emerald-500)";
export const REFERENCE_CHART_COLOR = "var(--color-red-500)";
export const GITHUB_STAR_COUNT_ABBREVIATION_THRESHOLD = 1000;
export const GITHUB_STAR_COUNT_DIVISOR = 1000;

const WORKLOAD_SOURCE_URL = `${BENCHMARK_SOURCE_BASE_URL}/packages/cnfast/bench/lib/workloads.ts`;

export const BENCHMARK_SOURCE_URL_BY_LABEL: BenchmarkSourceUrlMap = {
  "Cached re-render": WORKLOAD_SOURCE_URL,
  "Merge engine (cold)": WORKLOAD_SOURCE_URL,
  "Component corpus": WORKLOAD_SOURCE_URL,
  "Page render": WORKLOAD_SOURCE_URL,
  "Live data grid": WORKLOAD_SOURCE_URL,
};

export const BUNDLE_SOURCE_URL = `${BENCHMARK_SOURCE_BASE_URL}/packages/cnfast/scripts/lib/measure-bundle.ts`;
export const BENCHMARK_LIBRARY_COLUMNS: BenchmarkLibraryColumn[] = [
  { id: "cnfast", label: "cnfast" },
  { id: "reference", label: "clsx + tailwind-merge" },
];
