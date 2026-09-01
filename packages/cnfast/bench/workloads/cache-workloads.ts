import {
  CACHE_GENERATION_WORKING_SET_SIZE,
  CACHE_HOT_CALL_COUNT,
  CACHE_LARGE_WORKING_SET_SIZE,
  CACHE_MAX_WORKING_SET_SIZE,
  CACHE_MEDIUM_WORKING_SET_SIZE,
  CACHE_SMALL_WORKING_SET_SIZE,
  CACHE_THRASH_WORKING_SET_SIZE,
} from "../constants";
import { type ClassListArgs, type Workload } from "../lib/harness";
import { createClassListReplay } from "../utils/create-class-list-replay";

const getWorkingSet = (size: number, prefix: string): ClassListArgs[] => {
  const classListCases: ClassListArgs[] = [];
  for (let index = 0; index < size; index++) {
    classListCases.push([
      `flex px-${index % 8} px-${(index + 3) % 8} bg-blue-${((index % 9) + 1) * 100} ${prefix}-${index}`,
    ]);
  }
  return classListCases;
};

const getRepeatedCases = (classListCases: ClassListArgs[], callCount: number): ClassListArgs[] => {
  const repeatedCases: ClassListArgs[] = [];
  for (let index = 0; index < callCount; index++) {
    repeatedCases.push(classListCases[index % classListCases.length]!);
  }
  return repeatedCases;
};

const getWorkload = (
  group: string,
  name: string,
  classListCases: ClassListArgs[],
  uniqueCaseCount: number,
): Workload => ({
  group,
  name,
  meta: `(${classListCases.length} calls, ${uniqueCaseCount} unique)`,
  classListCases,
  run: createClassListReplay(classListCases),
});

export const getCacheWorkloads = (): Workload[] => {
  const singleCase = getWorkingSet(1, "hot");
  const smallWorkingSet = getWorkingSet(CACHE_SMALL_WORKING_SET_SIZE, "small");
  const mediumWorkingSet = getWorkingSet(CACHE_MEDIUM_WORKING_SET_SIZE, "medium");
  const largeWorkingSet = getWorkingSet(CACHE_LARGE_WORKING_SET_SIZE, "large");
  const maxWorkingSet = getWorkingSet(CACHE_MAX_WORKING_SET_SIZE, "max");
  const thrashWorkingSet = getWorkingSet(CACHE_THRASH_WORKING_SET_SIZE, "thrash");

  const firstGeneration = getWorkingSet(CACHE_GENERATION_WORKING_SET_SIZE, "generation-a");
  const secondGeneration = getWorkingSet(CACHE_GENERATION_WORKING_SET_SIZE, "generation-b");
  const generationReuseCases = [...firstGeneration, ...secondGeneration, ...firstGeneration];

  const skewedHotCases = getWorkingSet(CACHE_SMALL_WORKING_SET_SIZE, "skewed-hot");
  const skewedColdCases = getWorkingSet(CACHE_THRASH_WORKING_SET_SIZE / 4, "skewed-cold");
  const skewedCases: ClassListArgs[] = [];
  let coldIndex = 0;
  for (let index = 0; index < CACHE_THRASH_WORKING_SET_SIZE; index++) {
    if (index % 4 === 0) skewedCases.push(skewedColdCases[coldIndex++]!);
    else skewedCases.push(skewedHotCases[index % skewedHotCases.length]!);
  }

  return [
    getWorkload(
      "cached",
      "single hot key",
      getRepeatedCases(singleCase, CACHE_HOT_CALL_COUNT),
      singleCase.length,
    ),
    getWorkload(
      "cached",
      "small working set",
      getRepeatedCases(smallWorkingSet, CACHE_HOT_CALL_COUNT),
      smallWorkingSet.length,
    ),
    getWorkload(
      "cached",
      "medium working set",
      getRepeatedCases(mediumWorkingSet, CACHE_HOT_CALL_COUNT),
      mediumWorkingSet.length,
    ),
    getWorkload(
      "cache boundary",
      "large working set",
      getRepeatedCases(largeWorkingSet, CACHE_HOT_CALL_COUNT),
      largeWorkingSet.length,
    ),
    getWorkload("cache boundary", "2048-key working set", maxWorkingSet, maxWorkingSet.length),
    getWorkload("uncached", "cache thrash", thrashWorkingSet, thrashWorkingSet.length),
    getWorkload(
      "cache boundary",
      "generation reuse",
      generationReuseCases,
      firstGeneration.length + secondGeneration.length,
    ),
    getWorkload(
      "cache boundary",
      "75% hot mixed traffic",
      skewedCases,
      skewedHotCases.length + skewedColdCases.length,
    ),
  ];
};
