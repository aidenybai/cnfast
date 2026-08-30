import {
  DOORKEEPER_SLOTS,
  FINGERPRINT_FIRST_CHARACTER_FACTOR,
  FINGERPRINT_LAST_CHARACTER_FACTOR,
  FINGERPRINT_LENGTH_FACTOR,
  FINGERPRINT_MIDDLE_CHARACTER_FACTOR,
  MERGE_CACHE_CAPACITY,
  MERGE_CACHE_CAPACITY_MAX,
} from "./constants";
import { createMergeClassList, MergeClassListEngine } from "./merge-class-list";
import { ClassNameValue, twJoin } from "./tw-join";
import { AnyConfig } from "./types";

export interface TailwindMerge {
  (...classLists: ClassNameValue[]): string;
  mergeString(classList: string): string;
  mergeParts2(classList: string, firstClassName: string, secondClassName: string): string;
  mergeParts3(
    classList: string,
    firstClassName: string,
    secondClassName: string,
    thirdClassName: string,
  ): string;
  peekString(classList: string): string | undefined;
  mergeParts(classList: string, parts: readonly string[], partCount: number): string;
}

export const createTailwindMerge = (createConfig: () => AnyConfig): TailwindMerge => {
  let mergeClassList: MergeClassListEngine["mergeClassList"];
  let mergePreparedParts: MergeClassListEngine["mergePreparedParts"];

  // Count new entries separately from promotions. Otherwise, a cyclic working set between one and
  // two generations rotates continuously instead of reaching full residency.
  let mergeCache: Record<string, string> = Object.create(null);
  let previousMergeCache: Record<string, string> = Object.create(null);
  let admissionCount = 0;
  let promotionCount = 0;
  let cacheCapacity = MERGE_CACHE_CAPACITY;
  let cacheHardBound = MERGE_CACHE_CAPACITY * 2;
  let doorkeeperSlotMask = DOORKEEPER_SLOTS - 1;
  let doorkeeperSwapCount = DOORKEEPER_SLOTS >> 1;
  let doorkeeperFingerprints = new Uint8Array(DOORKEEPER_SLOTS);
  let previousDoorkeeperFingerprints = new Uint8Array(DOORKEEPER_SLOTS);
  let doorkeeperCount = 0;

  const rotateCache = (): void => {
    admissionCount = 0;
    promotionCount = 0;
    previousMergeCache = mergeCache;
    mergeCache = Object.create(null);
  };

  // Repeated admissions beyond capacity show that the active set is larger. Grow both structures
  // together so the doorkeeper continues to cover the cache.
  const growCacheCapacity = (): void => {
    cacheCapacity *= 2;
    cacheHardBound = cacheCapacity * 2;
    const doorkeeperSlots = (doorkeeperSlotMask + 1) * 2;
    doorkeeperSlotMask = doorkeeperSlots - 1;
    doorkeeperSwapCount = doorkeeperSlots >> 1;
    doorkeeperFingerprints = new Uint8Array(doorkeeperSlots);
    previousDoorkeeperFingerprints = new Uint8Array(doorkeeperSlots);
    doorkeeperCount = 0;
  };

  const classListPartsScratch: string[] = [];

  // Self-patching keeps initialization lazy without charging later calls for an extra branch.
  const initConfig = (): void => {
    const engine = createMergeClassList(createConfig());
    mergeClassList = engine.mergeClassList;
    mergePreparedParts = engine.mergePreparedParts;
    merge.mergeString = tailwindMerge;
    merge.mergeParts2 = tailwindMergeParts2;
    merge.mergeParts3 = tailwindMergeParts3;
    merge.mergeParts = tailwindMergeParts;
  };

  const initTailwindMerge = (classList: string) => {
    initConfig();
    return tailwindMerge(classList);
  };

  const initTailwindMergeParts2 = (
    classList: string,
    firstClassName: string,
    secondClassName: string,
  ) => {
    initConfig();
    return tailwindMergeParts2(classList, firstClassName, secondClassName);
  };

  const initTailwindMergeParts3 = (
    classList: string,
    firstClassName: string,
    secondClassName: string,
    thirdClassName: string,
  ) => {
    initConfig();
    return tailwindMergeParts3(classList, firstClassName, secondClassName, thirdClassName);
  };

  const initTailwindMergeParts = (
    classList: string,
    parts: readonly string[],
    partCount: number,
  ) => {
    initConfig();
    return tailwindMergeParts(classList, parts, partCount);
  };

  // Hashing the full class list would erase the cache's benefit. This fingerprint samples three
  // characters instead. A collision only admits a class list one use early.
  const admitComputedResult = (classList: string, mergedClassName: string): string => {
    const length = classList.length;
    if (length > 0) {
      const slot =
        (length * FINGERPRINT_LENGTH_FACTOR +
          classList.charCodeAt(0) * FINGERPRINT_FIRST_CHARACTER_FACTOR +
          classList.charCodeAt(length - 1) * FINGERPRINT_LAST_CHARACTER_FACTOR +
          classList.charCodeAt(length >> 1) * FINGERPRINT_MIDDLE_CHARACTER_FACTOR) &
        doorkeeperSlotMask;
      if (doorkeeperFingerprints[slot] === 0 && previousDoorkeeperFingerprints[slot] === 0) {
        doorkeeperFingerprints[slot] = 1;
        if (++doorkeeperCount >= doorkeeperSwapCount) {
          doorkeeperCount = 0;
          const retiredDoorkeeper = previousDoorkeeperFingerprints;
          previousDoorkeeperFingerprints = doorkeeperFingerprints;
          retiredDoorkeeper.fill(0);
          doorkeeperFingerprints = retiredDoorkeeper;
        }
        return mergedClassName;
      }
    }

    mergeCache[classList] = mergedClassName;
    if (++admissionCount > cacheCapacity) {
      if (cacheCapacity < MERGE_CACHE_CAPACITY_MAX) {
        growCacheCapacity();
      } else {
        rotateCache();
      }
    } else if (admissionCount + promotionCount > cacheHardBound) {
      rotateCache();
    }

    return mergedClassName;
  };

  const promoteHit = (classList: string, mergedClassName: string): string => {
    mergeCache[classList] = mergedClassName;
    if (++promotionCount + admissionCount > cacheHardBound) rotateCache();
    return mergedClassName;
  };

  const tailwindMerge = (classList: string) => {
    let mergedClassName = mergeCache[classList];
    if (mergedClassName !== undefined) {
      return mergedClassName;
    }

    mergedClassName = previousMergeCache[classList];
    if (mergedClassName !== undefined) return promoteHit(classList, mergedClassName);

    return admitComputedResult(classList, mergeClassList(classList));
  };

  const tailwindMergeParts2 = (
    classList: string,
    firstClassName: string,
    secondClassName: string,
  ) => {
    let mergedClassName = mergeCache[classList];
    if (mergedClassName !== undefined) return mergedClassName;
    mergedClassName = previousMergeCache[classList];
    if (mergedClassName !== undefined) return promoteHit(classList, mergedClassName);
    classListPartsScratch[0] = firstClassName;
    classListPartsScratch[1] = secondClassName;
    return admitComputedResult(classList, mergePreparedParts(classListPartsScratch, 2, classList));
  };

  const tailwindMergeParts3 = (
    classList: string,
    firstClassName: string,
    secondClassName: string,
    thirdClassName: string,
  ) => {
    let mergedClassName = mergeCache[classList];
    if (mergedClassName !== undefined) return mergedClassName;
    mergedClassName = previousMergeCache[classList];
    if (mergedClassName !== undefined) return promoteHit(classList, mergedClassName);
    classListPartsScratch[0] = firstClassName;
    classListPartsScratch[1] = secondClassName;
    classListPartsScratch[2] = thirdClassName;
    return admitComputedResult(classList, mergePreparedParts(classListPartsScratch, 3, classList));
  };

  const peekString = (classList: string): string | undefined => {
    const mergedClassName = mergeCache[classList];
    if (mergedClassName !== undefined) return mergedClassName;
    const previousMergedClassName = previousMergeCache[classList];
    if (previousMergedClassName !== undefined)
      return promoteHit(classList, previousMergedClassName);
    return undefined;
  };

  const tailwindMergeParts = (classList: string, parts: readonly string[], partCount: number) =>
    admitComputedResult(classList, mergePreparedParts(parts, partCount, classList));

  const merge: TailwindMerge = (...classValues: ClassNameValue[]) =>
    merge.mergeString(twJoin(...classValues));
  merge.mergeString = initTailwindMerge;
  merge.peekString = peekString;
  merge.mergeParts2 = initTailwindMergeParts2;
  merge.mergeParts3 = initTailwindMergeParts3;
  merge.mergeParts = initTailwindMergeParts;
  return merge;
};
