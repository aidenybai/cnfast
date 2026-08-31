import { type ClassValue, resolveClassValue } from "./clsx.js";
import {
  ARGUMENT_CACHE_BUCKET_ENTRIES,
  ARGUMENT_CACHE_PREDICTION_SLOTS,
  ARGUMENT_CACHE_ROTATION_SLOTS,
  ARGUMENT_CACHE_SEEN_ONCE_CAPACITY,
  OPEN_BRACKET_CHARACTER,
  SPACE_CHARACTER,
} from "./lib/constants.js";
import { createFilledArray } from "./utils/create-filled-array.js";
import { createTailwindMerge, type TailwindMerge } from "./lib/create-tailwind-merge.js";
import { getDefaultConfig } from "./lib/default-config.js";
import { mergeConfigs } from "./lib/merge-configs.js";
import { twMerge } from "./lib/tw-merge.js";
import type { AnyConfig, ConfigExtension } from "./lib/types.js";

export interface ClassNameFunction {
  (...classValues: ClassValue[]): string;
}

interface ArgumentCacheBucket extends Array<string | number> {
  0: number;
}

const trimBucket = (bucket: ArgumentCacheBucket): void => {
  const entryCount = bucket[0];
  const dropCount = entryCount >> 1;
  let position = 1;
  for (let index = 0; index < dropCount; index++) position += (bucket[position] as number) + 3;
  bucket.copyWithin(1, position);
  bucket.length -= position - 1;
  bucket[0] = entryCount - dropCount;
};

const ARGUMENT_CACHE_PREDICTION_ID_MASK = ARGUMENT_CACHE_PREDICTION_SLOTS - 1;
const EMPTY_BUCKET: ArgumentCacheBucket = [0];

const createClassNameFunction = (twMerge: TailwindMerge): ClassNameFunction => {
  const mergeString = twMerge.mergeString;
  const mergeParts2 = twMerge.mergeParts2;
  const mergeParts3 = twMerge.mergeParts3;
  const mergeParts = twMerge.mergeParts;
  const peekString = twMerge.peekString;

  let argumentCache = new Map<string, ArgumentCacheBucket>();
  let previousArgumentCache = new Map<string, ArgumentCacheBucket>();
  let argumentCacheSlotCount = 0;

  const successorIds = new Int32Array(ARGUMENT_CACHE_PREDICTION_SLOTS).fill(-1);
  const predictedAnchors: string[] = createFilledArray(ARGUMENT_CACHE_PREDICTION_SLOTS, "");
  const predictedBuckets: ArgumentCacheBucket[] = createFilledArray(
    ARGUMENT_CACHE_PREDICTION_SLOTS,
    EMPTY_BUCKET,
  );
  const predictedPositions = new Int32Array(ARGUMENT_CACHE_PREDICTION_SLOTS);
  let lastHitId = 0;
  let nextEntryId = 0;

  const setArgumentCachePrediction = (
    anchorClassName: string,
    bucket: ArgumentCacheBucket,
    position: number,
    entryId: number,
  ): void => {
    predictedAnchors[entryId] = anchorClassName;
    predictedBuckets[entryId] = bucket;
    predictedPositions[entryId] = position;
    successorIds[lastHitId] = entryId;
    lastHitId = entryId;
  };

  const createArgumentCacheEntryId = (
    anchorClassName: string,
    bucket: ArgumentCacheBucket,
    position: number,
  ): number => {
    const entryId = nextEntryId;
    nextEntryId = (entryId + 1) & ARGUMENT_CACHE_PREDICTION_ID_MASK;
    successorIds[entryId] = -1;
    setArgumentCachePrediction(anchorClassName, bucket, position, entryId);
    return entryId;
  };

  let seenClassListsOnce = new Set<string>();
  let previousSeenClassListsOnce = new Set<string>();

  const classListPartsScratch: string[] = [];

  const shouldCacheArguments = (classList: string): boolean => {
    if (classList.indexOf(OPEN_BRACKET_CHARACTER) === -1) return true;
    if (seenClassListsOnce.has(classList) || previousSeenClassListsOnce.has(classList)) return true;
    seenClassListsOnce.add(classList);
    if (seenClassListsOnce.size > ARGUMENT_CACHE_SEEN_ONCE_CAPACITY) {
      previousSeenClassListsOnce = seenClassListsOnce;
      seenClassListsOnce = new Set();
    }
    return false;
  };

  const getAndPromoteArgumentCacheBucket = (
    anchorClassName: string,
  ): ArgumentCacheBucket | undefined => {
    const bucket = argumentCache.get(anchorClassName);
    if (bucket !== undefined) return bucket;
    const previous = previousArgumentCache.get(anchorClassName);
    if (previous !== undefined) argumentCache.set(anchorClassName, previous);
    return previous;
  };

  const addArgumentCacheSlots = (slotCount: number): void => {
    argumentCacheSlotCount += slotCount;
    if (argumentCacheSlotCount > ARGUMENT_CACHE_ROTATION_SLOTS) {
      argumentCacheSlotCount = 0;
      previousArgumentCache = argumentCache;
      argumentCache = new Map();
    }
  };

  const getWritableArgumentCacheBucket = (
    anchorClassName: string,
    bucket: ArgumentCacheBucket | undefined,
  ): ArgumentCacheBucket => {
    if (bucket === undefined) {
      bucket = [0];
      argumentCache.set(anchorClassName, bucket);
    } else if (bucket[0] >= ARGUMENT_CACHE_BUCKET_ENTRIES) {
      trimBucket(bucket);
    }
    return bucket;
  };

  // Objects/arrays must be re-resolved every call (clsx semantics), but the merged
  // result depends only on the resolved strings, so after resolving in place the row
  // can share the argument cache with plain-string calls — bucket === compares on the
  // fresh strings beat hashing the fresh full class list in the whole-string cache.
  const resolveAndMergeClassValues = (classValues: ClassValue[]): string => {
    for (let index = 0, length = classValues.length; index < length; index++) {
      const classValue = classValues[index];
      if (classValue && typeof classValue !== "string")
        classValues[index] = resolveClassValue(classValue);
    }
    return getMergedClassNameForManyValues(classValues);
  };

  const mergePartsOnMiss = (
    classList: string,
    classValues: ClassValue[],
    firstClassNameIndex: number,
  ): string => {
    let partCount = 0;
    for (let index = firstClassNameIndex, length = classValues.length; index < length; index++) {
      const classValue = classValues[index];
      if (classValue) classListPartsScratch[partCount++] = classValue as string;
    }
    return mergeParts(classList, classListPartsScratch, partCount);
  };

  const insertTwoValuesOnMiss = (
    firstClassName: string,
    secondClassName: string,
    bucket: ArgumentCacheBucket | undefined,
  ): string => {
    const classList = firstClassName + SPACE_CHARACTER + secondClassName;
    const mergedClassName = mergeParts2(classList, firstClassName, secondClassName);
    if (shouldCacheArguments(classList)) {
      const cacheBucket = getWritableArgumentCacheBucket(secondClassName, bucket);
      cacheBucket.push(
        1,
        firstClassName,
        mergedClassName,
        createArgumentCacheEntryId(secondClassName, cacheBucket, cacheBucket.length),
      );
      cacheBucket[0] = cacheBucket[0] + 1;
      addArgumentCacheSlots(3);
    }
    return mergedClassName;
  };

  const mergeTwoValuesUncacheable = (
    firstClassValue: ClassValue,
    secondClassValue: ClassValue,
  ): string => {
    if (typeof firstClassValue === "string" && firstClassValue !== "") {
      if (!secondClassValue) return mergeString(firstClassValue);
      return getMergedClassNameForTwoValues(firstClassValue, resolveClassValue(secondClassValue));
    }
    if (!firstClassValue) {
      if (!secondClassValue) return "";
      if (typeof secondClassValue === "string") return mergeString(secondClassValue);
      return mergeString(resolveClassValue(secondClassValue));
    }
    return getMergedClassNameForTwoValues(resolveClassValue(firstClassValue), secondClassValue);
  };

  const getMergedClassNameForTwoValues = (
    firstClassValue: ClassValue,
    secondClassValue: ClassValue,
  ): string => {
    // predictedAnchors and cached rest slots only ever hold truthy interned
    // strings, so these identity checks double as the type/truthiness guards
    // for both operands on the hit path.
    const predictedId = successorIds[lastHitId]!;
    if (predictedId !== -1 && predictedAnchors[predictedId] === secondClassValue) {
      const predictedBucket = predictedBuckets[predictedId]!;
      const predictedPosition = predictedPositions[predictedId]!;
      if (
        predictedBucket[predictedPosition] === 1 &&
        predictedBucket[predictedPosition + 1] === firstClassValue
      ) {
        lastHitId = predictedId;
        return predictedBucket[predictedPosition + 2] as string;
      }
    }
    if (
      typeof firstClassValue === "string" &&
      firstClassValue !== "" &&
      typeof secondClassValue === "string" &&
      secondClassValue !== ""
    ) {
      const bucket = getAndPromoteArgumentCacheBucket(secondClassValue);
      if (bucket !== undefined) {
        for (let position = 1, slots = bucket.length; position < slots; ) {
          const restLength = bucket[position] as number;
          if (restLength === 1 && bucket[position + 1] === firstClassValue) {
            setArgumentCachePrediction(
              secondClassValue,
              bucket,
              position,
              bucket[position + 3] as number,
            );
            return bucket[position + 2] as string;
          }
          position += restLength + 3;
        }
      }
      return insertTwoValuesOnMiss(firstClassValue, secondClassValue, bucket);
    }
    return mergeTwoValuesUncacheable(firstClassValue, secondClassValue);
  };

  const insertThreeValuesOnMiss = (
    firstClassName: string,
    secondClassName: string,
    thirdClassName: string,
    bucket: ArgumentCacheBucket | undefined,
  ): string => {
    const classList =
      firstClassName + SPACE_CHARACTER + secondClassName + SPACE_CHARACTER + thirdClassName;
    const mergedClassName = mergeParts3(classList, firstClassName, secondClassName, thirdClassName);
    if (shouldCacheArguments(classList)) {
      const cacheBucket = getWritableArgumentCacheBucket(thirdClassName, bucket);
      cacheBucket.push(
        2,
        firstClassName,
        secondClassName,
        mergedClassName,
        createArgumentCacheEntryId(thirdClassName, cacheBucket, cacheBucket.length),
      );
      cacheBucket[0] = cacheBucket[0] + 1;
      addArgumentCacheSlots(4);
    }
    return mergedClassName;
  };

  const mergeThreeValuesUncacheable = (
    firstClassValue: ClassValue,
    secondClassValue: ClassValue,
    thirdClassValue: ClassValue,
  ): string => {
    if (typeof firstClassValue === "string" && firstClassValue !== "") {
      if (typeof secondClassValue === "string" && secondClassValue !== "") {
        if (!thirdClassValue)
          return getMergedClassNameForTwoValues(firstClassValue, secondClassValue);
        return getMergedClassNameForThreeValues(
          firstClassValue,
          secondClassValue,
          resolveClassValue(thirdClassValue),
        );
      }
      if (!secondClassValue) {
        if (!thirdClassValue) return mergeString(firstClassValue);
        if (typeof thirdClassValue === "string")
          return getMergedClassNameForTwoValues(firstClassValue, thirdClassValue);
        return getMergedClassNameForTwoValues(firstClassValue, resolveClassValue(thirdClassValue));
      }
      return getMergedClassNameForThreeValues(
        firstClassValue,
        resolveClassValue(secondClassValue),
        thirdClassValue,
      );
    }
    if (!firstClassValue) return getMergedClassNameForTwoValues(secondClassValue, thirdClassValue);
    return getMergedClassNameForThreeValues(
      resolveClassValue(firstClassValue),
      secondClassValue,
      thirdClassValue,
    );
  };

  const getMergedClassNameForThreeValues = (
    firstClassValue: ClassValue,
    secondClassValue: ClassValue,
    thirdClassValue: ClassValue,
  ): string => {
    const predictedId = successorIds[lastHitId]!;
    if (predictedId !== -1 && predictedAnchors[predictedId] === thirdClassValue) {
      const predictedBucket = predictedBuckets[predictedId]!;
      const predictedPosition = predictedPositions[predictedId]!;
      if (
        predictedBucket[predictedPosition] === 2 &&
        predictedBucket[predictedPosition + 2] === secondClassValue &&
        predictedBucket[predictedPosition + 1] === firstClassValue
      ) {
        lastHitId = predictedId;
        return predictedBucket[predictedPosition + 3] as string;
      }
    }
    if (
      typeof firstClassValue === "string" &&
      firstClassValue !== "" &&
      typeof secondClassValue === "string" &&
      secondClassValue !== "" &&
      typeof thirdClassValue === "string" &&
      thirdClassValue !== ""
    ) {
      const bucket = getAndPromoteArgumentCacheBucket(thirdClassValue);
      if (bucket !== undefined) {
        for (let position = 1, slots = bucket.length; position < slots; ) {
          const restLength = bucket[position] as number;
          if (
            restLength === 2 &&
            bucket[position + 2] === secondClassValue &&
            bucket[position + 1] === firstClassValue
          ) {
            setArgumentCachePrediction(
              thirdClassValue,
              bucket,
              position,
              bucket[position + 4] as number,
            );
            return bucket[position + 3] as string;
          }
          position += restLength + 3;
        }
      }
      return insertThreeValuesOnMiss(firstClassValue, secondClassValue, thirdClassValue, bucket);
    }
    return mergeThreeValuesUncacheable(firstClassValue, secondClassValue, thirdClassValue);
  };

  const insertManyValuesOnMiss = (
    classValues: ClassValue[],
    firstClassName: string,
    firstClassNameIndex: number,
    anchorClassName: string,
    anchorClassNameIndex: number,
    restLengthWanted: number,
    bucket: ArgumentCacheBucket | undefined,
  ): string => {
    const classValueCount = classValues.length;
    let classList = firstClassName;
    for (let index = firstClassNameIndex + 1; index < classValueCount; index++) {
      const classValue = classValues[index];
      if (classValue) classList += SPACE_CHARACTER + (classValue as string);
    }

    let mergedClassName = peekString(classList);
    if (mergedClassName === undefined)
      mergedClassName = mergePartsOnMiss(classList, classValues, firstClassNameIndex);

    if (shouldCacheArguments(classList)) {
      const cacheBucket = getWritableArgumentCacheBucket(anchorClassName, bucket);
      const entryPosition = cacheBucket.length;
      cacheBucket.push(restLengthWanted);
      for (let index = firstClassNameIndex; index < anchorClassNameIndex; index++) {
        const classValue = classValues[index];
        if (classValue) cacheBucket.push(classValue as string);
      }
      cacheBucket.push(
        mergedClassName,
        createArgumentCacheEntryId(anchorClassName, cacheBucket, entryPosition),
      );
      cacheBucket[0] = cacheBucket[0] + 1;
      addArgumentCacheSlots(restLengthWanted + 2);
    }

    return mergedClassName;
  };

  const getMergedClassNameForManyValues = (classValues: ClassValue[]): string => {
    const classValueCount = classValues.length;

    let firstClassName = "";
    let anchorClassName = "";
    let firstClassNameIndex = -1;
    let anchorClassNameIndex = -1;
    let truthyStringCount = 0;
    let everyTruthyIsString = true;
    for (let index = 0; index < classValueCount; index++) {
      const classValue = classValues[index];
      if (!classValue) continue;
      if (typeof classValue !== "string") {
        everyTruthyIsString = false;
        break;
      }
      if (firstClassNameIndex === -1) {
        firstClassName = classValue;
        firstClassNameIndex = index;
      }
      anchorClassName = classValue;
      anchorClassNameIndex = index;
      truthyStringCount++;
    }

    if (everyTruthyIsString) {
      if (truthyStringCount === 0) return "";
      if (truthyStringCount === 1) return mergeString(firstClassName);

      const restLengthWanted = truthyStringCount - 1;

      // The entry-level probe only covers truthy final arguments; re-probe
      // here so rows whose anchor precedes trailing falsy values still take
      // the prediction hit instead of a bucket scan.
      if (anchorClassNameIndex !== classValueCount - 1) {
        const predictedId = successorIds[lastHitId]!;
        if (predictedId !== -1 && predictedAnchors[predictedId] === anchorClassName) {
          const predictedBucket = predictedBuckets[predictedId]!;
          const predictedPosition = predictedPositions[predictedId]!;
          if (predictedBucket[predictedPosition] === restLengthWanted) {
            let restIndex = predictedPosition + restLengthWanted;
            let isMatch = true;
            for (let index = anchorClassNameIndex - 1; index >= firstClassNameIndex; index--) {
              const classValue = classValues[index];
              if (!classValue) continue;
              if (classValue !== predictedBucket[restIndex--]) {
                isMatch = false;
                break;
              }
            }
            if (isMatch) {
              lastHitId = predictedId;
              return predictedBucket[predictedPosition + restLengthWanted + 1] as string;
            }
          }
        }
      }

      const bucket = getAndPromoteArgumentCacheBucket(anchorClassName);
      if (bucket !== undefined) {
        for (let position = 1, slots = bucket.length; position < slots; ) {
          const restLength = bucket[position] as number;
          if (restLength === restLengthWanted) {
            let restIndex = position + restLength;
            let isMatch = true;
            for (let index = anchorClassNameIndex - 1; index >= firstClassNameIndex; index--) {
              const classValue = classValues[index];
              if (!classValue) continue;
              if (classValue !== bucket[restIndex--]) {
                isMatch = false;
                break;
              }
            }
            if (isMatch) {
              setArgumentCachePrediction(
                anchorClassName,
                bucket,
                position,
                bucket[position + restLength + 2] as number,
              );
              return bucket[position + restLength + 1] as string;
            }
          }
          position += restLength + 3;
        }
      }

      return insertManyValuesOnMiss(
        classValues,
        firstClassName,
        firstClassNameIndex,
        anchorClassName,
        anchorClassNameIndex,
        restLengthWanted,
        bucket,
      );
    }

    return resolveAndMergeClassValues(classValues);
  };

  const cn: ClassNameFunction = function (): string {
    const firstClassValue = arguments[0];
    const classValueCount = arguments.length;

    if (classValueCount === 1) {
      return typeof firstClassValue === "string"
        ? mergeString(firstClassValue)
        : mergeString(resolveClassValue(firstClassValue));
    }

    if (classValueCount === 2) return getMergedClassNameForTwoValues(firstClassValue, arguments[1]);
    if (classValueCount === 3)
      return getMergedClassNameForThreeValues(firstClassValue, arguments[1], arguments[2]);

    // A truthy final argument is by definition the LAST-truthy anchor, so
    // matching it against the predicted anchor (always a truthy interned
    // string) doubles as the type/truthiness guard; probing here lets a
    // prediction hit skip the new Array copy, the dominant steady-state
    // allocation. Any falsy or non-string value fails the identity checks
    // and falls through to the full path.
    const predictedId = successorIds[lastHitId]!;
    if (predictedId !== -1 && predictedAnchors[predictedId] === arguments[classValueCount - 1]) {
      const predictedBucket = predictedBuckets[predictedId]!;
      const predictedPosition = predictedPositions[predictedId]!;
      const predictedRestLength = predictedBucket[predictedPosition] as number;
      if (predictedRestLength < classValueCount) {
        let restIndex = predictedPosition + predictedRestLength;
        let isMatch = true;
        for (let index = classValueCount - 2; index >= 0; index--) {
          const classValue = arguments[index];
          if (!classValue) continue;
          if (restIndex === predictedPosition || classValue !== predictedBucket[restIndex]) {
            isMatch = false;
            break;
          }
          restIndex--;
        }
        if (isMatch && restIndex === predictedPosition) {
          lastHitId = predictedId;
          return predictedBucket[predictedPosition + predictedRestLength + 1] as string;
        }
      }
    }

    const classValues: ClassValue[] = new Array(classValueCount);
    for (let index = 0; index < classValueCount; index++) classValues[index] = arguments[index];
    return getMergedClassNameForManyValues(classValues);
  };
  return cn;
};

export const cn: ClassNameFunction = createClassNameFunction(twMerge);

export default cn;

export const createCn = (
  config: ConfigExtension | ((defaultConfig: AnyConfig) => AnyConfig),
): ClassNameFunction => {
  const createConfig: () => AnyConfig =
    typeof config === "function"
      ? () => config(getDefaultConfig())
      : () => mergeConfigs(getDefaultConfig(), config);
  return createClassNameFunction(createTailwindMerge(createConfig));
};
