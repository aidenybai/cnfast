import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSeededRandom } from "./utils/create-seeded-random";

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: bun bench/generate-shape-datasets.ts <outDir>");
mkdirSync(outDir, { recursive: true });

const TOGGLE_SITE_COUNT = 200;
const TOGGLE_FRAME_COUNT = 32;
const INPUT_SHAPE_SITE_COUNT = 256;
const INPUT_SHAPE_FRAME_COUNT = 16;

const toggleBase: string[] = [];
const togglePrimary: string[] = [];
const toggleDisabled: string[] = [];
for (let siteIndex = 0; siteIndex < TOGGLE_SITE_COUNT; siteIndex++) {
  toggleBase.push(`flex items-center gap-${(siteIndex % 4) + 1} px-${(siteIndex % 6) + 1} text-sm`);
  togglePrimary.push(`bg-blue-${((siteIndex % 5) + 1) * 100} text-white`);
  toggleDisabled.push(`opacity-50 pointer-events-none px-${(siteIndex % 8) + 1}`);
}

const createFlagSchedule = (toggleRate: number, seed: number): boolean[][] => {
  const random = createSeededRandom(seed);
  const flagFrames: boolean[][] = [];
  const currentFlags: boolean[] = [];
  for (let index = 0; index < TOGGLE_SITE_COUNT * 3; index++) {
    currentFlags.push(random.getNext() < 0.5);
  }
  flagFrames.push([...currentFlags]);
  for (let frameIndex = 1; frameIndex < TOGGLE_FRAME_COUNT; frameIndex++) {
    for (let index = 0; index < TOGGLE_SITE_COUNT * 3; index++) {
      if (random.getNext() < toggleRate) currentFlags[index] = !currentFlags[index];
    }
    flagFrames.push([...currentFlags]);
  }
  return flagFrames;
};

type Row = (string | boolean | null)[];

const writeRows = (name: string, rows: Row[]): void => {
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(rows));
  console.log(`${name}: ${rows.length} rows`);
};

for (const toggleRate of [0.1, 0.5]) {
  const rateLabel = Math.round(toggleRate * 100);

  const twoFrames = createFlagSchedule(toggleRate, 0xc0ffee);
  const twoRows: Row[] = [];
  for (let frameIndex = 0; frameIndex < TOGGLE_FRAME_COUNT; frameIndex++) {
    const frameFlags = twoFrames[frameIndex]!;
    for (let siteIndex = 0; siteIndex < TOGGLE_SITE_COUNT; siteIndex++) {
      twoRows.push([
        toggleBase[siteIndex]!,
        frameFlags[siteIndex * 3]! && togglePrimary[siteIndex]!,
      ]);
    }
  }
  writeRows(`toggle2-${rateLabel}`, twoRows);

  const threeFrames = createFlagSchedule(toggleRate, 0xbadf00d);
  const threeRows: Row[] = [];
  for (let frameIndex = 0; frameIndex < TOGGLE_FRAME_COUNT; frameIndex++) {
    const frameFlags = threeFrames[frameIndex]!;
    for (let siteIndex = 0; siteIndex < TOGGLE_SITE_COUNT; siteIndex++) {
      threeRows.push([
        toggleBase[siteIndex]!,
        frameFlags[siteIndex * 3]! && togglePrimary[siteIndex]!,
        frameFlags[siteIndex * 3 + 1]! && toggleDisabled[siteIndex]!,
      ]);
    }
  }
  writeRows(`toggle3-${rateLabel}`, threeRows);
}

const falsyRows: Row[] = [];
for (let frameIndex = 0; frameIndex < TOGGLE_FRAME_COUNT; frameIndex++) {
  for (let siteIndex = 0; siteIndex < TOGGLE_SITE_COUNT; siteIndex++) {
    falsyRows.push([toggleBase[siteIndex]!, false, null]);
  }
}
writeRows("falsy-tail", falsyRows);

const shapeBase: string[] = [];
const shapePrimary: string[] = [];
const shapeDisabled: string[] = [];
const shapeFocus: string[] = [];
for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
  shapeBase.push(
    `inline-flex items-center gap-${(siteIndex % 4) + 1} px-${(siteIndex % 6) + 1} text-sm`,
  );
  shapePrimary.push(`bg-blue-${((siteIndex % 5) + 1) * 100} text-white`);
  shapeDisabled.push(`opacity-50 pointer-events-none px-${(siteIndex % 8) + 1}`);
  shapeFocus.push(`focus-visible:ring-2 ring-offset-${siteIndex % 4}`);
}

const twoStringRows: Row[] = [];
const fourStringRows: Row[] = [];
for (let frameIndex = 0; frameIndex < INPUT_SHAPE_FRAME_COUNT; frameIndex++) {
  for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
    twoStringRows.push([shapeBase[siteIndex]!, shapePrimary[siteIndex]!]);
    fourStringRows.push([
      shapeBase[siteIndex]!,
      shapePrimary[siteIndex]!,
      shapeDisabled[siteIndex]!,
      shapeFocus[siteIndex]!,
    ]);
  }
}
writeRows("two-strings", twoStringRows);
writeRows("four-strings", fourStringRows);
