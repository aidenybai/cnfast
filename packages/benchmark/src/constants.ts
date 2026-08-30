export const BENCHMARK_REPOSITORY_URL = "https://github.com/aidenybai/cnfast";
export const BENCHMARK_REPOSITORY_API_URL = "https://api.github.com/repos/aidenybai/cnfast";
export const BENCHMARK_SOURCE_BASE_URL = `${BENCHMARK_REPOSITORY_URL}/blob/main`;
export const BENCHMARK_COMMIT_BASE_URL = `${BENCHMARK_REPOSITORY_URL}/commit`;
export const BYTES_PER_KIBIBYTE = 1024;
export const VALUE_DECIMAL_PLACES = 2;
export const DEFAULT_SORT_COLUMN = "default";
export const DEFAULT_SORT_DIRECTION = "ascending";
export const UNRANKED_VALUE = 0;
export const GITHUB_STAR_COUNT_ABBREVIATION_THRESHOLD = 1000;
export const GITHUB_STAR_COUNT_DIVISOR = 1000;
export const GITHUB_STAR_COUNT_REVALIDATION_SECONDS = 3600;
export const BENCHMARK_SORT_COLUMNS = ["label", "cnfast", "reference", "comparison"];

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
