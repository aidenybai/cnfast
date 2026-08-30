import { SortableBenchmarkHeader } from "@/components/sortable-benchmark-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BENCHMARK_LIBRARY_COLUMNS } from "@/constants";
import { cn } from "@/lib/utils";
import { getBenchmarkCellClassName } from "@/utils/get-benchmark-cell-class-name";
import { sortBenchmarkRows } from "@/utils/sort-benchmark-rows";

export const BenchmarkSectionTable = ({
  hideHeading = false,
  section,
  sortState,
}: BenchmarkSectionTableProps) => {
  const sortedRows = sortBenchmarkRows(section.rows, sortState);
  const libraryColumns = section.isCnfastFirst
    ? BENCHMARK_LIBRARY_COLUMNS
    : [...BENCHMARK_LIBRARY_COLUMNS].reverse();

  return (
    <section>
      {hideHeading ? null : (
        <>
          <h2 className="text-lg font-semibold tracking-tight">{section.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
        </>
      )}
      <div
        className={cn(
          "overflow-hidden rounded-lg border bg-background",
          hideHeading ? "mt-0" : "mt-3",
        )}
      >
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
            {sortedRows.map((row) => (
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
    </section>
  );
};
