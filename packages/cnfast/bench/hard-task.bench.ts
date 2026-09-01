import {
  DEFAULT_GRID_COLUMN_COUNT,
  DEFAULT_GRID_ROW_COUNT,
  MILLISECONDS_PER_SECOND,
  TARGET_FRAMES_PER_SECOND,
} from "./constants";
import { keepAlive, runImplementationBenchmark } from "./lib/harness";
import { gridWorkloads } from "./lib/workloads";

const FRAME_BUDGET_60_FPS_MS = MILLISECONDS_PER_SECOND / TARGET_FRAMES_PER_SECOND;
const GRID_ROW_COUNT = Number(process.env.GRID_ROWS ?? DEFAULT_GRID_ROW_COUNT);
const GRID_COLUMN_COUNT = Number(process.env.GRID_COLS ?? DEFAULT_GRID_COLUMN_COUNT);
const GRID_CELL_COUNT = GRID_ROW_COUNT * GRID_COLUMN_COUNT;

const summarize = (label: string, gridsPerSecond: number): Record<string, unknown> => {
  const millisecondsPerGrid = MILLISECONDS_PER_SECOND / gridsPerSecond;
  return {
    impl: label,
    "ms / full grid": millisecondsPerGrid.toFixed(2),
    "grids/sec": Math.round(gridsPerSecond).toLocaleString("en-US"),
    "cells in 16.7ms": Math.round(
      (FRAME_BUDGET_60_FPS_MS / millisecondsPerGrid) * GRID_CELL_COUNT,
    ).toLocaleString("en-US"),
    "fits 60fps?": millisecondsPerGrid <= FRAME_BUDGET_60_FPS_MS ? "yes" : "NO (drops frames)",
  };
};

console.log(
  `\nHard task: re-rendering a ${GRID_ROW_COUNT}x${GRID_COLUMN_COUNT} data grid ` +
    `(${GRID_CELL_COUNT.toLocaleString("en-US")} conflict-heavy cn() calls per frame).\n`,
);

for (const workload of gridWorkloads()) {
  const { cnfast, reference } = await runImplementationBenchmark(workload.run);
  console.log(`== ${workload.name} ${workload.meta} ==`);
  console.table([summarize("cnfast", cnfast), summarize("clsx + tailwind-merge", reference)]);
  console.log(
    `speedup: ${(cnfast / reference).toFixed(2)}x  |  ` +
      `cn budget saved per grid: ${(
        MILLISECONDS_PER_SECOND / reference -
        MILLISECONDS_PER_SECOND / cnfast
      ).toFixed(2)}ms\n`,
  );
}

keepAlive();
