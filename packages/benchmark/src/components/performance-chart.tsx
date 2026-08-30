import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  BENCHMARK_LIBRARY_COLUMNS,
  CHART_BAR_HEIGHT_PX,
  CHART_LABEL_WIDTH_PX,
  CHART_RIGHT_MARGIN_PX,
  CNFAST_CHART_COLOR,
  REFERENCE_CHART_COLOR,
} from "@/constants";
import { formatOperationsPerSecond } from "@/utils/format-operations-per-second";

const performanceChartConfig = {
  operationsPerSecond: {
    label: "Operations per second",
  },
} satisfies ChartConfig;

export const PerformanceChart = ({ report }: PerformanceChartProps) => {
  const chartData = report.forms.map((form) => {
    const isCnfast = form.label === "cnfast";
    const libraryColumn = BENCHMARK_LIBRARY_COLUMNS.find((column) =>
      isCnfast ? column.id === "cnfast" : column.id === "reference",
    );
    return {
      fill: isCnfast ? CNFAST_CHART_COLOR : REFERENCE_CHART_COLOR,
      label: libraryColumn?.label ?? form.label,
      operationsPerSecond: form.opsPerSec,
    };
  });

  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">Performance</h2>
      <p className="mt-1 text-sm text-muted-foreground">Operations per second. Higher is better.</p>
      <ChartContainer className="mt-4 h-40 w-full" config={performanceChartConfig}>
        <BarChart
          accessibilityLayer
          data={chartData}
          layout="vertical"
          margin={{ right: CHART_RIGHT_MARGIN_PX }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis
            axisLine={false}
            tickFormatter={(value) => formatOperationsPerSecond(value)}
            tickLine={false}
            type="number"
          />
          <YAxis
            axisLine={false}
            dataKey="label"
            tickLine={false}
            type="category"
            width={CHART_LABEL_WIDTH_PX}
          />
          <Bar barSize={CHART_BAR_HEIGHT_PX} dataKey="operationsPerSecond">
            {chartData.map((entry) => (
              <Cell fill={entry.fill} key={entry.label} />
            ))}
            <LabelList
              dataKey="operationsPerSecond"
              formatter={(value) =>
                typeof value === "number" ? formatOperationsPerSecond(value) : ""
              }
              position="right"
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
};
