// 2,048 entries cover the largest measured render. Repeated overflow grows the cache to 8,192.
export const MERGE_CACHE_CAPACITY = 2048;
export const MERGE_CACHE_CAPACITY_MAX = 8192;

// A class list must appear twice before caching. This keeps its first sighting through large renders.
export const DOORKEEPER_SLOTS = 8192;

// Arbitrary variants can create unlimited conflict keys. This stays above measured vocabularies.
export const MAX_CONFLICT_KEYS = 16384;

// 2,048 entries across two generations cover the largest measured argument vocabulary.
export const PREPARED_PART_CACHE_SIZE = 2048;

// Half occupancy keeps probing bounded. Frequent promotions allow growth up to the memory limit.
export const INTERN_TABLE_INITIAL_SLOTS = 2048;
export const INTERN_TABLE_MAX_SLOTS = 16384;
export const INTERN_TABLE_HARD_MAX_SLOTS = 32768;

// JSC verifies longer tokens 2.6 to 5.1 times faster with `startsWith`. V8 does not.
export const JSC_STARTSWITH_VERIFY_MIN_LENGTH = 12;

export const RESULT_INTERN_SLOTS = 1024;

// Bucket limits count calls. Rotation counts slots to track retained memory across call arities.
export const ARGUMENT_CACHE_BUCKET_ENTRIES = 96;
export const ARGUMENT_CACHE_ROTATION_SLOTS = 2048;
export const ARGUMENT_CACHE_SEEN_ONCE_CAPACITY = 500;

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
