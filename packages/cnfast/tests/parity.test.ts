import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { twMerge as twMergeReference } from "tailwind-merge";
import { twMerge } from "./src/index.js";

type ClassListArgs = (string | false | null)[];

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

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe("parity with tailwind-merge", () => {
  it("matches twMerge across the real-world dataset", () => {
    const mismatches: { input: ClassListArgs; ours: string; reference: string }[] = [];
    for (const args of dataset) {
      const ours = twMerge(...args);
      const reference = twMergeReference(...args);
      if (ours !== reference) {
        mismatches.push({ input: args, ours, reference });
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("matches twMerge across randomly fuzzed class lists", () => {
    const random = createRandom(0x1234abcd);
    const pick = () => tokenPool[Math.floor(random() * tokenPool.length)]!;

    const mismatches: { input: string; ours: string; reference: string }[] = [];
    for (let iteration = 0; iteration < 20000; iteration++) {
      const count = 1 + Math.floor(random() * 12);
      let input = "";
      for (let index = 0; index < count; index++) {
        input += (index ? " " : "") + pick();
      }
      const ours = twMerge(input);
      const reference = twMergeReference(input);
      if (ours !== reference) {
        mismatches.push({ input, ours, reference });
        if (mismatches.length >= 10) break;
      }
    }
    expect(mismatches).toEqual([]);
  });
});
