import { RESULT_REUSE_INPUT_COUNT } from "../constants";
import { type ClassListArgs, type Workload } from "../lib/harness";

const fewOutputInputs: string[] = [];
for (let index = 0; index < RESULT_REUSE_INPUT_COUNT; index++) {
  fewOutputInputs.push(`p-[${index}px] p-4 flex row-${index % 16}`);
}

const uniqueOutputInputs: string[] = [];
for (let index = 0; index < RESULT_REUSE_INPUT_COUNT; index++) {
  uniqueOutputInputs.push(`p-[${index}px] p-4 flex u-${index}`);
}

const fewOutputCases: ClassListArgs[] = fewOutputInputs.map((classList) => [classList]);
const uniqueOutputCases: ClassListArgs[] = uniqueOutputInputs.map((classList) => [classList]);

export const getResultReuseWorkloads = (): Workload[] => [
  {
    group: "result reuse",
    name: "map-keyed consumer",
    meta: `(${RESULT_REUSE_INPUT_COUNT} inputs, 16 outputs)`,
    classListCases: fewOutputCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      const outputCounts = new Map<string, number>();
      for (let index = 0; index < RESULT_REUSE_INPUT_COUNT; index++) {
        const className = implementation(fewOutputInputs[index]!);
        outputCounts.set(className, (outputCounts.get(className) ?? 0) + 1);
        resultLengthSum += className.length;
      }
      return resultLengthSum + outputCounts.size;
    },
  },
  {
    group: "result reuse",
    name: "nested cn",
    meta: `(${RESULT_REUSE_INPUT_COUNT} inputs, 16 outputs fed back in)`,
    classListCases: fewOutputCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let index = 0; index < RESULT_REUSE_INPUT_COUNT; index++) {
        const innerClassName = implementation(fewOutputInputs[index]!);
        resultLengthSum += implementation(innerClassName, "shrink-0").length;
      }
      return resultLengthSum;
    },
  },
  {
    group: "result reuse",
    name: "unique output overhead",
    meta: `(${RESULT_REUSE_INPUT_COUNT} unique inputs and outputs)`,
    classListCases: uniqueOutputCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let index = 0; index < RESULT_REUSE_INPUT_COUNT; index++) {
        resultLengthSum += implementation(uniqueOutputInputs[index]!).length;
      }
      return resultLengthSum;
    },
  },
];
