import { Skeleton } from "@/components/ui/skeleton";
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

export const BenchmarkSectionTableSkeleton = ({ section }: BenchmarkSectionTableSkeletonProps) => {
  const summaryRows = section.rows.filter((row) => row.isSummary);
  const visibleRows = section.rows
    .filter((row) => !row.isSummary)
    .slice(0, BENCHMARK_ROWS_PER_PAGE);
  visibleRows.push(...summaryRows);
  const hasPagination = section.rows.length - summaryRows.length > BENCHMARK_ROWS_PER_PAGE;
  const libraryColumns = section.isCnfastFirst
    ? BENCHMARK_LIBRARY_COLUMNS
    : [...BENCHMARK_LIBRARY_COLUMNS].reverse();

  return (
    <section
      aria-label={`Loading ${section.label.toLowerCase()} benchmarks`}
      aria-busy
      role="status"
    >
      <h2 className="text-lg font-semibold tracking-tight">{section.label}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
      <div className="mt-3 overflow-hidden rounded-lg border bg-background">
        <Table aria-hidden className="min-w-3xl">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-64 border-r p-0">
                <div className="flex w-full items-center px-2 py-3">
                  <Skeleton className="h-5 w-20" />
                </div>
              </TableHead>
              {libraryColumns.map((libraryColumn) => (
                <TableHead className="min-w-48 border-r p-0 last:border-r-0" key={libraryColumn.id}>
                  <div className="flex w-full items-center justify-end px-2 py-3">
                    <Skeleton className="h-5 w-28" />
                  </div>
                </TableHead>
              ))}
              {section.comparisonLabel ? (
                <TableHead className="min-w-32 p-0">
                  <div className="flex w-full items-center justify-end px-2 py-3">
                    <Skeleton className="h-5 w-16" />
                  </div>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow className={cn(row.isSummary && "bg-muted/40")} key={row.id}>
                <TableCell className="border-r bg-background px-2 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <Skeleton className="h-5 w-36" />
                    <Skeleton className="h-4 w-52" />
                  </div>
                </TableCell>
                {libraryColumns.map((libraryColumn) => (
                  <TableCell
                    className="border-r px-2 py-2.5 last:border-r-0"
                    key={libraryColumn.id}
                  >
                    <Skeleton className="ml-auto h-5 w-20" />
                  </TableCell>
                ))}
                {section.comparisonLabel ? (
                  <TableCell className="px-2 py-2.5">
                    <Skeleton className="ml-auto h-5 w-16" />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {hasPagination ? (
        <div
          aria-hidden
          className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <Skeleton className="h-5 w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-16" />
          </div>
        </div>
      ) : null}
    </section>
  );
};
