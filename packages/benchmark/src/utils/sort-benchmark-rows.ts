export const sortBenchmarkRows = (
  rows: BenchmarkTableRow[],
  sortState: BenchmarkSortState,
): BenchmarkTableRow[] => {
  if (sortState.column === "default") return rows;

  const summaryRows = rows.filter((row) => row.isSummary);
  const sortableRows = rows.filter((row) => !row.isSummary);
  const directionMultiplier = sortState.direction === "ascending" ? 1 : -1;

  sortableRows.sort((firstRow, secondRow) => {
    if (sortState.column === "label") {
      return firstRow.label.localeCompare(secondRow.label) * directionMultiplier;
    }

    const firstValue =
      sortState.column === "cnfast"
        ? firstRow.cnfastSortValue
        : sortState.column === "comparison"
          ? (firstRow.comparisonSortValue ?? 0)
          : firstRow.referenceSortValue;
    const secondValue =
      sortState.column === "cnfast"
        ? secondRow.cnfastSortValue
        : sortState.column === "comparison"
          ? (secondRow.comparisonSortValue ?? 0)
          : secondRow.referenceSortValue;
    return (firstValue - secondValue) * directionMultiplier;
  });

  return [...sortableRows, ...summaryRows];
};
