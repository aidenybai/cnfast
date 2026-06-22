import { type ClassValue, resolveClassValue } from "./clsx.js";
import { mergeTemplate } from "./lib/merge-template.js";
import { twMerge } from "./lib/tw-merge.js";

export interface ClassNameFunction {
  /** Tagged-template form: ``cn`px-2 ${active && "bg-blue-500"}` `` — identity-cached per call site. */
  (strings: TemplateStringsArray, ...values: ClassValue[]): string;
  /** Standard variadic form: `cn("px-2", active && "bg-blue-500")`. */
  (...inputs: ClassValue[]): string;
}

// On V8 (Chrome, Node, Edge, Deno, Electron) a `cache[joinedClassList]` lookup re-flattens and
// re-hashes the joined string on every call, because the join is a fresh string each render and V8
// caches a string's hash only on the object it first hashed — so repeated multi-arg calls pay a
// full O(length) hash every time (the dominant cost the profiler shows on the cached path). The
// `argCache` below sidesteps that by keying on the stable individual arg strings (whose hashes ARE
// cached) instead of the fresh join, which benchmarks ~4x faster on V8.
//
// JavaScriptCore (Safari, Bun) and SpiderMonkey (Firefox) hash freshly-built strings cheaply, so
// they never had that bottleneck and the extra cache layer is pure overhead (measurably ~2x slower
// on JSC). The cache is therefore gated to V8 only; every other engine takes the original
// resolve+join path unchanged. V8 `Error` instances expose neither JSC's own `line` property nor
// SpiderMonkey's `lineNumber`, so their joint absence is a deterministic, allocation-free, timing-
// free engine signal — evaluated once at module load, never per call.
const IS_V8 = (() => {
  const error = new Error();
  return !("line" in error) && !("lineNumber" in error);
})();

interface ArgCacheEntry {
  /** Truthy string args after the first, in source order; the bucket key is the first truthy arg. */
  rest: string[];
  result: string;
}

// Max distinct rest-sequences kept per first-arg bucket before the oldest is dropped. Sized to
// hold a real component's full variant set under one shared leading class (e.g. a button whose
// base classes are constant while size/state variants differ): too small and a hot bucket thrashes
// back into rebuild+rehash on every render. The bucket is scanned linearly, but each miss bails on
// the first differing arg (pointer-compared), so even a full bucket is far cheaper than re-hashing.
const ARG_CACHE_BUCKET_SIZE = 64;
/** First-arg buckets kept before a generation rotates into `previousArgCache`. */
const ARG_CACHE_SIZE = 500;

// Variadic-call result cache (V8 only — see `IS_V8`), keyed on the ordered sequence of truthy
// string args. The merged output of `cn("a", cond && "b", ...)` depends ONLY on which string args
// are truthy and their order (the join drops falsy values and separates the rest with single
// spaces), so an identical arg sequence always yields an identical result and can be cached on the
// sequence. The arg strings are stable across renders (JSX literals), so the bucket
// `Map.get(firstArg)` + identity scan never re-hashes. Two-generation rotation bounds growth the
// same way the whole-string and descriptor caches do.
let argCache = new Map<string, ArgCacheEntry[]>();
let previousArgCache = new Map<string, ArgCacheEntry[]>();
let argCacheCount = 0;

// Variadic merge for V8, split out of `cn` so the hot single-arg and template dispatch in `cn`
// stays small enough to stay fully optimized — folding this body inline measurably deopts the
// single-arg path. `inputs` is the already-materialized arg list (copied by index in `cn`, never
// the live `arguments` object, preserving its allocation-elision there).
const mergeVariadicCached = (inputs: ClassValue[]): string => {
  const length = inputs.length;

  // Locate the truthy args and check they are all strings. Only then is the result fully
  // determined by the truthy-string sequence and eligible for `argCache`; a truthy object/array
  // arg is mutable (its resolved classes can change between calls at the same identity), so any
  // such call falls through to the always-correct resolve+join+merge path below.
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

    let bucket = argCache.get(firstKey);
    if (bucket === undefined) bucket = previousArgCache.get(firstKey);
    if (bucket !== undefined) {
      for (let entryIndex = 0; entryIndex < bucket.length; entryIndex++) {
        const entry = bucket[entryIndex]!;
        const rest = entry.rest;
        if (rest.length !== truthyStringCount - 1) continue;
        let restIndex = 0;
        let isMatch = true;
        for (let index = firstKeyIndex + 1; index < length; index++) {
          const item = inputs[index];
          if (!item) continue;
          if (item !== rest[restIndex++]) {
            isMatch = false;
            break;
          }
        }
        if (isMatch) return entry.result;
      }
    }

    let joined = firstKey;
    const rest: string[] = [];
    for (let index = firstKeyIndex + 1; index < length; index++) {
      const item = inputs[index];
      if (!item) continue;
      joined += " " + (item as string);
      rest.push(item as string);
    }
    const result = twMerge.mergeString(joined);

    let target = argCache.get(firstKey);
    if (target === undefined) {
      target = [];
      argCache.set(firstKey, target);
    }
    if (target.length >= ARG_CACHE_BUCKET_SIZE) target.shift();
    target.push({ rest, result });
    if (++argCacheCount > ARG_CACHE_SIZE) {
      argCacheCount = 0;
      previousArgCache = argCache;
      argCache = new Map();
    }

    return result;
  }

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

// Implemented as a `function` reading `arguments` (not an arrow with a rest param) on purpose: a
// rest param forces V8 to allocate an array on every call, whereas `arguments` accessed only via
// `.length`/index never escapes here, so V8 elides it. The single-argument branch is the common
// call shape (`cn("...")`, and every cache-miss merge), and skips the join loop entirely.
// `twMerge.mergeString` self-patches from the lazy initializer to the direct merge after warmup.
/* eslint-disable prefer-rest-params -- a rest param would defeat the allocation-elision this relies on */
export const cn: ClassNameFunction = function (): string {
  const first = arguments[0];

  // Tagged-template call (``cn`...` ``): the first arg is a frozen `TemplateStringsArray`, which is
  // a real array carrying a `.raw` array. The array check is what makes this safe: a plain class
  // dictionary such as `cn({ raw: true })` is an object with a `raw` key but is NOT an array, and a
  // class-value array (`cn(["px-2"])`) is an array but never carries `.raw`, so only a genuine
  // tagged template satisfies both. Reading `arguments` only by index here keeps V8's
  // arguments-elision intact; the interpolations are copied into a fresh array so the `arguments`
  // object itself never escapes into `mergeTemplate`.
  if (Array.isArray(first) && "raw" in first) {
    const strings = first as unknown as TemplateStringsArray;
    const length = arguments.length;
    const values: ClassValue[] = [];
    for (let index = 1; index < length; index++) values.push(arguments[index]);
    return mergeTemplate(strings, values);
  }

  const length = arguments.length;

  if (length === 1) {
    return typeof first === "string"
      ? twMerge.mergeString(first)
      : twMerge.mergeString(resolveClassValue(first));
  }

  // V8 only: copy args by index (never forwarding the live `arguments` object, which would defeat
  // its elision on the hot single-arg path above) and delegate to the arg-sequence cache, which
  // avoids re-hashing the fresh join on repeated calls.
  if (IS_V8) {
    const inputs: ClassValue[] = [];
    for (let index = 0; index < length; index++) inputs.push(arguments[index]);
    return mergeVariadicCached(inputs);
  }

  // Every other engine (JSC, SpiderMonkey, unknown): the original resolve+join path, byte-for-byte,
  // with no extra cache layer or arg-array copy — those are net overhead where fresh strings hash
  // cheaply.
  let result = "";
  for (let index = 0; index < length; index++) {
    const item = arguments[index];
    if (!item) continue;
    const resolved = typeof item === "string" ? item : resolveClassValue(item);
    if (resolved) {
      if (result) result += " ";
      result += resolved;
    }
  }

  return twMerge.mergeString(result);
};
/* eslint-enable prefer-rest-params */

export default cn;

export { clsx, type ClassValue, type ClassDictionary } from "./clsx.js";
export { twJoin, type ClassNameValue } from "./lib/tw-join.js";
export { twMerge } from "./lib/tw-merge.js";
