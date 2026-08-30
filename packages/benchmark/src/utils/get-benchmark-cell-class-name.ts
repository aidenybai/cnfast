export const getBenchmarkCellClassName = (row: BenchmarkTableRow, column: string): string => {
  if (column === "comparison") {
    if (row.comparisonSortValue === undefined || row.comparisonSortValue === 1) return "";
    const isPositive = row.higherIsBetter
      ? row.comparisonSortValue > 1
      : row.comparisonSortValue < 1;
    return isPositive
      ? "bg-emerald-500/10 text-emerald-950 dark:text-emerald-100"
      : "bg-red-500/10 text-red-950 dark:text-red-100";
  }

  const value = column === "cnfast" ? row.cnfastSortValue : row.referenceSortValue;
  const comparisonValue = column === "cnfast" ? row.referenceSortValue : row.cnfastSortValue;
  if (value === comparisonValue) return "";

  const isBest = row.higherIsBetter ? value > comparisonValue : value < comparisonValue;
  return isBest
    ? "bg-emerald-500/10 text-emerald-950 dark:text-emerald-100"
    : "bg-red-500/10 text-red-950 dark:text-red-100";
};
