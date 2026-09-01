import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { cn } from "../src/index.js";
import { type ClassListArgs } from "./lib/harvest-classes";
import { loadCorpora } from "./lib/load-corpus";

const referenceCn = (...inputs: ClassListArgs): string => twMerge(clsx(inputs));

let classGroupCount = 0;
let mismatchCount = 0;
const mismatchSamples: string[] = [];

for (const corpus of loadCorpora()) {
  for (const classGroup of corpus.groups) {
    classGroupCount++;
    const cnfastOutput = cn(...classGroup);
    const referenceOutput = referenceCn(...classGroup);
    if (cnfastOutput !== referenceOutput) {
      mismatchCount++;
      if (mismatchSamples.length < 10) {
        mismatchSamples.push(
          `[${corpus.name}] in=${JSON.stringify(classGroup)}\n  cnfast:    ${cnfastOutput}\n  reference: ${referenceOutput}`,
        );
      }
    }
  }
}

console.log(`Checked ${classGroupCount} real-world call groups across all corpora.`);
console.log(
  `Mismatches vs twMerge(clsx(...)): ${mismatchCount} ` +
    `(${((mismatchCount / classGroupCount) * 100).toFixed(4)}%)`,
);
if (mismatchSamples.length > 0) {
  console.log(`\nFirst mismatches:\n${mismatchSamples.join("\n\n")}`);
  process.exit(1);
}
console.log("\ncnfast output is byte-identical to clsx + tailwind-merge on every input.");
