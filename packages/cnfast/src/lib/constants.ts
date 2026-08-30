/**
 * Measured pages use 633 to 1,134 unique class lists per render. A capacity of 2,048 prevents
 * churn on those pages. Repeated overflow grows the cache for larger active sets.
 */
export const MERGE_CACHE_CAPACITY = 2048;
export const MERGE_CACHE_CAPACITY_MAX = 8192;

/**
 * The doorkeeper admits class lists after their second use. Rotating at half occupancy preserves
 * enough evidence for large pages to repeat a list before its fingerprint expires.
 */
export const DOORKEEPER_SLOTS = 8192;

/**
 * Arbitrary variants can create unlimited conflict keys. This bound resets their registry before
 * it can grow without limit, while remaining above measured application vocabularies.
 */
export const MAX_CONFLICT_KEYS = 16384;

/**
 * Components reuse individual arguments across many combinations. Two generations of 2,048
 * entries cover the largest measured argument vocabularies.
 */
export const PREPARED_PART_CACHE_SIZE = 2048;

/**
 * The token table grows or rotates at 50% occupancy so linear probing always terminates. Frequent
 * promotions allow growth beyond the soft limit because they prove that live tokens caused the
 * pressure. The hard limit bounds retained memory.
 */
export const INTERN_TABLE_INITIAL_SLOTS = 2048;
export const INTERN_TABLE_MAX_SLOTS = 16384;
export const INTERN_TABLE_HARD_MAX_SLOTS = 32768;

/**
 * JavaScriptCore verifies longer interned tokens 2.6 to 5.1 times faster with `startsWith`.
 * V8 receives no measured benefit, so it retains the character loop.
 */
export const JSC_STARTSWITH_VERIFY_MIN_LENGTH = 12;

/**
 * Interning repeated outputs preserves their cached string hashes. Direct mapping keeps misses
 * cheap, and collisions remain safe because this table only canonicalizes results.
 */
export const RESULT_INTERN_SLOTS = 1024;

/**
 * Argument-cache buckets store `[entryCount, restLength, ...rest, result, entryId, ...]`. Bucket
 * limits count entries so call arity does not reduce variant capacity. Rotation counts slots to
 * track retained memory.
 */
export const ARGUMENT_CACHE_BUCKET_ENTRIES = 96;
export const ARGUMENT_CACHE_ROTATION_SLOTS = 2048;
export const ARGUMENT_CACHE_SEEN_ONCE_CAPACITY = 500;

/**
 * Prediction IDs cover both live argument-cache generations. Reused IDs remain safe because the
 * cache verifies every predicted argument before returning a result.
 */
export const ARGUMENT_CACHE_PREDICTION_SLOTS = 2048;

export const SPACE_CHARACTER = " ";
export const OPEN_BRACKET_CHARACTER = "[";
export const COLON_CHARACTER = ":";

export const SLICED_REPRESENTATION_MIN_LENGTH = 13;

export const INITIAL_CLAIM_SLOTS = 256;
export const INITIAL_TOKEN_SLOTS = 64;
export const INITIAL_CONFLICT_POOL_SLOTS = 1024;
export const INITIAL_PREPARED_PART_SLOTS = 16;

export const FNV_SIGNED_OFFSET_BASIS = -2128831035;
export const FNV_PRIME = 16777619;

export const FINGERPRINT_LENGTH_FACTOR = 61;
export const FINGERPRINT_FIRST_CHARACTER_FACTOR = 131;
export const FINGERPRINT_LAST_CHARACTER_FACTOR = 31;
export const FINGERPRINT_MIDDLE_CHARACTER_FACTOR = 7;
