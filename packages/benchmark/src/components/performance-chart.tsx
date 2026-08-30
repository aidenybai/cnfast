import {
  BENCHMARK_LIBRARY_COLUMNS,
  CNFAST_CHART_COLOR,
  PERCENTAGE_MULTIPLIER,
  REFERENCE_CHART_COLOR,
} from "@/constants";
import { formatOperationsPerSecond } from "@/utils/format-operations-per-second";

export const PerformanceChart = ({ report }: PerformanceChartProps) => {
  const highestOperationsPerSecond = Math.max(...report.forms.map((form) => form.opsPerSec));

  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">Performance</h2>
      <p className="mt-1 text-sm text-muted-foreground">Operations per second. Higher is better.</p>
      <div
        aria-label="Operations per second by library"
        className="mt-4 space-y-4 rounded-lg border bg-background p-4 sm:p-6"
        role="img"
      >
        {report.forms.map((form) => {
          const isCnfast = form.label === "cnfast";
          const libraryColumn = BENCHMARK_LIBRARY_COLUMNS.find((column) =>
            isCnfast ? column.id === "cnfast" : column.id === "reference",
          );
          const widthPercentage =
            (form.opsPerSec / highestOperationsPerSecond) * PERCENTAGE_MULTIPLIER;

          return (
            <div
              className="grid grid-cols-[minmax(8rem,11rem)_minmax(8rem,1fr)] items-center gap-3 sm:grid-cols-[minmax(10rem,13rem)_minmax(12rem,1fr)_auto]"
              key={form.label}
            >
              <span className="truncate text-sm font-medium">
                {libraryColumn?.label ?? form.label}
              </span>
              <div className="h-8 overflow-hidden rounded-sm bg-muted">
                <div
                  className="h-full min-w-px rounded-sm"
                  style={{
                    backgroundColor: isCnfast ? CNFAST_CHART_COLOR : REFERENCE_CHART_COLOR,
                    width: `${widthPercentage}%`,
                  }}
                />
              </div>
              <span className="col-start-2 text-right text-sm font-medium tabular-nums sm:col-start-auto sm:min-w-24">
                {formatOperationsPerSecond(form.opsPerSec)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
