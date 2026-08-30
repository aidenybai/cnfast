import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { twMerge as twMergeReference } from "tailwind-merge";
import { twMerge } from "./src/index.js";
import { createSeededRandom } from "./utils/create-seeded-random";

type ClassListArgs = (string | false | null)[];

interface ParityMismatch {
  input: ClassListArgs | string;
  actualOutput: string;
  referenceOutput: string;
}

const FUZZ_ITERATION_COUNT = 20_000;
const MAX_FUZZ_CLASS_COUNT = 12;
const MAX_RECORDED_MISMATCH_COUNT = 10;

const datasetUrl = new URL("./tailwind-merge/tw-merge-benchmark-data.json", import.meta.url);
const dataset: ClassListArgs[] = JSON.parse(readFileSync(fileURLToPath(datasetUrl), "utf8"));

const tokenPool = Array.from(
  new Set(
    dataset
      .flat()
      .filter((value): value is string => typeof value === "string")
      .flatMap((value) => value.split(/\s+/))
      .filter(Boolean),
  ),
);

describe("parity with tailwind-merge", () => {
  it("matches twMerge across the real-world dataset", () => {
    const mismatches: ParityMismatch[] = [];
    for (const classListArguments of dataset) {
      const actualOutput = twMerge(...classListArguments);
      const referenceOutput = twMergeReference(...classListArguments);
      if (actualOutput !== referenceOutput) {
        mismatches.push({ input: classListArguments, actualOutput, referenceOutput });
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("matches twMerge across randomly fuzzed class lists", () => {
    const random = createSeededRandom(0x1234abcd);
    const getRandomClassName = () => tokenPool[Math.floor(random.getNext() * tokenPool.length)]!;

    const mismatches: ParityMismatch[] = [];
    for (let iteration = 0; iteration < FUZZ_ITERATION_COUNT; iteration++) {
      const classCount = 1 + Math.floor(random.getNext() * MAX_FUZZ_CLASS_COUNT);
      let input = "";
      for (let index = 0; index < classCount; index++) {
        input += (index ? " " : "") + getRandomClassName();
      }
      const actualOutput = twMerge(input);
      const referenceOutput = twMergeReference(input);
      if (actualOutput !== referenceOutput) {
        mismatches.push({ input, actualOutput, referenceOutput });
        if (mismatches.length >= MAX_RECORDED_MISMATCH_COUNT) break;
      }
    }
    expect(mismatches).toEqual([]);
  });
});
