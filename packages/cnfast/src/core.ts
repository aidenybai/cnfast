import { type ClassValue, resolveClassValue } from "./clsx.js";
import { ARG_CACHE_BUCKET_SLOTS, ARG_CACHE_ROTATION_INSERTS } from "./lib/constants.js";
import { createTailwindMerge, type TailwindMerge } from "./lib/create-tailwind-merge.js";
import { getDefaultConfig } from "./lib/default-config.js";
import { mergeConfigs } from "./lib/merge-configs.js";
import { twMerge } from "./lib/tw-merge.js";
import type { AnyConfig, ConfigExtension } from "./lib/types.js";

export interface ClassNameFunction {
  /** Standard variadic form: `cn("px-2", active && "bg-blue-500")`. */
  (...inputs: ClassValue[]): string;
}

/**
 * Variadic-call result cache bucket: every entry sharing one first arg, laid out flat as
 *
 *     [restLen, rest0..restN-1, result, restLen, ...]
 *
 * where `restLen` counts the truthy string args after the first and `result` is the merged output
 * for that exact truthy-arg sequence.
 *
 * The cache exists because probing a plain `cache[joinedClassList]` re-hashes the fresh join on
 * every call — engines cache a string's hash only on the object that first computed it, and the
 * join is a new string each render (~112 ns of a 180 ns warm call on Bun, which also re-flattens
 * the rope). The individual arg strings are stable across renders (JSX literals) with cached
 * hashes, so keying on them makes a hit pure pointer compares: `Map.get(firstArg)`, then an
 * entry-to-entry walk with stride `restLen + 2`.
 *
 * The flat layout replaced a `{rest, result}[]` shape: sequential element loads instead of a
 * dependent object load per entry, and an insert pushes slots instead of allocating an entry
 * object plus a rest array. The object layout was ~2x slower on JSC; the flat one measures faster
 * than plain resolve+join there too, so the cache runs unconditionally on every engine.
 */
type ArgCacheBucket = (string | number)[];

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
  // Keyed on the ordered truthy-string arg sequence, which fully determines the result (the join
  // drops falsy args and separates the rest with single spaces). Two-generation rotation bounds
  // growth like every other cache here.
  let argCache = new Map<string, ArgCacheBucket>();
  let previousArgCache = new Map<string, ArgCacheBucket>();
  let argCacheCount = 0;

  // Second-sighting doorkeeper for arbitrary-value sequences. A call like
  // `cn(base, `bg-[rgb(${r}_${g}_${b})]`)` never repeats, and caching such sequences filled hot
  // buckets with dead entries (~18% off the fully-dynamic grid on Bun). But '[' alone cannot
  // distinguish a fresh interpolation from a stable literal like `w-[350px]` (43% of real
  // multi-arg call sites), so '['-containing joins are admitted only on their second sighting;
  // non-'[' sequences skip the check (overwhelmingly stable, and the extra hash would tax every
  // real miss).
  let seenOnce = new Set<string>();
  let previousSeenOnce = new Set<string>();

  const admitToArgCache = (joined: string): boolean => {
    if (joined.indexOf("[") === -1) return true;
    if (seenOnce.has(joined) || previousSeenOnce.has(joined)) return true;
    seenOnce.add(joined);
    if (seenOnce.size > ARG_CACHE_ROTATION_INSERTS) {
      previousSeenOnce = seenOnce;
      seenOnce = new Set();
    }
    return false;
  };

  // A bucket found only in the previous generation is promoted by reference into the current Map:
  // without this a hot call site fell off a cliff on every rotation, and a later miss-insert would
  // shadow the surviving bucket with a fresh empty one.
  const findBucket = (firstKey: string): ArgCacheBucket | undefined => {
    const bucket = argCache.get(firstKey);
    if (bucket !== undefined) return bucket;
    const previous = previousArgCache.get(firstKey);
    if (previous !== undefined) argCache.set(firstKey, previous);
    return previous;
  };

  const noteInsert = (): void => {
    if (++argCacheCount > ARG_CACHE_ROTATION_INSERTS) {
      argCacheCount = 0;
      previousArgCache = argCache;
      argCache = new Map();
    }
  };

  const bucketForInsert = (
    firstKey: string,
    bucket: ArgCacheBucket | undefined,
  ): ArgCacheBucket => {
    if (bucket === undefined) {
      bucket = [];
      argCache.set(firstKey, bucket);
    } else if (bucket.length >= ARG_CACHE_BUCKET_SLOTS) {
      trimBucket(bucket);
    }
    return bucket;
  };

  // Fallback for any call whose truthy args are not all strings: an object/array arg is mutable —
  // its resolved classes can change between calls at the same identity — so the result is not
  // determined by arg identity and must bypass `argCache`.
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

  // Arity-2 fast path: probes the arg cache straight off the argument values, so a hit touches no
  // allocation at all (the old path materialized an args copy per call — 257 B and 25-36% of
  // hit-path self-time). Falsy shapes reduce to smaller call shapes exactly as the generic
  // truthy-scan would.
  const cnTwoArgs = (a: ClassValue, b: ClassValue): string => {
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

  // Arity-3 fast path; single-falsy shapes reduce to `cnTwoArgs`/single-string so the reduced
  // truthy sequence shares cache entries with calls that pass it directly.
  const cnThreeArgs = (a: ClassValue, b: ClassValue, c: ClassValue): string => {
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
        if (!c) return cnTwoArgs(a, b);
        return mergeResolvedList([a, b, c]);
      }
      if (!b) {
        if (!c) return twMerge.mergeString(a);
        if (typeof c === "string") return cnTwoArgs(a, c);
        return mergeResolvedList([a, b, c]);
      }
      return mergeResolvedList([a, b, c]);
    }
    if (!a) return cnTwoArgs(b, c);
    return mergeResolvedList([a, b, c]);
  };

  // Arity >= 4, split out of `cn` so the hot single-arg dispatch stays small — folding this body
  // inline measurably deopts the single-arg path. `inputs` is a materialized copy, never the live
  // `arguments` object (which would defeat its allocation elision in `cn`).
  const mergeVariadicCached = (inputs: ClassValue[]): string => {
    const length = inputs.length;

    // The result is fully determined by the truthy-string sequence (and cacheable) only when every
    // truthy arg is a string; any other shape falls through to resolve+join+merge.
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
      if (truthyStringCount === 0) return "";
      // A lone truthy string is a stable arg with a cached hash, so the whole-string lookup is
      // cheap without a separate arg-cache entry.
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

  // A `function` reading `arguments` (not an arrow with a rest param) on purpose: a rest param
  // forces V8 to allocate an array per call, whereas `arguments` accessed only via `.length`/index
  // never escapes here and gets elided. Arity 1 is the common shape (`cn("...")` and every
  // cache-miss merge); arities 2/3 hand their values to dedicated fast paths with no array.
  /* eslint-disable prefer-rest-params -- a rest param would defeat the allocation-elision this relies on */
  const cn: ClassNameFunction = function (): string {
    const first = arguments[0];

    const length = arguments.length;

    if (length === 1) {
      return typeof first === "string"
        ? twMerge.mergeString(first)
        : twMerge.mergeString(resolveClassValue(first));
    }

    if (length === 2) return cnTwoArgs(first, arguments[1]);
    if (length === 3) return cnThreeArgs(first, arguments[1], arguments[2]);

    // Copy args by index into a presized array — never forward the live `arguments` object, which
    // would defeat its elision on the hot shapes above (`new Array(length)` + indexed stores
    // measured ~9% faster than push-growing).
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
