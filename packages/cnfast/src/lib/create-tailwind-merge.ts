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
 * Whole-string result cache capacity (per generation; live working set is up to 2x this).
 * tailwind-merge defaults to 500, but real pages measure 633-1134 unique class strings per render
 * (calcom/documenso/dub captures), so 500 is pure thrash exactly where the cache matters most —
 * 2048 moves those pages from miss-regime to hit-regime for ~a few hundred KB of retained strings.
 * cnfast ships a single, non-configurable config so the size is baked in rather than exposed.
 */
const MERGE_CACHE_SIZE = 2048;

// TinyLFU-style doorkeeper: a computed miss is only inserted into the cache on its SECOND
// sighting. In miss-dominated workloads (real-app corpora, live arbitrary values) nearly every
// inserted entry is evicted before it is ever hit, so the insert — dictionary store + its share
// of generation rotation, ~40% of the measured miss path — is pure waste; skipping first-timers
// also keeps genuinely-repeating entries from being evicted by one-hit wonders. The fingerprint
// is deliberately weak (length + three sampled char codes — O(1), no O(len) hash of the very
// string whose hashing cost the cache exists to avoid): a collision merely admits a string one
// sighting early, i.e. today's behavior, and never affects output. Byte-per-slot (8 KB) beats a
// packed bitset here: no shift/mask on the hot miss path.
const DOORKEEPER_SLOTS = 8192;
// Marks recorded before the doorkeeper wipes itself. Without the reset a long miss streak would
// saturate the table and admit everything (silently degrading to today's insert-always); wiping
// at half occupancy keeps the false-positive rate bounded, and an 8 KB fill amortizes to noise
// across the >=4096 misses between wipes.
const DOORKEEPER_RESET = DOORKEEPER_SLOTS / 2;

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
  const doorkeeper = new Uint8Array(DOORKEEPER_SLOTS);
  let doorkeeperCount = 0;

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

      // Doorkeeper (see DOORKEEPER_SLOTS): skip the insert for a first-sighted computed miss.
      // A `previousCache` hit above bypasses this — it is proven repeat traffic and re-inserting
      // it is exactly what keeps the two-generation scheme's hot set alive across rotations. The
      // empty string (all-falsy variadic joins) is admitted unconditionally: `charCodeAt` would
      // yield a NaN slot, and caching it is always worth one slot.
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
          if (++doorkeeperCount >= DOORKEEPER_RESET) {
            doorkeeperCount = 0;
            doorkeeper.fill(0);
          }
          return result;
        }
      }
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
