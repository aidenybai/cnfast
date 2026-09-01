import { SortableBenchmarkHeader } from "@/components/sortable-benchmark-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BENCHMARK_LIBRARY_COLUMNS, BENCHMARK_ROWS_PER_PAGE } from "@/constants";
import { cn } from "@/lib/utils";
import { createBenchmarkPageUrl } from "@/utils/create-benchmark-page-url";
import { getBenchmarkCellClassName } from "@/utils/get-benchmark-cell-class-name";
import { sortBenchmarkRows } from "@/utils/sort-benchmark-rows";

const PAGINATION_LINK_CLASS_NAME =
  "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export const BenchmarkSectionTable = ({ page, section, sortState }: BenchmarkSectionTableProps) => {
  const sortedRows = sortBenchmarkRows(section.rows, sortState);
  const summaryRows = sortedRows.filter((row) => row.isSummary);
  const paginatedRows = sortedRows.filter((row) => !row.isSummary);
  const pageCount = Math.max(1, Math.ceil(paginatedRows.length / BENCHMARK_ROWS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStartIndex = (currentPage - 1) * BENCHMARK_ROWS_PER_PAGE;
  const visibleRows = paginatedRows.slice(pageStartIndex, pageStartIndex + BENCHMARK_ROWS_PER_PAGE);
  visibleRows.push(...summaryRows);
  const libraryColumns = section.isCnfastFirst
    ? BENCHMARK_LIBRARY_COLUMNS
    : [...BENCHMARK_LIBRARY_COLUMNS].reverse();

  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight">{section.label}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
      <div className="mt-3 overflow-hidden rounded-lg border bg-background">
        <Table className="min-w-3xl">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                aria-sort={
                  sortState.column === "label"
                    ? sortState.direction === "ascending"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                className="min-w-64 border-r p-0"
              >
                <SortableBenchmarkHeader
                  column="label"
                  label="Benchmark"
                  sectionId={section.id}
                  sortState={sortState}
                />
              </TableHead>
              {libraryColumns.map((libraryColumn) => (
                <TableHead
                  aria-sort={
                    sortState.column === libraryColumn.id
                      ? sortState.direction === "ascending"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className="min-w-48 border-r p-0 last:border-r-0"
                  key={libraryColumn.id}
                >
                  <SortableBenchmarkHeader
                    alignEnd
                    column={libraryColumn.id}
                    label={libraryColumn.label}
                    sectionId={section.id}
                    sortState={sortState}
                  />
                </TableHead>
              ))}
              {section.comparisonLabel ? (
                <TableHead
                  aria-sort={
                    sortState.column === "comparison"
                      ? sortState.direction === "ascending"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className="min-w-32 p-0"
                >
                  <SortableBenchmarkHeader
                    alignEnd
                    column="comparison"
                    label={section.comparisonLabel}
                    sectionId={section.id}
                    sortState={sortState}
                  />
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow className={cn(row.isSummary && "bg-muted/40 font-medium")} key={row.id}>
                <TableCell className="border-r bg-background px-2 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    {row.sourceUrl ? (
                      <a
                        className="group/link inline-flex w-fit items-center gap-1.5 font-medium hover:underline"
                        href={row.sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {row.label}
                        <svg
                          aria-hidden
                          className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover/link:opacity-100 group-focus-visible/link:opacity-100"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                        >
                          <path d="M15 3h6v6" />
                          <path d="M10 14 21 3" />
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        </svg>
                      </a>
                    ) : (
                      <span className="font-medium">{row.label}</span>
                    )}
                    <span className="text-xs text-muted-foreground">{row.detail}</span>
                  </div>
                </TableCell>
                {libraryColumns.map((libraryColumn) => (
                  <TableCell
                    className={cn(
                      "border-r px-2 py-2.5 text-right text-sm font-medium tabular-nums last:border-r-0",
                      getBenchmarkCellClassName(row, libraryColumn.id),
                    )}
                    key={libraryColumn.id}
                  >
                    {libraryColumn.id === "cnfast" ? row.cnfast : row.reference}
                  </TableCell>
                ))}
                {section.comparisonLabel ? (
                  <TableCell
                    className={cn(
                      "px-2 py-2.5 text-right text-sm font-medium tabular-nums",
                      getBenchmarkCellClassName(row, "comparison"),
                    )}
                  >
                    {row.comparison}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pageCount > 1 ? (
        <nav
          aria-label={`${section.label} pagination`}
          className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {pageCount} · {BENCHMARK_ROWS_PER_PAGE} rows per page
          </span>
          <div className="flex items-center gap-2">
            {currentPage > 1 ? (
              <a
                className={PAGINATION_LINK_CLASS_NAME}
                href={createBenchmarkPageUrl(section.id, currentPage - 1, sortState)}
              >
                Previous
              </a>
            ) : (
              <span aria-disabled className={cn(PAGINATION_LINK_CLASS_NAME, "opacity-50")}>
                Previous
              </span>
            )}
            {currentPage < pageCount ? (
              <a
                className={PAGINATION_LINK_CLASS_NAME}
                href={createBenchmarkPageUrl(section.id, currentPage + 1, sortState)}
              >
                Next
              </a>
            ) : (
              <span aria-disabled className={cn(PAGINATION_LINK_CLASS_NAME, "opacity-50")}>
                Next
              </span>
            )}
          </div>
        </nav>
      ) : null}
    </section>
  );
};
