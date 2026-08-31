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
    return getMergedClassNameForManyValues(classValues, true);
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
    // A falsy anchor can never match predictedAnchors (truthy strings only),
    // so falsy-tail rows skip the probe's loads instead of paying them every
    // call for nothing (toggle-heavy callers hit this constantly).
    if (secondClassValue) {
      // predictedAnchors only holds truthy strings, so the anchor compare is a
      // sound guard for secondClassValue — but predictedPosition can be stale
      // after trimBucket, letting the slot compares land on numeric bookkeeping
      // slots (restLength/entryId) that a truthy NUMBER argument can strict-
      // equal. A matched slot therefore only proves a hit once the argument is
      // verified to be a truthy string: then either the window is a genuine
      // same-restLength entry of this anchor (byte-identical result) or a
      // string-vs-number compare has already failed. The typeof checks sit
      // after the identity compares so probe misses pay nothing.
      const predictedId = successorIds[lastHitId]!;
      if (predictedId !== -1 && predictedAnchors[predictedId] === secondClassValue) {
        const predictedBucket = predictedBuckets[predictedId]!;
        const predictedPosition = predictedPositions[predictedId]!;
        if (
          predictedBucket[predictedPosition] === 1 &&
          predictedBucket[predictedPosition + 1] === firstClassValue &&
          typeof firstClassValue === "string" &&
          firstClassValue !== ""
        ) {
          lastHitId = predictedId;
          return predictedBucket[predictedPosition + 2] as string;
        }
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
    // Falsy anchors skip the probe's loads — same reasoning as the two-value
    // path, and falsy tails are the majority of real arity-3 traffic.
    if (thirdClassValue) {
      const predictedId = successorIds[lastHitId]!;
      if (predictedId !== -1 && predictedAnchors[predictedId] === thirdClassValue) {
        const predictedBucket = predictedBuckets[predictedId]!;
        const predictedPosition = predictedPositions[predictedId]!;
        if (
          predictedBucket[predictedPosition] === 2 &&
          predictedBucket[predictedPosition + 2] === secondClassValue &&
          predictedBucket[predictedPosition + 1] === firstClassValue &&
          typeof firstClassValue === "string" &&
          firstClassValue !== "" &&
          typeof secondClassValue === "string" &&
          secondClassValue !== ""
        ) {
          lastHitId = predictedId;
          return predictedBucket[predictedPosition + 3] as string;
        }
      }
    } else if (
      !secondClassValue &&
      typeof firstClassValue === "string" &&
      firstClassValue !== ""
    ) {
      return mergeString(firstClassValue);
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

  const getMergedClassNameForManyValues = (
    classValues: ClassValue[],
    probeWanted: boolean,
  ): string => {
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

      // The entry-level probe already tried this exact anchor for raw-string
      // rows, so re-probing is wanted only after resolveClassValue rewrote
      // values (the probe can then match strings the raw row could not). No
      // stale-position guards are needed: every compared value is a verified
      // truthy string and restLengthWanted >= 1, so a stale window either
      // fails on a numeric slot or is a genuine same-anchor entry with a
      // byte-identical result.
      if (probeWanted) {
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

    // The anchor is the LAST truthy argument, so a short backward walk over
    // the falsy tail finds it without the new Array copy or the forward
    // anchor-selection scan — falsy-tail high-arity rows otherwise pay both
    // just to reach the identical interior re-probe. predictedAnchors only
    // holds truthy strings, so the anchor compare guards the anchor operand
    // (a truthy non-string last value can never match). predictedPosition
    // can be stale after trimBucket, so the header read must be verified as a
    // real restLength (a stale slot can hold a string or an entryId — id 0
    // would let an all-falsy prefix "consume" zero rest slots and return a
    // number), and each raw argument that matches a rest slot must be a
    // truthy string: a stale window that still matches string-for-string is
    // a genuine same-anchor entry, while only a NUMBER argument can equal
    // the numeric slot a misaligned window puts in its path.
    // anchorIndex > 0 (not !== 0) also terminates the zero-argument call,
    // which lands here with anchorIndex already -1.
    let anchorIndex = classValueCount - 1;
    let anchorClassValue = arguments[anchorIndex];
    while (!anchorClassValue && anchorIndex > 0) anchorClassValue = arguments[--anchorIndex];
    const predictedId = successorIds[lastHitId]!;
    if (predictedId !== -1 && predictedAnchors[predictedId] === anchorClassValue) {
      const predictedBucket = predictedBuckets[predictedId]!;
      const predictedPosition = predictedPositions[predictedId]!;
      const predictedRestLength = predictedBucket[predictedPosition];
      if (
        typeof predictedRestLength === "number" &&
        predictedRestLength !== 0 &&
        predictedRestLength < classValueCount
      ) {
        let restIndex = predictedPosition + predictedRestLength;
        let isMatch = true;
        for (let index = anchorIndex - 1; index >= 0; index--) {
          const classValue = arguments[index];
          if (!classValue) continue;
          if (
            restIndex === predictedPosition ||
            classValue !== predictedBucket[restIndex] ||
            typeof classValue !== "string"
          ) {
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
    return getMergedClassNameForManyValues(classValues, false);
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
