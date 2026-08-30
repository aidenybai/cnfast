export const createBenchmarkSortUrl = (
  sectionId: string,
  column: string,
  sortState: BenchmarkSortState,
): string => {
  const direction =
    sortState.column === column && sortState.direction === "ascending" ? "descending" : "ascending";
  const searchParameters = new URLSearchParams({
    section: sectionId,
    column,
    direction,
  });

  return `?${searchParameters.toString()}`;
};
