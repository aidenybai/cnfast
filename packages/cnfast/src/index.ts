import { type ClassValue, resolveClassValue } from "./clsx.js";
import { createTailwindMerge, type TailwindMerge } from "./lib/create-tailwind-merge.js";
import { getDefaultConfig } from "./lib/default-config.js";
import { mergeConfigs } from "./lib/merge-configs.js";
import { twMerge } from "./lib/tw-merge.js";
import type { AnyConfig, ConfigExtension } from "./lib/types.js";

export interface ClassNameFunction {
  /** Standard variadic form: `cn("px-2", active && "bg-blue-500")`. */
  (...inputs: ClassValue[]): string;
}

// A `cache[joinedClassList]` lookup re-flattens and re-hashes the joined string on every call,
// because the join is a fresh string each render and engines cache a string's hash only on the
// object that first computed it — so repeated multi-arg calls pay a full O(length) hash every time
// (the dominant cost profilers show on the cached path: V8 re-hashes the fresh join; JSC
// additionally flattens the rope, ~112 ns of a 180 ns warm call on Bun). The `argCache` below
// sidesteps that by keying on the stable individual arg strings (whose hashes ARE cached) instead
// of the fresh join. An earlier revision gated this cache to V8 because a `{rest, result}`
// object-per-entry layout measured ~2x slower on JSC; the flat interleaved bucket layout below
// removed that overhead (measured faster than the plain resolve+join path on Bun as well), so the
// cache now runs unconditionally on every engine.

// One first-arg bucket, holding entries laid out inline:
//   [restLen, rest0..restN-1, result, restLen, ...]
// where `restLen` is the count of truthy string args after the first and `result` the merged
// output for that exact truthy-arg sequence. A probe walks entry to entry with stride
// `restLen + 2`, doing sequential element loads instead of a dependent object load per entry
// (the old `{rest, result}[]` shape), and an insert pushes slots instead of allocating an entry
// object plus a rest array.
type ArgCacheBucket = (string | number)[];

// Max slots kept per first-arg bucket, sized to hold a real component's full variant set under one
// shared leading class (~64 two-arg entries; e.g. a button whose base classes are constant while
// size/state variants differ): too small and a hot bucket thrashes back into rebuild+rehash on
// every render. The bucket is scanned linearly, but each miss bails on the first differing slot
// (pointer-compared), so even a full bucket is far cheaper than re-hashing. On overflow the oldest
// half is dropped in one `copyWithin` (entries are variable-stride, so a ring buffer or
// swap-with-last cannot express eviction here; the old per-insert `shift()` was O(bucket) on every
// insert into a full bucket, the half-drop is O(bucket) once per ~half-bucket of inserts).
const ARG_CACHE_BUCKET_SLOTS = 256;
/** Entry inserts per generation before it rotates into `previousArgCache`. */
const ARG_CACHE_SIZE = 500;

/** Drops the oldest entries up to (at least) the halfway slot, preserving entry boundaries. */
const trimBucket = (bucket: ArgCacheBucket): void => {
  const half = bucket.length >> 1;
  let position = 0;
  while (position < half) position += (bucket[position] as number) + 2;
  bucket.copyWithin(0, position);
  bucket.length -= position;
};

// Factory (not inlined) so a configured `cn` from `createCn` keeps the default's fast paths: each
// instance owns its arg cache; only the bound `twMerge` differs.
const buildCn = (twMerge: TailwindMerge): ClassNameFunction => {
  // Variadic-call result cache, keyed on the ordered sequence of truthy string args. The merged
  // output of `cn("a", cond && "b", ...)` depends ONLY on which string args are truthy and their
  // order (the join drops falsy values and separates the rest with single spaces), so an identical
  // arg sequence always yields an identical result and can be cached on the sequence. The arg
  // strings are stable across renders (JSX literals), so the bucket `Map.get(firstArg)` + identity
  // scan never re-hashes. Two-generation rotation bounds growth the same way the whole-string and
  // descriptor caches do.
  let argCache = new Map<string, ArgCacheBucket>();
  let previousArgCache = new Map<string, ArgCacheBucket>();
  let argCacheCount = 0;

  // Second-sighting doorkeeper for arbitrary-value sequences. A call like
  // `cn(base, `bg-[rgb(${r}_${g}_${b})]`)` produces a never-repeating truthy sequence per render;
  // unconditionally caching those filled hot buckets with dead entries (every later probe scanned
  // past them) and paid insert+rotation churn per call — measured ~18% off the fully-dynamic grid
  // on Bun. But '[' alone cannot distinguish a fresh interpolation from a stable arbitrary-value
  // literal (`w-[350px]` — 43% of real-world multi-arg call sites), so instead of refusing '['
  // sequences outright, their joined form is remembered on first miss and admitted to `argCache`
  // only when seen again: dynamic strings never repeat and never pollute, stable literals are
  // cached from their second render on. Non-'[' sequences skip the doorkeeper entirely (plain
  // variant strings are overwhelmingly stable, and the extra rotating-set hash would tax every
  // real miss). The set rotates in two generations like every other cache here.
  let seenOnce = new Set<string>();
  let previousSeenOnce = new Set<string>();

  const admitToArgCache = (joined: string): boolean => {
    if (joined.indexOf("[") === -1) return true;
    if (seenOnce.has(joined) || previousSeenOnce.has(joined)) return true;
    seenOnce.add(joined);
    if (seenOnce.size > ARG_CACHE_SIZE) {
      previousSeenOnce = seenOnce;
      seenOnce = new Set();
    }
    return false;
  };

  // Bucket probe shared by every cacheable shape: current generation first, then the previous one.
  // A bucket found only in the previous generation is promoted (by reference — O(1)) into the
  // current Map immediately, mirroring the per-entry promotion of the whole-string and descriptor
  // caches: without it a hot call site fell off a cliff every ~500-insert rotation and re-paid the
  // full rebuild+join+rehash. Promotion also makes the subsequent miss-insert land in the surviving
  // bucket instead of shadowing it with a fresh empty one.
  const findBucket = (firstKey: string): ArgCacheBucket | undefined => {
    const bucket = argCache.get(firstKey);
    if (bucket !== undefined) return bucket;
    const previous = previousArgCache.get(firstKey);
    if (previous !== undefined) argCache.set(firstKey, previous);
    return previous;
  };

  // Post-insert bookkeeping, shared by every insert site. Counting inserts (not promoted buckets)
  // keeps rotation cadence identical to the old per-entry accounting.
  const noteInsert = (): void => {
    if (++argCacheCount > ARG_CACHE_SIZE) {
      argCacheCount = 0;
      previousArgCache = argCache;
      argCache = new Map();
    }
  };

  // Registers a bucket for a first key that had none (in either generation) and returns it ready
  // for the insert; existing buckets get trimmed here when full.
  const bucketForInsert = (firstKey: string, bucket: ArgCacheBucket | undefined): ArgCacheBucket => {
    if (bucket === undefined) {
      bucket = [];
      argCache.set(firstKey, bucket);
    } else if (bucket.length >= ARG_CACHE_BUCKET_SLOTS) {
      trimBucket(bucket);
    }
    return bucket;
  };

  // Shared fallback for any call whose truthy args are not all strings (an object/array arg is
  // mutable — its resolved classes can change between calls at the same identity — so the result
  // is not determined by arg identity and must bypass `argCache`), byte-for-byte the original
  // resolve+join+merge path.
  const mergeResolvedList = (inputs: ClassValue[]): string => {
    const length = inputs.length;
    let result = "";
    for (let index = 0; index < length; index++) {
      const item = inputs[index];
      if (!item) continue;
      const resolved = typeof item === "string" ? item : resolveClassValue(item);
      if (resolved) {
        if (result) result += " ";
        result += resolved;
      }
    }

    return twMerge.mergeString(result);
  };

  // Arity-2 fast path: probes the arg cache straight off the two argument values, so a hit
  // touches no allocation at all (no `inputs` array, no entry objects — the old path materialized
  // an args copy per call, 257 B/call and 25-36% of hit-path self-time in profiles). The falsy
  // shapes reduce to smaller call shapes exactly as the generic truthy-scan would.
  const cn2 = (a: ClassValue, b: ClassValue): string => {
    if (typeof a === "string" && a !== "") {
      if (typeof b === "string" && b !== "") {
        const bucket = findBucket(a);
        if (bucket !== undefined) {
          for (let position = 0, slots = bucket.length; position < slots; ) {
            const restLength = bucket[position] as number;
            if (restLength === 1 && bucket[position + 1] === b)
              return bucket[position + 2] as string;
            position += restLength + 2;
          }
        }
        const joined = a + " " + b;
        const result = twMerge.mergeString(joined);
        if (admitToArgCache(joined)) {
          bucketForInsert(a, bucket).push(1, b, result);
          noteInsert();
        }
        return result;
      }
      if (!b) return twMerge.mergeString(a);
      return mergeResolvedList([a, b]);
    }
    if (!a) {
      if (!b) return "";
      if (typeof b === "string") return twMerge.mergeString(b);
      return mergeResolvedList([a, b]);
    }
    return mergeResolvedList([a, b]);
  };

  // Arity-3 fast path; single-falsy shapes reduce to `cn2`/single-string so the reduced truthy
  // sequence shares cache entries with calls that pass it directly (the cache key is the truthy
  // sequence, not the arity).
  const cn3 = (a: ClassValue, b: ClassValue, c: ClassValue): string => {
    if (typeof a === "string" && a !== "") {
      if (typeof b === "string" && b !== "") {
        if (typeof c === "string" && c !== "") {
          const bucket = findBucket(a);
          if (bucket !== undefined) {
            for (let position = 0, slots = bucket.length; position < slots; ) {
              const restLength = bucket[position] as number;
              if (restLength === 2 && bucket[position + 1] === b && bucket[position + 2] === c)
                return bucket[position + 3] as string;
              position += restLength + 2;
            }
          }
          const joined = a + " " + b + " " + c;
          const result = twMerge.mergeString(joined);
          if (admitToArgCache(joined)) {
            bucketForInsert(a, bucket).push(2, b, c, result);
            noteInsert();
          }
          return result;
        }
        if (!c) return cn2(a, b);
        return mergeResolvedList([a, b, c]);
      }
      if (!b) {
        if (!c) return twMerge.mergeString(a);
        if (typeof c === "string") return cn2(a, c);
        return mergeResolvedList([a, b, c]);
      }
      return mergeResolvedList([a, b, c]);
    }
    if (!a) return cn2(b, c);
    return mergeResolvedList([a, b, c]);
  };

  // Variadic merge for arity >= 4, split out of `cn` so the hot single-arg dispatch stays small
  // enough to stay fully optimized — folding this body inline measurably deopts the single-arg
  // path. `inputs` is the already-materialized arg list (copied by index in `cn`, never the live
  // `arguments` object, preserving its allocation-elision there).
  const mergeVariadicCached = (inputs: ClassValue[]): string => {
    const length = inputs.length;

    // Locate the truthy args and check they are all strings. Only then is the result fully
    // determined by the truthy-string sequence and eligible for `argCache`; any other shape falls
    // through to the always-correct resolve+join+merge path.
    let firstKey = "";
    let firstKeyIndex = -1;
    let truthyStringCount = 0;
    let everyTruthyIsString = true;
    for (let index = 0; index < length; index++) {
      const item = inputs[index];
      if (!item) continue;
      if (typeof item !== "string") {
        everyTruthyIsString = false;
        break;
      }
      if (firstKeyIndex === -1) {
        firstKey = item;
        firstKeyIndex = index;
      }
      truthyStringCount++;
    }

    if (everyTruthyIsString) {
      // An all-falsy variadic call joins to "" and merges to "".
      if (truthyStringCount === 0) return "";
      // A lone truthy string behaves like the single-arg path: `firstKey` is a stable arg, so its
      // hash is already cached and the whole-string lookup is cheap without a separate arg-cache entry.
      if (truthyStringCount === 1) return twMerge.mergeString(firstKey);

      const restLengthWanted = truthyStringCount - 1;
      const bucket = findBucket(firstKey);
      if (bucket !== undefined) {
        for (let position = 0, slots = bucket.length; position < slots; ) {
          const restLength = bucket[position] as number;
          if (restLength === restLengthWanted) {
            let restIndex = position + 1;
            let isMatch = true;
            for (let index = firstKeyIndex + 1; index < length; index++) {
              const item = inputs[index];
              if (!item) continue;
              if (item !== bucket[restIndex++]) {
                isMatch = false;
                break;
              }
            }
            if (isMatch) return bucket[position + restLength + 1] as string;
          }
          position += restLength + 2;
        }
      }

      let joined = firstKey;
      for (let index = firstKeyIndex + 1; index < length; index++) {
        const item = inputs[index];
        if (item) joined += " " + (item as string);
      }
      const result = twMerge.mergeString(joined);

      if (admitToArgCache(joined)) {
        // The entry's rest slots are pushed straight from `inputs` — no intermediate `rest` array.
        const target = bucketForInsert(firstKey, bucket);
        target.push(restLengthWanted);
        for (let index = firstKeyIndex + 1; index < length; index++) {
          const item = inputs[index];
          if (item) target.push(item as string);
        }
        target.push(result);
        noteInsert();
      }

      return result;
    }

    return mergeResolvedList(inputs);
  };

  // Implemented as a `function` reading `arguments` (not an arrow with a rest param) on purpose: a
  // rest param forces V8 to allocate an array on every call, whereas `arguments` accessed only via
  // `.length`/index never escapes here, so V8 elides it. The single-argument branch is the common
  // call shape (`cn("...")`, and every cache-miss merge), and skips the join loop entirely; the
  // arity-2/3 shapes hand their argument values to dedicated fast paths without materializing an
  // array. `twMerge.mergeString` self-patches from the lazy initializer to the direct merge after
  // warmup.
  /* eslint-disable prefer-rest-params -- a rest param would defeat the allocation-elision this relies on */
  const cn: ClassNameFunction = function (): string {
    const first = arguments[0];

    const length = arguments.length;

    if (length === 1) {
      return typeof first === "string"
        ? twMerge.mergeString(first)
        : twMerge.mergeString(resolveClassValue(first));
    }

    if (length === 2) return cn2(first, arguments[1]);
    if (length === 3) return cn3(first, arguments[1], arguments[2]);

    // Arity >= 4: copy args by index into a presized array (never forwarding the live `arguments`
    // object, which would defeat its elision on the hot shapes above; `new Array(length)` +
    // indexed stores measured ~9% faster than push-growing) and delegate to the arg-sequence
    // cache, which avoids re-hashing the fresh join on repeated calls.
    const inputs: ClassValue[] = new Array(length);
    for (let index = 0; index < length; index++) inputs[index] = arguments[index];
    return mergeVariadicCached(inputs);
  };
  /* eslint-enable prefer-rest-params */

  return cn;
};

export const cn: ClassNameFunction = buildCn(twMerge);

export default cn;

/**
 * Configurable counterpart to the default `cn`. Accepts the same `{ override, extend }` extension as
 * tailwind-merge's `extendTailwindMerge`, or a `(defaultConfig) => config` function.
 *
 * @example
 * const cn = createCn({ extend: { classGroups: { "font-size": ["text-24-regular"] } } });
 * cn("text-foreground text-24-regular"); // keeps both — different groups
 */
export const createCn = (
  config: ConfigExtension | ((defaultConfig: AnyConfig) => AnyConfig),
): ClassNameFunction => {
  const createConfig: () => AnyConfig =
    typeof config === "function"
      ? () => config(getDefaultConfig())
      : () => mergeConfigs(getDefaultConfig(), config);
  return buildCn(createTailwindMerge(createConfig));
};

export { clsx, type ClassValue, type ClassDictionary } from "./clsx.js";
export { twJoin, type ClassNameValue } from "./lib/tw-join.js";
export { twMerge } from "./lib/tw-merge.js";
export { createTailwindMerge, type TailwindMerge } from "./lib/create-tailwind-merge.js";
export { getDefaultConfig } from "./lib/default-config.js";
export { mergeConfigs } from "./lib/merge-configs.js";
export type { AnyConfig, ConfigExtension } from "./lib/types.js";
