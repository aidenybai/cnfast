import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { cn, type ClassValue } from "../src/index.js";
import { ARGUMENT_CACHE_BUCKET_ENTRIES, MERGE_CACHE_CAPACITY_MAX } from "../src/lib/constants.js";
import { createSeededRandom } from "../bench/utils/create-seeded-random";
import { createShuffledIndices } from "../bench/utils/create-shuffled-indices";
import { loadCorpora } from "./lib/load-corpus";

const SEQUENCE_SEED = 0xc0_ff_ee;
const CORPUS_SLICE_GROUP_COUNT = 40_000;
const SHUFFLED_PASS_COUNT = 2;
const TOGGLE_SUBSAMPLE_STRIDE = 8;
const TOGGLE_REPLACEMENT_CLASS_NAMES = ["hidden", "flex", "underline", "text-sm"];
const STRING_STORM_UNIQUE_COUNT = MERGE_CACHE_CAPACITY_MAX + 4_000;
const STRING_STORM_RECHECK_STRIDE = 16;
const BUCKET_STORM_ANCHOR_COUNT = 8;
const BUCKET_STORM_ENTRIES_PER_ANCHOR = ARGUMENT_CACHE_BUCKET_ENTRIES * 3;
const BUCKET_STORM_RECHECK_COUNT = 32;
const POST_STORM_CORPUS_RECHECK_COUNT = 2_000;
const MIXED_VALUE_ROW_COUNT = 120;
const MIXED_VALUE_PASS_COUNT = 3;
const MISMATCH_SAMPLE_LIMIT = 10;

const referenceCn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

let totalCallCount = 0;
let mismatchCount = 0;

const verifyCall = (row: ClassValue[]): void => {
  totalCallCount++;
  const actualOutput = cn(...row);
  const expectedOutput = referenceCn(...row);
  if (actualOutput === expectedOutput) return;
  mismatchCount++;
  if (mismatchCount <= MISMATCH_SAMPLE_LIMIT) {
    console.error(
      `MISMATCH at call ${totalCallCount}\n` +
        `  args:     ${JSON.stringify(row)}\n` +
        `  expected: ${expectedOutput}\n` +
        `  actual:   ${actualOutput}`,
    );
  }
};

const verifyRowsInOrder = (rows: ClassValue[][], order: number[]): void => {
  for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
    verifyCall(rows[order[orderIndex]]!);
  }
};

const createSequentialIndices = (length: number): number[] => {
  const indices = new Array<number>(length);
  for (let index = 0; index < length; index++) indices[index] = index;
  return indices;
};

const logPhase = (phaseName: string): void => {
  console.log(`[${totalCallCount} calls verified] ${phaseName}`);
};

const random = createSeededRandom(SEQUENCE_SEED);

const benchDataset = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../tests/tailwind-merge/tw-merge-benchmark-data.json", import.meta.url)),
    "utf8",
  ),
) as ClassValue[][];

const corpusSlice: ClassValue[][] = [];
for (const corpus of loadCorpora()) {
  for (const classGroup of corpus.groups) {
    if (corpusSlice.length >= CORPUS_SLICE_GROUP_COUNT) break;
    corpusSlice.push(classGroup);
  }
  if (corpusSlice.length >= CORPUS_SLICE_GROUP_COUNT) break;
}

logPhase(
  `phase A: replaying ${benchDataset.length} bench rows + ${corpusSlice.length} corpus rows, ` +
    `1 ordered + ${SHUFFLED_PASS_COUNT} shuffled passes`,
);
const replayRows = benchDataset.concat(corpusSlice);
verifyRowsInOrder(replayRows, createSequentialIndices(replayRows.length));
for (let passIndex = 0; passIndex < SHUFFLED_PASS_COUNT; passIndex++) {
  verifyRowsInOrder(replayRows, createShuffledIndices(replayRows.length, random));
}

logPhase("phase B: falsy/truthy toggle variants interleaved with originals");
const toggleSourceRows: ClassValue[][] = benchDataset.slice();
for (let rowIndex = 0; rowIndex < corpusSlice.length; rowIndex += TOGGLE_SUBSAMPLE_STRIDE) {
  toggleSourceRows.push(corpusSlice[rowIndex]!);
}
for (let rowIndex = 0; rowIndex < toggleSourceRows.length; rowIndex++) {
  const row = toggleSourceRows[rowIndex]!;
  const falsyFlippedRow = row.map((value, slotIndex) =>
    value === false || value === null || value === undefined || value === ""
      ? TOGGLE_REPLACEMENT_CLASS_NAMES[
          (rowIndex + slotIndex) % TOGGLE_REPLACEMENT_CLASS_NAMES.length
        ]!
      : value,
  );
  const truthyFlippedRow = row.map((value, slotIndex) =>
    slotIndex % 2 === 1 && typeof value === "string" ? false : value,
  );
  verifyCall(row);
  verifyCall(falsyFlippedRow);
  verifyCall(row);
  verifyCall(truthyFlippedRow);
}

const createStormClassList = (stormIndex: number): string =>
  `storm-${stormIndex} flex p-2 px-${stormIndex % 64} text-[${stormIndex}px] ` +
  `hover:bg-red-${(stormIndex % 9) + 1}00`;

logPhase(
  `phase C1: whole-string storm, ${STRING_STORM_UNIQUE_COUNT} unique class lists x2 ` +
    "(forces doorkeeper swaps, capacity growth, and merge-cache rotation)",
);
for (let stormIndex = 0; stormIndex < STRING_STORM_UNIQUE_COUNT; stormIndex++) {
  const stormClassList = createStormClassList(stormIndex);
  verifyCall([stormClassList]);
  verifyCall([stormClassList]);
}

logPhase(
  `phase C2: argument-cache storm, ${BUCKET_STORM_ANCHOR_COUNT} anchors x ` +
    `${BUCKET_STORM_ENTRIES_PER_ANCHOR} entries x3 arities x2 passes ` +
    "(forces bucket trims and arg-cache rotation)",
);
for (let anchorIndex = 0; anchorIndex < BUCKET_STORM_ANCHOR_COUNT; anchorIndex++) {
  const anchorClassList = `bucket-anchor-${anchorIndex} p-4`;
  const anchorRows: ClassValue[][] = [];
  for (let entryIndex = 0; entryIndex < BUCKET_STORM_ENTRIES_PER_ANCHOR; entryIndex++) {
    anchorRows.push([`storm-two-${anchorIndex}-${entryIndex}`, anchorClassList]);
    anchorRows.push([
      `storm-three-${anchorIndex}-${entryIndex}`,
      entryIndex % 2 === 0 ? false : null,
      anchorClassList,
    ]);
    anchorRows.push([
      `storm-many-a-${anchorIndex}-${entryIndex}`,
      `storm-many-b-${anchorIndex}-${entryIndex}`,
      null,
      `storm-many-c-${anchorIndex}-${entryIndex}`,
      anchorClassList,
    ]);
  }
  verifyRowsInOrder(anchorRows, createSequentialIndices(anchorRows.length));
  verifyRowsInOrder(anchorRows, createSequentialIndices(anchorRows.length));
  verifyRowsInOrder(anchorRows, createSequentialIndices(BUCKET_STORM_RECHECK_COUNT));
}

logPhase("phase D: post-storm re-replay of earlier rows (stale-after-eviction check)");
verifyRowsInOrder(benchDataset, createSequentialIndices(benchDataset.length));
verifyRowsInOrder(corpusSlice, createSequentialIndices(POST_STORM_CORPUS_RECHECK_COUNT));
for (
  let stormIndex = 0;
  stormIndex < STRING_STORM_UNIQUE_COUNT;
  stormIndex += STRING_STORM_RECHECK_STRIDE
) {
  verifyCall([createStormClassList(stormIndex)]);
}

logPhase("phase E: object/array/mixed class values, repeated in shuffled orders");
const mixedValueRows: ClassValue[][] = [];
for (let rowIndex = 0; rowIndex < MIXED_VALUE_ROW_COUNT; rowIndex++) {
  mixedValueRows.push([
    "p-2",
    {
      [`text-red-${(rowIndex % 9) + 1}00`]: rowIndex % 2 === 0,
      hidden: rowIndex % 3 === 0,
    },
    null,
  ]);
  mixedValueRows.push([
    ["flex", ["gap-2", rowIndex % 2 === 0 && `m-${rowIndex % 12}`]],
    `leading-[1.${rowIndex % 10}em]`,
  ]);
}
for (let passIndex = 0; passIndex < MIXED_VALUE_PASS_COUNT; passIndex++) {
  verifyRowsInOrder(mixedValueRows, createShuffledIndices(mixedValueRows.length, random));
}

console.log(
  `\nVerified ${totalCallCount} sequential calls through one stateful cn instance ` +
    "against fresh clsx + tailwind-merge output.",
);
if (mismatchCount > 0) {
  console.error(
    `Mismatches: ${mismatchCount}` +
      (mismatchCount > MISMATCH_SAMPLE_LIMIT
        ? ` (first ${MISMATCH_SAMPLE_LIMIT} shown above)`
        : ""),
  );
  process.exit(1);
}
console.log("Every call was byte-identical: no stale or cross-wired cached results.");
