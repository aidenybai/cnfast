import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const testsDir = fileURLToPath(new URL("../tests/tailwind-merge", import.meta.url));
const outputUrl = new URL("../bench/cases.json", import.meta.url);

const STRING_LITERAL_REGEX = /(['"])((?:\\.|(?!\1).)*)\1/g;
const LOOKS_LIKE_CLASS_LIST = /^[\w[\](){}!:/.,#%&+*~<>=@-][\w\s[\](){}!:/.,#%&+*~<>=@-]*$/;

const cases = new Set<string>();

for (const file of readdirSync(testsDir)) {
  if (!file.endsWith(".test.ts")) continue;
  const contents = readFileSync(`${testsDir}/${file}`, "utf8");
  for (const match of contents.matchAll(STRING_LITERAL_REGEX)) {
    const value = match[2]!;
    if (value && LOOKS_LIKE_CLASS_LIST.test(value)) {
      cases.add(value);
    }
  }
}

const sorted = [...cases].sort();
writeFileSync(fileURLToPath(outputUrl), `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`Extracted ${sorted.length} benchmark cases from the test set -> bench/cases.json`);
