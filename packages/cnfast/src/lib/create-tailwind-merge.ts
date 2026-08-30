import { DOORKEEPER_RESET_COUNT, DOORKEEPER_SLOTS, MERGE_CACHE_CAPACITY } from "./constants";
import { createMergeClassList, MergeClassListEngine } from "./merge-class-list";
import { ClassNameValue, twJoin } from "./tw-join";
import { AnyConfig } from "./types";

export interface TailwindMerge {
  (...classLists: ClassNameValue[]): string;
  /**
   * Merge an already-joined, space-separated class string, skipping the `twJoin` pass.
   * Used by `cn`, whose `clsx` step already produces a single string.
   */
  mergeString(classList: string): string;
  /**
   * Arity-2 variadic merge: `joined` MUST be `a + " " + b`; byte-identical to
   * `mergeString(joined)`. On a whole-string-cache miss this replays memoized per-argument
   * parses (see `mergePreparedParts`) instead of re-splitting and re-hashing the joined string —
   * the dominant miss cost when the args are familiar but their combination is novel. The args
   * ride as plain parameters (not an array) so the far-more-common cache-hit path pays no
   * per-call stores; they are only touched on a computed miss.
   */
  mergeParts2(joined: string, a: string, b: string): string;
  /** Arity-3 twin of `mergeParts2`; `joined` MUST be `a + " " + b + " " + c`. */
  mergeParts3(joined: string, a: string, b: string, c: string): string;
  /**
   * Probe-only read of the whole-string cache (promoting a previous-generation hit), `undefined`
   * on a miss. Lets the variadic caller keep its cache-hit call byte-identical in shape to a
   * `mergeString` probe and pay for parts collection only when `mergeParts` will actually run.
   */
  peekString(classList: string): string | undefined;
  /**
   * Variadic twin of `mergeParts2` for arity >= 4, called only after a failed `peekString`:
   * `joined` MUST be `parts.join(" ")` over the first `partCount` entries. `parts` may be a
   * reused scratch array; it is only read synchronously.
   */
  mergeParts(joined: string, parts: readonly string[], partCount: number): string;
}

export const createTailwindMerge = (createConfig: () => AnyConfig): TailwindMerge => {
  let mergeClassList: MergeClassListEngine["mergeClassList"];
  let mergePreparedParts: MergeClassListEngine["mergePreparedParts"];

  // Whole-string result cache, hit once per `cn` call. Inlined as a two-generation null-prototype
  // LRU directly in `tailwindMerge` (rather than behind a `get`/`set` abstraction) so the hottest
  // path has no per-call closure hop.
  let cache: Record<string, string> = Object.create(null);
  let previousCache: Record<string, string> = Object.create(null);
  let cacheSize = 0;
  const doorkeeper = new Uint8Array(DOORKEEPER_SLOTS);
  let doorkeeperCount = 0;

  // Carrier handing the truthy string args of the arity-2/3 entry points to
  // `mergePreparedParts`, filled only on a computed miss (merges are synchronous and
  // non-reentrant, so one reused array serves both without allocating).
  const partsScratch: string[] = [];

  // Lazy init that self-patches the `merge.*` entry points to the direct merges, so every later
  // call skips both the init check and a wrapper-closure hop: hot callers (`cn`) reach the merge
  // through monomorphic property loads that V8 inline-caches.
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

  const initTailwindMergeParts2 = (joined: string, a: string, b: string) => {
    initConfig();
    return tailwindMergeParts2(joined, a, b);
  };

  const initTailwindMergeParts3 = (joined: string, a: string, b: string, c: string) => {
    initConfig();
    return tailwindMergeParts3(joined, a, b, c);
  };

  const initTailwindMergeParts = (joined: string, parts: readonly string[], partCount: number) => {
    initConfig();
    return tailwindMergeParts(joined, parts, partCount);
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

  // Shared computed-miss tail for the parts-aware entry points below: prepared merge over
  // `parts[0..partCount)`, then the same doorkeeper-gated insert as `tailwindMerge` (which keeps
  // its own inline copy — its measured miss path was left untouched). Runs only on a true
  // computed miss, so the extra closure hop is amortized against a full merge.
  const finishPartsMiss = (joined: string, parts: readonly string[], partCount: number): string => {
    const result = mergePreparedParts(parts, partCount, joined);

    // `joined` is never empty here: parts-aware callers always have >= 2 non-empty args.
    const length = joined.length;
    const slot =
      (length * 61 +
        joined.charCodeAt(0) * 131 +
        joined.charCodeAt(length - 1) * 31 +
        joined.charCodeAt(length >> 1) * 7) &
      (DOORKEEPER_SLOTS - 1);
    if (doorkeeper[slot] === 0) {
      doorkeeper[slot] = 1;
      if (++doorkeeperCount >= DOORKEEPER_RESET_COUNT) {
        doorkeeperCount = 0;
        doorkeeper.fill(0);
      }
      return result;
    }

    cache[joined] = result;
    if (++cacheSize > MERGE_CACHE_CAPACITY) {
      cacheSize = 0;
      previousCache = cache;
      cache = Object.create(null);
    }

    return result;
  };

  // Promotes a previous-generation hit into the current cache, exactly as `tailwindMerge` does
  // (no doorkeeper: it is proven repeat traffic).
  const promoteHit = (joined: string, result: string): string => {
    cache[joined] = result;
    if (++cacheSize > MERGE_CACHE_CAPACITY) {
      cacheSize = 0;
      previousCache = cache;
      cache = Object.create(null);
    }
    return result;
  };

  // Parts-aware twins of `tailwindMerge`, sharing the same whole-string cache and doorkeeper: the
  // cache stays keyed on the joined string (so every entry point hits the others' results), only
  // the compute on a true miss differs. The hit paths touch nothing but the probe itself — args
  // land in `partsScratch` strictly on the computed-miss branch.
  const tailwindMergeParts2 = (joined: string, a: string, b: string) => {
    let result = cache[joined];
    if (result !== undefined) return result;
    result = previousCache[joined];
    if (result !== undefined) return promoteHit(joined, result);
    partsScratch[0] = a;
    partsScratch[1] = b;
    return finishPartsMiss(joined, partsScratch, 2);
  };

  const tailwindMergeParts3 = (joined: string, a: string, b: string, c: string) => {
    let result = cache[joined];
    if (result !== undefined) return result;
    result = previousCache[joined];
    if (result !== undefined) return promoteHit(joined, result);
    partsScratch[0] = a;
    partsScratch[1] = b;
    partsScratch[2] = c;
    return finishPartsMiss(joined, partsScratch, 3);
  };

  // Probe-only cache read for the variadic caller (see `peekString` in the interface). Needs no
  // lazy-init wrapper: the caches exist before the config does, and a peek never computes.
  const peekString = (classList: string): string | undefined => {
    const result = cache[classList];
    if (result !== undefined) return result;
    const previous = previousCache[classList];
    if (previous !== undefined) return promoteHit(classList, previous);
    return undefined;
  };

  // Variadic (arity >= 4) twin, reached only after a failed `peekString`: the caller has already
  // collected its truthy args, so this goes straight to the computed-miss tail (a cache re-probe
  // would be pure overhead on a path that is by construction a miss).
  const tailwindMergeParts = (joined: string, parts: readonly string[], partCount: number) =>
    finishPartsMiss(joined, parts, partCount);

  const merge: TailwindMerge = (...args: ClassNameValue[]) => merge.mergeString(twJoin(...args));
  merge.mergeString = initTailwindMerge;
  merge.peekString = peekString;
  merge.mergeParts2 = initTailwindMergeParts2;
  merge.mergeParts3 = initTailwindMergeParts3;
  merge.mergeParts = initTailwindMergeParts;
  return merge;
};
