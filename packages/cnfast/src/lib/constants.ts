/**
 * Capacity constants for every bounded cache in the merge engine. All caches use two-generation
 * rotation: a full generation becomes the (still probed) previous generation instead of evicting
 * entries one by one, so the write path stays allocation-free. "Capacity" therefore means entries
 * per generation; the live working set is up to 2x that.
 */

/**
 * Whole-string result cache (`create-tailwind-merge.ts`). tailwind-merge defaults to 500, but
 * real pages measure 633 to 1134 unique class strings per render (calcom/documenso/dub captures),
 * so 500 thrashed exactly where the cache matters most. 2048 moves those pages from miss-regime
 * to hit-regime for a few hundred KB of retained strings.
 */
export const MERGE_CACHE_CAPACITY = 2048;

/**
 * Whole-string doorkeeper table (`create-tailwind-merge.ts`): byte-per-slot fingerprint set that
 * admits a computed miss into the cache only on its second sighting. 8 KB, wiped at half
 * occupancy so the false-positive rate stays bounded.
 */
export const DOORKEEPER_SLOTS = 8192;
export const DOORKEEPER_RESET_COUNT = DOORKEEPER_SLOTS / 2;

/**
 * Per-token descriptor cache (`config-utils.ts`). Larger than the whole-string cache because
 * individual tokens are more numerous but cheaper to store.
 */
export const DESCRIPTOR_CACHE_CAPACITY = 4096;

/**
 * Distinct interned conflict keys before the registry (and every cache holding its IDs) resets.
 * A conflict key's modifier can be an arbitrary variant such as `data-[id=123]:`, so an app
 * generating unbounded distinct variants would otherwise grow the registry forever. Sized well
 * above the distinct (modifier, group) pairs a real app produces: the reset never fires in
 * normal use.
 */
export const MAX_CONFLICT_KEYS = 16384;

/**
 * Token intern table (`config-utils.ts`): starts small and doubles until the max, so apps with a
 * modest class vocabulary never pay for more, while the largest real app corpora measured
 * (~12k unique tokens) fit without eviction churn. These are slot counts; the table grows (or at
 * max size rotates generations) when the entry count crosses half the slots, capping load factor
 * at 0.5 so linear probing always terminates.
 */
export const INTERN_TABLE_INITIAL_SLOTS = 2048;
export const INTERN_TABLE_MAX_SLOTS = 16384;

/**
 * Variadic arg cache (`index.ts`). Bucket slots hold flat interleaved entries
 * (`[restLen, ...rest, result]`), sized for a real component's full variant set under one shared
 * leading class (~64 two-arg entries). Rotation counts entry inserts, matching the other caches.
 */
export const ARG_CACHE_BUCKET_SLOTS = 256;
export const ARG_CACHE_ROTATION_INSERTS = 500;
