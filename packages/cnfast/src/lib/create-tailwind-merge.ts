import {
  DOORKEEPER_SLOTS,
  FINGERPRINT_FIRST_CHARACTER_FACTOR,
  FINGERPRINT_LAST_CHARACTER_FACTOR,
  FINGERPRINT_LENGTH_FACTOR,
  FINGERPRINT_MIDDLE_CHARACTER_FACTOR,
  MERGE_CACHE_CAPACITY,
  MERGE_CACHE_CAPACITY_MAX,
} from "./constants.js";
import { createMergeClassList, type MergeClassListEngine } from "./merge-class-list.js";
import { twJoin, type ClassNameValue } from "./tw-join.js";
import type { AnyConfig } from "./types.js";

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
  let mergeClassList: MergeClassListEngine["mergeClassList"] = (classList) => {
    initConfig();
    return mergeClassList(classList);
  };
  let mergePreparedParts: MergeClassListEngine["mergePreparedParts"] = (
    classListParts,
    partCount,
    classList,
  ) => {
    initConfig();
    return mergePreparedParts(classListParts, partCount, classList);
  };

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

  const initConfig = (): void => {
    const engine = createMergeClassList(createConfig());
    mergeClassList = engine.mergeClassList;
    mergePreparedParts = engine.mergePreparedParts;
  };

  const admitComputedResult = (classList: string, mergedClassName: string): string => {
    const classListLength = classList.length;
    if (classListLength > 0) {
      const doorkeeperSlot =
        (classListLength * FINGERPRINT_LENGTH_FACTOR +
          classList.charCodeAt(0) * FINGERPRINT_FIRST_CHARACTER_FACTOR +
          classList.charCodeAt(classListLength - 1) * FINGERPRINT_LAST_CHARACTER_FACTOR +
          classList.charCodeAt(classListLength >> 1) * FINGERPRINT_MIDDLE_CHARACTER_FACTOR) &
        doorkeeperSlotMask;
      if (
        doorkeeperFingerprints[doorkeeperSlot] === 0 &&
        previousDoorkeeperFingerprints[doorkeeperSlot] === 0
      ) {
        doorkeeperFingerprints[doorkeeperSlot] = 1;
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

  const mergeMissingString = (classList: string): string => {
    const mergedClassName = previousMergeCache[classList];
    if (mergedClassName !== undefined) return promoteHit(classList, mergedClassName);
    return admitComputedResult(classList, mergeClassList(classList));
  };

  const tailwindMerge = (classList: string): string => {
    const mergedClassName = mergeCache[classList];
    if (mergedClassName !== undefined) return mergedClassName;
    return mergeMissingString(classList);
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

  const mergeClassNames: TailwindMerge = (...classValues: ClassNameValue[]) =>
    tailwindMerge(twJoin(...classValues));
  mergeClassNames.mergeString = tailwindMerge;
  mergeClassNames.peekString = peekString;
  mergeClassNames.mergeParts2 = tailwindMergeParts2;
  mergeClassNames.mergeParts3 = tailwindMergeParts3;
  mergeClassNames.mergeParts = tailwindMergeParts;
  return mergeClassNames;
};
