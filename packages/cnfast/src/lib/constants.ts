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
 * to hit-regime for a few hundred KB of retained strings. Per-generation capacity doubles up to
 * the max when doorkeeper-passed admissions overflow a generation — direct evidence the
 * repeating working set exceeds it (real apps measured up to ~12k unique joined strings); apps
 * that fit the initial capacity never grow.
 */
export const MERGE_CACHE_CAPACITY = 2048;
export const MERGE_CACHE_CAPACITY_MAX = 8192;

/**
 * Whole-string doorkeeper table (`create-tailwind-merge.ts`): byte-per-slot fingerprint set that
 * admits a computed miss into the cache only on its second sighting. Two generations aged at
 * half occupancy of the current one (a wholesale wipe destroyed second-sighting evidence faster
 * than large apps could repeat a string, silently blocking all admission). Slot count doubles
 * with the cache capacity so the evidence window keeps covering the working set it gates.
 */
export const DOORKEEPER_SLOTS = 8192;

/**
 * Distinct interned conflict keys before the registry (and every cache holding its IDs) resets.
 * A conflict key's modifier can be an arbitrary variant such as `data-[id=123]:`, so an app
 * generating unbounded distinct variants would otherwise grow the registry forever. Sized well
 * above the distinct (modifier, group) pairs a real app produces: the reset never fires in
 * normal use.
 */
export const MAX_CONFLICT_KEYS = 16384;

/**
 * Per-argument prepared-handle memo (`merge-class-list.ts`): inserts per generation, two
 * generations live. Real components repeat the same handful of arg strings across thousands of
 * novel combinations, so the arg vocabulary is far smaller than the joined-string vocabulary —
 * 2048 matches the whole-string cache's per-generation budget while covering the arg sets of the
 * largest measured corpora.
 */
export const PREPARED_ARG_CACHE_SIZE = 2048;

/**
 * Token intern table (`merge-class-list.ts`): starts small and doubles until the max, so apps
 * with a modest class vocabulary never pay for more. These are slot counts; the table grows (or
 * at max size rotates generations) when the entry count crosses half the slots, capping load
 * factor at 0.5 so linear probing always terminates.
 *
 * The hard max is demand-gated: past INTERN_TABLE_MAX_SLOTS the table only doubles further when
 * re-promotions since the last grow/rotate exceed a quarter of the slots — proof that live
 * repeating tokens (the largest real corpora measured hold ~12k) forced the rotation, not
 * one-off churn. Apps under ~8k unique tokens never rotate, so the counter never increments and
 * behavior is byte-for-byte unchanged. Worst case at the hard max is two generations of 32768
 * slots (~1.5MB of lanes plus the token strings), reclaimed by the conflict-registry reset.
 */
export const INTERN_TABLE_INITIAL_SLOTS = 2048;
export const INTERN_TABLE_MAX_SLOTS = 16384;
export const INTERN_TABLE_HARD_MAX_SLOTS = 32768;

/**
 * Intern-probe verification (`merge-class-list.ts`): on JSC the `startsWith` builtin beats the
 * per-char verify loop from roughly this token length (measured 2.6-5.1x at realistic lengths on
 * Bun); on V8 it measures ~1.0x, so the char loop stays the universal path there.
 */
export const JSC_STARTSWITH_VERIFY_MIN_LENGTH = 12;

/**
 * Result-intern table (`merge-class-list.ts`): direct-mapped slots canonicalizing rebuild
 * outputs. Repeated drop-merges re-produce byte-equal result strings as fresh slices/concats, and
 * every downstream consumer that hashes the result (the whole-string cache when a result is fed
 * back through a nested cn call, arg-cache Map probes, React-memo / dedup-by-className maps in
 * user code) must then re-flatten and re-hash each fresh copy. Interning makes repeated merges
 * return the SAME string object, so those probes become identity/cached-hash hits. Direct-mapped
 * on purpose (one load + int compare on the common miss, overwrite on collision): the table is a
 * best-effort canonicalizer, not a correctness cache — losing an entry merely reverts to the
 * fresh-string behavior.
 */
export const RESULT_INTERN_SLOTS = 1024;

/**
 * Variadic arg cache (`core.ts`). Buckets hold flat interleaved entries
 * (`[restLen, ...rest, result]`) behind an entry-count header slot; the budget counts ENTRIES
 * (not slots) so high-arity entries do not shrink a bucket's effective capacity, sized for a real
 * component's full variant set under one shared anchor class. Rotation is slot-weighted (an
 * arity-N insert charges N+1 slots) so cadence tracks retained memory, not call count;
 * 2048 slots ≈ the old 500-entry budget at the measured page arity mix. The once-seen set for
 * '['-containing joins keeps its own entry-counted bound.
 */
export const ARG_CACHE_BUCKET_ENTRIES = 96;
export const ARG_CACHE_ROTATION_SLOTS = 2048;
export const ARG_CACHE_SEEN_ONCE_CAPACITY = 500;

/**
 * Successor-prediction side arrays (`core.ts`): every arg-cache entry gets a wrapping integer id,
 * and `successorIds[lastHitId]` predicts the next call's entry straight from render order,
 * skipping the Map probe and bucket scan when the prediction verifies. Sized to cover the live
 * entry population of both arg-cache generations so ids rarely wrap while their entries are still
 * hot; a wrapped (stolen) id just fails verification and falls back to the normal probe. The
 * per-entry id slot is excluded from the rotation-slot charge so retention cadence tracks the
 * cached payload, not prediction metadata.
 */
export const ARG_CACHE_PREDICTION_SLOTS = 2048;
