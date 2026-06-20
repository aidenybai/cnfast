import { createConfigUtils } from "./config-utils";
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

/**
 * Whole-string result cache capacity. Matches tailwind-merge's default; fastcn ships a single,
 * non-configurable config so it is baked in rather than exposed as an option.
 */
const MERGE_CACHE_SIZE = 500;

export const createTailwindMerge = (createConfig: () => AnyConfig): TailwindMerge => {
  let configUtils: ConfigUtils;
  let mergeClassList: ConfigUtils["mergeClassList"];

  // Whole-string result cache, hit once per `cn` call. Inlined as a two-generation null-prototype
  // LRU directly in `tailwindMerge` (rather than behind a `get`/`set` abstraction) so the hottest
  // path has no per-call closure hop. A full generation rotates into `previousCache` instead of
  // evicting entries individually, keeping the write path allocation-free in the common case.
  let cache: Record<string, string> = Object.create(null);
  let previousCache: Record<string, string> = Object.create(null);
  let cacheSize = 0;

  // Lazy init that self-patches `merge.mergeString` to `tailwindMerge` so every call after the
  // first skips both the init check and a wrapper-closure hop. Hot callers (`cn`) reach the
  // merge through `twMerge.mergeString(...)`, a monomorphic property load that V8 inline-caches.
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
    }

    cache[classList] = result;
    if (++cacheSize > MERGE_CACHE_SIZE) {
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
