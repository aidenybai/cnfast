# cnfast architecture

This document explains how `cnfast` turns a list of class values into a merged Tailwind class string, and why each layer is built the way it is. It targets contributors who want to change the hot paths without regressing speed or output parity. Read it top to bottom once; after that, each section stands alone as a reference.

`cnfast` is a dependency-free replacement for `clsx` plus `tailwind-merge` behind a single `cn` function. It matches their combined output exactly while running the uncached merge engine about 3.1x faster on the benchmark corpus. The speed comes from caching, integer interning, and allocation-free data structures, not from cutting features.

## Design principles

These principles decide most trade-offs in the codebase. When a change helps one and hurts another, the order below breaks the tie.

- **Match `clsx` and `tailwind-merge` output exactly**: parity is the contract. A differential fuzz test compares `cn` against the real libraries on random input, so any divergence fails the suite.
- **Do the expensive work once, then cache it**: parsing a token, finding its class group, and computing its conflicts are deterministic. `cnfast` memoizes that result per token and reuses it across every call.
- **Allocate nothing on the hot path**: object literals, arrays, and `Set` instances created per call dominate the cost of a fast function. The merge loop reuses buffers and integer indices instead.
- **Keep object shapes monomorphic**: V8 optimizes call sites that always read the same object shape. Every parse and descriptor result flows through one factory with identical key order.
- **Stay dependency-free and tree-shakeable**: the `cn` bundle includes only the code it references. The bundler excludes anything a caller doesn’t import.

## How cn resolves a class string

`cn` is the composition of two independent layers: a join step and a merge step. The join step flattens your arguments into one space-separated string. The merge step removes Tailwind classes that conflict, keeping the last one.

```typescript
export const cn: (...inputs: ClassValue[]) => string = function (): string {
  if (arguments.length === 1) {
    const only = arguments[0];
    return typeof only === "string"
      ? twMerge.mergeString(only)
      : twMerge.mergeString(resolveClassValue(only));
  }
  // ... otherwise join arguments[0..length] then mergeString the result
};
```

`cn` is a `function` reading `arguments`, not an arrow with a rest parameter, because a rest parameter forces V8 to allocate an array on every call. Here `arguments` is read only through `.length` and indexing and never escapes, so V8 elides it. The single-argument branch is the common call shape, `cn("...")` and every cache-miss merge in the benchmark, and skips the join loop. `resolveClassValue` lives in `src/clsx.ts` and does the `clsx` work for non-string arguments; `mergeString` lives in `src/lib/tw-merge.ts` and runs the conflict resolver on an already-joined string.

## Joining inputs with clsx

The join layer accepts strings, numbers, arrays, and objects, and returns a single class string. `resolveClassValue` recurses through arrays and reads truthy keys from objects, building the result with plain string concatenation.

The loop uses index-based `for` iteration and `+=` rather than `map` or `join`, because the array methods allocate intermediate arrays that the concatenation avoids. It skips falsy items without a recursive call and takes a string fast path inline, since most arguments to `cn` and `clsx` are plain class strings. `Array.isArray` is hoisted to a module-level binding so the hot path loads a local variable instead of a property on the global `Array` object. The public `clsx` export is one line: it forwards its arguments array to the same `resolveClassValue` function, so there’s no duplicated traversal code.

## Resolving conflicts with tailwind-merge

The merge layer is a fork of `tailwind-merge` rebuilt around a per-token cache. It runs in three stages for each unique token: parse the name, find its class group, then resolve conflicts across the full string. The whole loop and the per-token analysis both live in `src/lib/config-utils.ts`, so the merge touches the conflict tracker as direct array writes instead of through helper calls.

### Parsing a class name

`parseClassName` in `src/lib/parse-class-name.ts` splits a token into its variant modifiers, base class, important flag, and optional postfix modifier. It walks the string once, tracking bracket and parenthesis depth so separators inside arbitrary values like `[&:hover]` don’t split the token.

The loop reads `charCodeAt(index)` and compares numbers rather than reading `className[index]` and comparing one-character strings. Each string index access allocates a new single-character string; the character-code comparison allocates nothing. On cache misses across thousands of unique tokens, that difference shows up on the uncached corpus.

### Finding the class group

`getClassGroupId` in `src/lib/class-group-utils.ts` maps a base class to its conflict group, for example `px-4` to the horizontal-padding group. The class definitions compile once at startup into a trie of `Map` nodes keyed by the dash-separated parts of each class. Lookups walk the trie part by part, falling back to a list of validator functions for arbitrary values.

The trie build runs a single time, lazily, on the first `cn` call. It’s not on the per-call path, so its cost amortizes to zero across a session.

### Resolving conflicts right to left

`mergeClassList` splits the string with a manual ASCII-whitespace scanner that skips the `trim()` allocation, then scans the tokens from right to left, because the rightmost class wins in Tailwind. For each token it looks up a descriptor, then records a keep-or-drop decision in a reused `Uint8Array` flag buffer indexed by token position: a token is dropped if a later class already claimed its conflict group, otherwise it is kept and claims the token’s groups. A second left-to-right pass emits the kept tokens in source order, so neither a `kept` array nor a reversal is needed.

Two structural shortcuts skip most of that machinery, because real class lists are short. A single token can’t conflict with itself, so when the split yields exactly one token the merge returns it verbatim — no descriptor lookup, no conflict tracking, no rebuild. On real corpora about 60% of merges hit this path, and on a cache miss it also avoids the descriptor _compute_. When there are more tokens but nothing was dropped and the input is already space-normalized, the rebuild would only recreate the input, so the merge returns the original string instead of concatenating a fresh one. Normalization is detected for free: the first pass already sums token lengths, and the input is byte-identical to `tokens.join(" ")` exactly when its length equals that sum plus the separator count and the splitter saw no non-space whitespace. Another ~17% of merges take this path.

Each token resolves to a `ClassDescriptor`: a flag for non-Tailwind classes, the integer ID of the token’s own conflict key, and the integer IDs of the keys it overrides.

```typescript
interface ClassDescriptor {
  isExternal: boolean;
  classId: number;
  conflictIds: number[];
}
```

## Where the speed comes from

The benchmark splits into two corpora, and each rewards a different technique. The cached corpus repeats a small set of strings, so it measures the whole-string cache lookup. The uncached corpus passes only unique strings, so it measures the merge engine itself. The techniques below target both.

### Two levels of caching

`cnfast` caches at two granularities, both using a least recently used (LRU) policy. The outer cache maps a full class string to its merged result and holds 500 entries, the same bound `tailwind-merge` uses; it is inlined into `tailwindMerge` in `src/lib/create-tailwind-merge.ts`. The inner cache maps a single token to its `ClassDescriptor` and holds 4096 entries; it is inlined into `config-utils.ts`. Both are inlined rather than hidden behind a `get`/`set` helper because each is on a per-call (and the inner one per-token) hot path, where a closure hop is measurable.

`tailwind-merge` caches only whole strings. The per-token descriptor cache is the structural difference: when two different class strings share the token `flex`, `cnfast` parses and classifies `flex` once and reuses the descriptor for both.

Both caches are a two-generation design backed by null-prototype objects from `Object.create(null)`. A full generation becomes the previous slot instead of evicting entries one at a time, which keeps writes allocation-free in the common case. `cnfast` uses null-prototype objects instead of `Map` because property reads on them are faster than `Map.get` for this string-keyed, read-heavy pattern.

The `bench/lru.bench.ts` harness compares this design against `Map`-backed LRU, true LRU, SIEVE, and S3-FIFO on lookup speed and on hit ratio under a skewed access pattern. The two-generation object wins or ties on every axis: it is fastest when the working set fits, and because it holds up to two generations it reaches a higher hit ratio than SIEVE or S3-FIFO under capacity pressure. Those algorithms raise hit ratio elsewhere by adding per-access bookkeeping over a `Map` index, which costs more than it saves here, so `cnfast` keeps the two-generation object.

### Interning conflict keys to integers

A conflict key is a string like `hover:bg` that identifies a group within a modifier context. Comparing these as strings means hashing a string on every membership check. `config-utils.ts` interns each key to a dense integer ID the first time it appears, so the merge loop compares integers instead.

Within a session a key keeps the same ID even after its descriptor leaves the LRU, which the merge relies on for consistency inside a pass. Most apps reuse a small, fixed set of `(modifier, group)` pairs, so the registry stays small and stable. The exception is the modifier: it can be an arbitrary variant such as `data-[id=123]:`, so an app generating unbounded distinct variants would grow the registry without bound. To cap that, `mergeClassList` resets the registry (and the descriptor caches that hold its IDs) once the ID count passes `MAX_CONFLICT_KEYS`. The reset runs between merges, never mid-pass, so IDs stay consistent within a single pass; the monotonic generation counter ensures a reused ID never reads a stale claim from an earlier merge. Memory is therefore bounded regardless of input.

### A generation-stamped claim tracker

The merge loop needs a set of conflict keys already claimed by a later class. The obvious implementation allocates a fresh `Set` per call, one allocation per merge on the uncached corpus. `cnfast` replaces that `Set` with a reusable `Int32Array` indexed by conflict-key ID.

Each merge bumps a generation counter, and claiming a key writes the current generation into the array at that key’s index. A key counts as claimed when its stored stamp equals the current generation. Starting a new merge is one integer increment, with no allocation and no per-element reset.

```typescript
currentGeneration = (currentGeneration + 1) | 0;
if (currentGeneration === 0) currentGeneration = 1;
const generation = currentGeneration;
// ... per token, after looking up its descriptor:
if (claimedGeneration[classId] === generation) continue;
claimedGeneration[classId] = generation;
```

The loop reads `claimedGeneration` directly rather than calling `claim` and `check` helpers, which is why it lives in the same closure as the tracker. It reads the array fresh on every access, so a mid-loop descriptor miss that grows the array stays correct. Conflict-key IDs are dense, so the array grows in the cold interning path whenever a new ID appears, and the index operations need no bounds checks. The tracker took the uncached corpus from 2.6x to over 3x faster than the reference.

### Keeping object shapes monomorphic

A single factory builds every parsed result and every descriptor with the same keys in the same order. `parseClassName` always returns the same shape, and the external-class case reuses one shared `EXTERNAL_DESCRIPTOR` object. Uniform shapes let V8 keep the reading call sites monomorphic, which avoids the slow polymorphic lookup path.

The codebase restricts `Object.entries`, `Object.keys`, and spread to startup-time config building. The per-call path never touches them.

### Lazy, self-patching initialization

The first `cn` call builds the config utilities, then rewrites the function pointer it calls so later calls skip the initialization check. `src/lib/create-tailwind-merge.ts` holds this `initTailwindMerge` pattern. Building the trie and caches costs nothing until you actually call `cn`, and costs nothing per call afterward.

### Skipping the hash with tagged templates

Profiling the cache-hit path shows roughly half its time is V8 hashing the joined class string for the whole-string cache lookup. That hash is irreducible for a `cn(...strings)` call: you must build a key and hash it to find a global cache entry, and `tailwind-merge` pays the same cost. The one way past it is to avoid hashing a string at all, which needs a stable, non-string handle for the class list.

A tagged template provides exactly that. ``cn`px-2 ${active && "bg-blue-500"}` `` calls `cn` with a `TemplateStringsArray` whose identity is reused on every evaluation of that call site, as the language guarantees. That array is a valid `WeakMap` key, unlike a plain string. `src/lib/merge-template.ts` keys a `WeakMap` on the strings array, then keeps a short per-site list of `{ interpolated values, result }` entries. A repeat call at the same site with the same string interpolations returns the cached result after an identity lookup and a few reference compares, skipping the join and the hash entirely.

Only string and falsy interpolations are cached, because they are immutable: an identity match cannot return a stale result. An object or array interpolation could be mutated while keeping its reference, so those calls always recompute. Detection costs nothing on the standard path: `cn` checks for the strings array only when its first argument is an object, which `cn("...")` and `cn(a, b)` skip after the `typeof` test. On a stable call site with an alternating variant, the tagged form runs about 3x faster than the equivalent `cn(...)` call and about 9x faster than `clsx` plus `tailwind-merge`.

## Bundle size

The `cn` bundle is about 9.0 KB minified and gzipped, against 8.4 KB for `clsx` plus `tailwind-merge`. The two are close because the Tailwind class-group data dominates the bundle, and that data is the same in both.

The default config in `src/lib/default-config.ts` is about 76% of the minified output. The merge engine, the join layer, and the caching machinery make up the rest. The per-token cache, interning, and generation tracker trade a fraction of a kilobyte for the speed, and the rest of the engine stays lean enough to keep the total within that margin of the reference.

## Measuring every change

Every hot-path change is gated on the commands below, run from `packages/cnfast`. Treat a change as an improvement only when parity stays green and the benchmark improves across a best-of-three or best-of-five run, never a single sample.

- **Parity**: `pnpm test` runs the full suite, including the differential fuzz test against the real `twMerge`
- **Speed**: `pnpm bench` runs the benchmark against `clsx` plus `tailwind-merge` across the cached and uncached corpora
- **Size**: `pnpm size` measures the minified and gzipped `cn` bundle against the reference
- **Deopts**: `pnpm deopt` traces V8 deoptimizations in the hot-path frames so a change that breaks optimization shows up

`pnpm iter <label>` runs the best-of-N benchmark and the size check together and appends the result to `bench/results.jsonl` under the label you pass. Use it to compare a change against the last recorded run.

## Output parity with tailwind-merge

Parity is non-negotiable, so the test suite enforces it. The suite in `tests/` ports the full `tailwind-merge` test set and adds a fuzz test that feeds random class strings to both `cn` and the reference `twMerge(clsx(...))`, failing on the first mismatch. Any optimization that changes output, however small, fails before it can ship.
