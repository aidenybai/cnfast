import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { cn } from "../src/index.js";
import { type ClassListArgs } from "./lib/harvest-classes";
import { loadCorpora } from "./lib/load-corpus";

const referenceCn = (...inputs: ClassListArgs): string => twMerge(clsx(inputs));

let total = 0;
let mismatches = 0;
const samples: string[] = [];

for (const corpus of loadCorpora()) {
  for (const group of corpus.groups) {
    total++;
    const mine = cn(...group);
    const reference = referenceCn(...group);
    if (mine !== reference) {
      mismatches++;
      if (samples.length < 10) {
        samples.push(
          `[${corpus.name}] in=${JSON.stringify(group)}\n  fastcn:    ${mine}\n  reference: ${reference}`,
        );
      }
    }
  }
}

console.log(`Checked ${total} real-world call groups across all corpora.`);
console.log(
  `Mismatches vs twMerge(clsx(...)): ${mismatches} (${((mismatches / total) * 100).toFixed(4)}%)`,
);
if (samples.length > 0) {
  console.log(`\nFirst mismatches:\n${samples.join("\n\n")}`);
  process.exit(1);
}
console.log("\nfastcn output is byte-identical to clsx + tailwind-merge on every input.");
