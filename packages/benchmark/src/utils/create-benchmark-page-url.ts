export const createBenchmarkPageUrl = (
  sectionId: string,
  page: number,
  sortState: BenchmarkSortState,
): string => {
  const searchParameters = new URLSearchParams({
    section: sectionId,
    column: sortState.column,
    direction: sortState.direction,
    page: String(page),
  });

  return `?${searchParameters.toString()}`;
};
