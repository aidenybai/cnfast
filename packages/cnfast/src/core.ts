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

/**
 * Calls ending in the same class share a flat bucket:
 * `[callCount, otherClassCount, ...otherClasses, result, id, ...]`.
 */
type ArgumentCacheBucket = (string | number)[];

const trimBucket = (bucket: ArgumentCacheBucket): void => {
  const entryCount = bucket[0] as number;
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
    } else if ((bucket[0] as number) >= ARGUMENT_CACHE_BUCKET_ENTRIES) {
      trimBucket(bucket);
    }
    return bucket;
  };

  const mergeUncachedClassValues = (classValues: ClassValue[]): string => {
    const classValueCount = classValues.length;
    let classList = "";
    for (let index = 0; index < classValueCount; index++) {
      const classValue = classValues[index];
      if (!classValue) continue;
      const resolvedClassName =
        typeof classValue === "string" ? classValue : resolveClassValue(classValue);
      if (resolvedClassName) {
        if (classList) classList += SPACE_CHARACTER;
        classList += resolvedClassName;
      }
    }

    return twMerge.mergeString(classList);
  };

  // Keep miss handling outside the cache-hit function so V8 can optimize the smaller function.
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
    return twMerge.mergeParts(classList, classListPartsScratch, partCount);
  };

  // Reading two parameters directly avoids the 257-byte array allocated by the generic path.
  const getMergedClassNameForTwoValues = (
    firstClassValue: ClassValue,
    secondClassValue: ClassValue,
  ): string => {
    if (typeof firstClassValue === "string" && firstClassValue !== "") {
      if (typeof secondClassValue === "string" && secondClassValue !== "") {
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
        const classList = firstClassValue + SPACE_CHARACTER + secondClassValue;
        const mergedClassName = twMerge.mergeParts2(classList, firstClassValue, secondClassValue);
        if (shouldCacheArguments(classList)) {
          const cacheBucket = getWritableArgumentCacheBucket(secondClassValue, bucket);
          cacheBucket.push(
            1,
            firstClassValue,
            mergedClassName,
            createArgumentCacheEntryId(secondClassValue, cacheBucket, cacheBucket.length),
          );
          cacheBucket[0] = (cacheBucket[0] as number) + 1;
          addArgumentCacheSlots(3);
        }
        return mergedClassName;
      }
      if (!secondClassValue) return twMerge.mergeString(firstClassValue);
      return mergeUncachedClassValues([firstClassValue, secondClassValue]);
    }
    if (!firstClassValue) {
      if (!secondClassValue) return "";
      if (typeof secondClassValue === "string") return twMerge.mergeString(secondClassValue);
      return mergeUncachedClassValues([firstClassValue, secondClassValue]);
    }
    return mergeUncachedClassValues([firstClassValue, secondClassValue]);
  };

  const getMergedClassNameForThreeValues = (
    firstClassValue: ClassValue,
    secondClassValue: ClassValue,
    thirdClassValue: ClassValue,
  ): string => {
    if (typeof firstClassValue === "string" && firstClassValue !== "") {
      if (typeof secondClassValue === "string" && secondClassValue !== "") {
        if (typeof thirdClassValue === "string" && thirdClassValue !== "") {
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
          const classList =
            firstClassValue +
            SPACE_CHARACTER +
            secondClassValue +
            SPACE_CHARACTER +
            thirdClassValue;
          const mergedClassName = twMerge.mergeParts3(
            classList,
            firstClassValue,
            secondClassValue,
            thirdClassValue,
          );
          if (shouldCacheArguments(classList)) {
            const cacheBucket = getWritableArgumentCacheBucket(thirdClassValue, bucket);
            cacheBucket.push(
              2,
              firstClassValue,
              secondClassValue,
              mergedClassName,
              createArgumentCacheEntryId(thirdClassValue, cacheBucket, cacheBucket.length),
            );
            cacheBucket[0] = (cacheBucket[0] as number) + 1;
            addArgumentCacheSlots(4);
          }
          return mergedClassName;
        }
        if (!thirdClassValue)
          return getMergedClassNameForTwoValues(firstClassValue, secondClassValue);
        return mergeUncachedClassValues([firstClassValue, secondClassValue, thirdClassValue]);
      }
      if (!secondClassValue) {
        if (!thirdClassValue) return twMerge.mergeString(firstClassValue);
        if (typeof thirdClassValue === "string")
          return getMergedClassNameForTwoValues(firstClassValue, thirdClassValue);
        return mergeUncachedClassValues([firstClassValue, secondClassValue, thirdClassValue]);
      }
      return mergeUncachedClassValues([firstClassValue, secondClassValue, thirdClassValue]);
    }
    if (!firstClassValue) return getMergedClassNameForTwoValues(secondClassValue, thirdClassValue);
    return mergeUncachedClassValues([firstClassValue, secondClassValue, thirdClassValue]);
  };

  // Keeping this path separate prevents V8 from deoptimizing the single-value path.
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
      if (truthyStringCount === 1) return twMerge.mergeString(firstClassName);

      const restLengthWanted = truthyStringCount - 1;

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

      let classList = firstClassName;
      for (let index = firstClassNameIndex + 1; index < classValueCount; index++) {
        const classValue = classValues[index];
        if (classValue) classList += SPACE_CHARACTER + (classValue as string);
      }

      // Collect prepared parts only after the whole-string probe misses. Passing parts through the
      // hit path reduced multi-value page-replay throughput by 6% to 8% on Node.js.
      let mergedClassName = twMerge.peekString(classList);
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
        cacheBucket[0] = (cacheBucket[0] as number) + 1;
        addArgumentCacheSlots(restLengthWanted + 2);
      }

      return mergedClassName;
    }

    return mergeUncachedClassValues(classValues);
  };

  // V8 can omit the `arguments` allocation on the common paths. A rest parameter always creates
  // an array.
  /* eslint-disable prefer-rest-params -- a rest param would defeat the allocation-elision this relies on */
  const cn: ClassNameFunction = function (): string {
    const firstClassValue = arguments[0];
    const classValueCount = arguments.length;

    if (classValueCount === 1) {
      return typeof firstClassValue === "string"
        ? twMerge.mergeString(firstClassValue)
        : twMerge.mergeString(resolveClassValue(firstClassValue));
    }

    if (classValueCount === 2) return getMergedClassNameForTwoValues(firstClassValue, arguments[1]);
    if (classValueCount === 3)
      return getMergedClassNameForThreeValues(firstClassValue, arguments[1], arguments[2]);

    // A preallocated array measured 9% faster than repeated `push` calls here.
    const classValues: ClassValue[] = new Array(classValueCount);
    for (let index = 0; index < classValueCount; index++) classValues[index] = arguments[index];
    return getMergedClassNameForManyValues(classValues);
  };
  /* eslint-enable prefer-rest-params */

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
