import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

interface ReportStep {
  title: string;
  file: string;
}

const reportSteps: ReportStep[] = [
  {
    title: "1/4  Correctness: output parity vs clsx + tailwind-merge",
    file: "scripts/verify-parity.ts",
  },
  { title: "2/4  Bundle size", file: "scripts/bundle-size.ts" },
  {
    title: "3/4  Throughput: micro + corpus + page replay + data grid (unified geomean)",
    file: "bench/index.ts",
  },
  { title: "4/4  SSR throughput", file: "bench/ssr.bench.ts" },
];

const packageDirectoryPath = fileURLToPath(new URL("..", import.meta.url));

for (const step of reportSteps) {
  console.log(`\n=== ${step.title} ===`);
  execFileSync("bun", [step.file], { cwd: packageDirectoryPath, stdio: "inherit" });
}

console.log("\nDone.");
