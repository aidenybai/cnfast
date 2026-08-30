import { runSuite, type Workload } from "./lib/harness";

const INPUT_COUNT = 6000;

const fewOutputInputs: string[] = [];
for (let index = 0; index < INPUT_COUNT; index++) {
  fewOutputInputs.push(`p-[${index}px] p-4 flex row-${index % 16}`);
}

const uniqueOutputInputs: string[] = [];
for (let index = 0; index < INPUT_COUNT; index++) {
  uniqueOutputInputs.push(`p-[${index}px] p-4 flex u-${index}`);
}

const workloads: Workload[] = [
  {
    group: "result-intern",
    name: "few-outputs / map-keyed consumer",
    meta: `(${INPUT_COUNT} inputs -> 16 outputs)`,
    run: (implementation) => {
      let resultLengthSum = 0;
      const outputCounts = new Map<string, number>();
      for (let index = 0; index < INPUT_COUNT; index++) {
        const className = implementation(fewOutputInputs[index]!);
        outputCounts.set(className, (outputCounts.get(className) ?? 0) + 1);
        resultLengthSum += className.length;
      }
      return resultLengthSum + outputCounts.size;
    },
  },
  {
    group: "result-intern",
    name: "few-outputs / nested cn",
    meta: `(${INPUT_COUNT} inputs -> 16 outputs, result fed back in)`,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let index = 0; index < INPUT_COUNT; index++) {
        const innerClassName = implementation(fewOutputInputs[index]!);
        resultLengthSum += implementation(innerClassName, "shrink-0").length;
      }
      return resultLengthSum;
    },
  },
  {
    group: "result-intern",
    name: "unique-outputs / overhead",
    meta: `(${INPUT_COUNT} inputs, no repeats)`,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let index = 0; index < INPUT_COUNT; index++) {
        resultLengthSum += implementation(uniqueOutputInputs[index]!).length;
      }
      return resultLengthSum;
    },
  },
];

await runSuite(workloads, process.env.BENCH_LABEL ?? "result-intern");
