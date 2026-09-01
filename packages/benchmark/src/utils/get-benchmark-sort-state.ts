import { BENCHMARK_SORT_COLUMNS, DEFAULT_SORT_COLUMN, DEFAULT_SORT_DIRECTION } from "@/constants";
import { getFirstSearchParameter } from "@/utils/get-first-search-parameter";

export const getBenchmarkSortState = (
  sectionId: string,
  searchParameters: BenchmarkSearchParams,
): BenchmarkSortState => {
  const activeSection = getFirstSearchParameter(searchParameters.section);
  const requestedColumn = getFirstSearchParameter(searchParameters.column);
  const requestedDirection = getFirstSearchParameter(searchParameters.direction);
  const isSupportedColumn =
    requestedColumn !== undefined && BENCHMARK_SORT_COLUMNS.includes(requestedColumn);

  if (activeSection !== sectionId || !isSupportedColumn) {
    return {
      column: DEFAULT_SORT_COLUMN,
      direction: DEFAULT_SORT_DIRECTION,
    };
  }

  return {
    column: requestedColumn,
    direction: requestedDirection === "descending" ? "descending" : "ascending",
  };
};
