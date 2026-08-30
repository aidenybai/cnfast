import { createConfigUtils } from "./config-utils";
import { DOORKEEPER_RESET_COUNT, DOORKEEPER_SLOTS, MERGE_CACHE_CAPACITY } from "./constants";
import { ClassNameValue, twJoin } from "./tw-join";
import { AnyConfig } from "./types";

type ConfigUtils = ReturnType<typeof createConfigUtils>;

export interface TailwindMerge {
  (...classLists: ClassNameValue[]): string;
  /**
   * Merge an already-joined, space-separated class string, skipping the `twJoin` pass.
   * Used by `cn`, whose `clsx` step already produces a single string.
   */
  mergeString(classList: string): string;
}

export const createTailwindMerge = (createConfig: () => AnyConfig): TailwindMerge => {
  let configUtils: ConfigUtils;
  let mergeClassList: ConfigUtils["mergeClassList"];

  // Whole-string result cache, hit once per `cn` call. Inlined as a two-generation null-prototype
  // LRU directly in `tailwindMerge` (rather than behind a `get`/`set` abstraction) so the hottest
  // path has no per-call closure hop.
  let cache: Record<string, string> = Object.create(null);
  let previousCache: Record<string, string> = Object.create(null);
  let cacheSize = 0;
  const doorkeeper = new Uint8Array(DOORKEEPER_SLOTS);
  let doorkeeperCount = 0;

  // Lazy init that self-patches `merge.mergeString` to `tailwindMerge`, so every later call skips
  // both the init check and a wrapper-closure hop: hot callers (`cn`) reach the merge through a
  // monomorphic property load that V8 inline-caches.
  const initTailwindMerge = (classList: string) => {
    configUtils = createConfigUtils(createConfig());
    mergeClassList = configUtils.mergeClassList;
    merge.mergeString = tailwindMerge;

    return tailwindMerge(classList);
  };

  const tailwindMerge = (classList: string) => {
    let result = cache[classList];
    if (result !== undefined) {
      return result;
    }

    result = previousCache[classList];
    if (result === undefined) {
      result = mergeClassList(classList);

      // Doorkeeper (rationale on DOORKEEPER_SLOTS in constants.ts): skip the insert for a
      // first-sighted computed miss. The fingerprint is deliberately weak — length + three
      // sampled chars, no O(len) hash of the very string whose hashing the cache exists to
      // avoid; a collision only admits a string one sighting early. A `previousCache` hit above
      // bypasses this: proven repeat traffic must re-insert to survive rotation. The empty
      // string is admitted unconditionally (`charCodeAt` would yield a NaN slot).
      const length = classList.length;
      if (length > 0) {
        const slot =
          (length * 61 +
            classList.charCodeAt(0) * 131 +
            classList.charCodeAt(length - 1) * 31 +
            classList.charCodeAt(length >> 1) * 7) &
          (DOORKEEPER_SLOTS - 1);
        if (doorkeeper[slot] === 0) {
          doorkeeper[slot] = 1;
          if (++doorkeeperCount >= DOORKEEPER_RESET_COUNT) {
            doorkeeperCount = 0;
            doorkeeper.fill(0);
          }
          return result;
        }
      }
    }

    cache[classList] = result;
    if (++cacheSize > MERGE_CACHE_CAPACITY) {
      cacheSize = 0;
      previousCache = cache;
      cache = Object.create(null);
    }

    return result;
  };

  const merge: TailwindMerge = (...args: ClassNameValue[]) => merge.mergeString(twJoin(...args));
  merge.mergeString = initTailwindMerge;
  return merge;
};
