import { benchRun, keepAlive } from "./lib/harness";
import { gridWorkloads } from "./lib/workloads";

const FRAME_60_MS = 1000 / 60;
const ROWS = Number(process.env.GRID_ROWS ?? 200);
const COLS = Number(process.env.GRID_COLS ?? 60);
const CELLS = ROWS * COLS;

const summarize = (label: string, gridsPerSec: number): Record<string, unknown> => {
  const msPerGrid = 1000 / gridsPerSec;
  return {
    impl: label,
    "ms / full grid": msPerGrid.toFixed(2),
    "grids/sec": Math.round(gridsPerSec).toLocaleString("en-US"),
    "cells in 16.7ms": Math.round((FRAME_60_MS / msPerGrid) * CELLS).toLocaleString("en-US"),
    "fits 60fps?": msPerGrid <= FRAME_60_MS ? "yes" : "NO (drops frames)",
  };
};

console.log(
  `\nHard task: re-rendering a ${ROWS}x${COLS} data grid ` +
    `(${CELLS.toLocaleString("en-US")} conflict-heavy cn() calls per frame).\n`,
);

for (const workload of gridWorkloads()) {
  const { cnfast, reference } = await benchRun(workload.run);
  console.log(`== ${workload.name} ${workload.meta} ==`);
  console.table([summarize("cnfast", cnfast), summarize("clsx + tailwind-merge", reference)]);
  console.log(
    `speedup: ${(cnfast / reference).toFixed(2)}x  |  ` +
      `cn budget saved per grid: ${(1000 / reference - 1000 / cnfast).toFixed(2)}ms\n`,
  );
}

keepAlive();
