import { type ClassListArgs, type ClassNameImplementation } from "../lib/harness";

export const createClassListReplay =
  (classListCases: ClassListArgs[]) =>
  (implementation: ClassNameImplementation): number => {
    let resultLengthSum = 0;
    for (let index = 0; index < classListCases.length; index++) {
      resultLengthSum += implementation(...classListCases[index]!).length;
    }
    return resultLengthSum;
  };
