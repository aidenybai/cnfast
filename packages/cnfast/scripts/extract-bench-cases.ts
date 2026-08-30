import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const testsDirectoryPath = fileURLToPath(new URL("../tests/tailwind-merge", import.meta.url));
const outputUrl = new URL("../bench/cases.json", import.meta.url);

const STRING_LITERAL_REGEX = /(['"])((?:\\.|(?!\1).)*)\1/g;
const LOOKS_LIKE_CLASS_LIST = /^[\w[\](){}!:/.,#%&+*~<>=@-][\w\s[\](){}!:/.,#%&+*~<>=@-]*$/;

const benchmarkCases = new Set<string>();

for (const testFileName of readdirSync(testsDirectoryPath)) {
  if (!testFileName.endsWith(".test.ts")) continue;
  const testSource = readFileSync(`${testsDirectoryPath}/${testFileName}`, "utf8");
  for (const stringLiteralMatch of testSource.matchAll(STRING_LITERAL_REGEX)) {
    const stringValue = stringLiteralMatch[2]!;
    if (stringValue && LOOKS_LIKE_CLASS_LIST.test(stringValue)) {
      benchmarkCases.add(stringValue);
    }
  }
}

const sortedBenchmarkCases = [...benchmarkCases].sort();
writeFileSync(fileURLToPath(outputUrl), `${JSON.stringify(sortedBenchmarkCases, null, 2)}\n`);
console.log(
  `Extracted ${sortedBenchmarkCases.length} benchmark cases from the test set -> bench/cases.json`,
);
