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
 * An argument-cache bucket contains calls with the same last truthy class name.
 *
 *     [entryCount, restLength, ...rest, mergedClassName, entryId, ...]
 *
 * Real call sites reuse leading classes and vary the last class. First-argument keys required
 * buckets of 542 to 1,195 slots on measured pages. Last-argument keys kept every bucket within
 * its limit. Comparing the remaining classes from right to left also rejects shared prefixes
 * sooner.
 *
 * Flat entries avoid two arrays and one object allocation per insertion. This layout measured
 * twice as fast as object entries on JavaScriptCore.
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

  // Component renders repeat class-name calls in a stable order. Each hit records the next entry
  // ID, avoiding a map lookup when that order repeats. The lookup still compares every class name.
  // Trimming, rotation, and reused IDs therefore cause misses instead of incorrect results.
  const successorIds = new Int32Array(ARGUMENT_CACHE_PREDICTION_SLOTS).fill(-1);
  const predictedAnchors: string[] = createFilledArray(ARGUMENT_CACHE_PREDICTION_SLOTS, "");
  const predictedBuckets: ArgumentCacheBucket[] = createFilledArray(
    ARGUMENT_CACHE_PREDICTION_SLOTS,
    EMPTY_BUCKET,
  );
  const predictedPositions = new Int32Array(ARGUMENT_CACHE_PREDICTION_SLOTS);
  let lastHitId = 0;
  let nextEntryId = 0;

  const recordEntryHit = (
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

  const createEntryId = (
    anchorClassName: string,
    bucket: ArgumentCacheBucket,
    position: number,
  ): number => {
    const entryId = nextEntryId;
    nextEntryId = (entryId + 1) & ARGUMENT_CACHE_PREDICTION_ID_MASK;
    successorIds[entryId] = -1;
    recordEntryHit(anchorClassName, bucket, position, entryId);
    return entryId;
  };

  // Interpolated arbitrary values rarely repeat and reduced dynamic-grid throughput by 18% when
  // cached immediately. Class lists containing `[` enter the argument cache after a second use.
  let seenClassListsOnce = new Set<string>();
  let previousSeenClassListsOnce = new Set<string>();

  // Reuse one array for calls with four or more values. Merges are synchronous and read the array
  // before returning.
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

  // Promote previous-generation buckets by reference. An empty replacement would hide surviving
  // entries after the next insertion.
  const getArgumentCacheBucket = (anchorClassName: string): ArgumentCacheBucket | undefined => {
    const bucket = argumentCache.get(anchorClassName);
    if (bucket !== undefined) return bucket;
    const previous = previousArgumentCache.get(anchorClassName);
    if (previous !== undefined) argumentCache.set(anchorClassName, previous);
    return previous;
  };

  const recordCacheInsert = (slotCount: number): void => {
    argumentCacheSlotCount += slotCount;
    if (argumentCacheSlotCount > ARGUMENT_CACHE_ROTATION_SLOTS) {
      argumentCacheSlotCount = 0;
      previousArgumentCache = argumentCache;
      argumentCache = new Map();
    }
  };

  const getBucketForInsert = (
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

  // Mutable arrays and objects can resolve differently without changing identity. Bypass the
  // argument cache when a truthy value is not a string.
  const mergeResolvedList = (classValues: ClassValue[]): string => {
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
        const bucket = getArgumentCacheBucket(secondClassValue);
        if (bucket !== undefined) {
          for (let position = 1, slots = bucket.length; position < slots; ) {
            const restLength = bucket[position] as number;
            if (restLength === 1 && bucket[position + 1] === firstClassValue) {
              recordEntryHit(secondClassValue, bucket, position, bucket[position + 3] as number);
              return bucket[position + 2] as string;
            }
            position += restLength + 3;
          }
        }
        const classList = firstClassValue + SPACE_CHARACTER + secondClassValue;
        const mergedClassName = twMerge.mergeParts2(classList, firstClassValue, secondClassValue);
        if (shouldCacheArguments(classList)) {
          const cacheBucket = getBucketForInsert(secondClassValue, bucket);
          cacheBucket.push(
            1,
            firstClassValue,
            mergedClassName,
            createEntryId(secondClassValue, cacheBucket, cacheBucket.length),
          );
          cacheBucket[0] = (cacheBucket[0] as number) + 1;
          recordCacheInsert(3);
        }
        return mergedClassName;
      }
      if (!secondClassValue) return twMerge.mergeString(firstClassValue);
      return mergeResolvedList([firstClassValue, secondClassValue]);
    }
    if (!firstClassValue) {
      if (!secondClassValue) return "";
      if (typeof secondClassValue === "string") return twMerge.mergeString(secondClassValue);
      return mergeResolvedList([firstClassValue, secondClassValue]);
    }
    return mergeResolvedList([firstClassValue, secondClassValue]);
  };

  // Reduce falsy values to the two-value path so equivalent calls share cache entries.
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
          const bucket = getArgumentCacheBucket(thirdClassValue);
          if (bucket !== undefined) {
            for (let position = 1, slots = bucket.length; position < slots; ) {
              const restLength = bucket[position] as number;
              if (
                restLength === 2 &&
                bucket[position + 2] === secondClassValue &&
                bucket[position + 1] === firstClassValue
              ) {
                recordEntryHit(thirdClassValue, bucket, position, bucket[position + 4] as number);
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
            const cacheBucket = getBucketForInsert(thirdClassValue, bucket);
            cacheBucket.push(
              2,
              firstClassValue,
              secondClassValue,
              mergedClassName,
              createEntryId(thirdClassValue, cacheBucket, cacheBucket.length),
            );
            cacheBucket[0] = (cacheBucket[0] as number) + 1;
            recordCacheInsert(4);
          }
          return mergedClassName;
        }
        if (!thirdClassValue)
          return getMergedClassNameForTwoValues(firstClassValue, secondClassValue);
        return mergeResolvedList([firstClassValue, secondClassValue, thirdClassValue]);
      }
      if (!secondClassValue) {
        if (!thirdClassValue) return twMerge.mergeString(firstClassValue);
        if (typeof thirdClassValue === "string")
          return getMergedClassNameForTwoValues(firstClassValue, thirdClassValue);
        return mergeResolvedList([firstClassValue, secondClassValue, thirdClassValue]);
      }
      return mergeResolvedList([firstClassValue, secondClassValue, thirdClassValue]);
    }
    if (!firstClassValue) return getMergedClassNameForTwoValues(secondClassValue, thirdClassValue);
    return mergeResolvedList([firstClassValue, secondClassValue, thirdClassValue]);
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

      const bucket = getArgumentCacheBucket(anchorClassName);
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
              recordEntryHit(
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
        const cacheBucket = getBucketForInsert(anchorClassName, bucket);
        const entryPosition = cacheBucket.length;
        cacheBucket.push(restLengthWanted);
        for (let index = firstClassNameIndex; index < anchorClassNameIndex; index++) {
          const classValue = classValues[index];
          if (classValue) cacheBucket.push(classValue as string);
        }
        cacheBucket.push(
          mergedClassName,
          createEntryId(anchorClassName, cacheBucket, entryPosition),
        );
        cacheBucket[0] = (cacheBucket[0] as number) + 1;
        recordCacheInsert(restLengthWanted + 2);
      }

      return mergedClassName;
    }

    return mergeResolvedList(classValues);
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
