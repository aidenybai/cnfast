# Upstreaming cnfast optimizations to tailwind-merge

This document evaluates each cnfast merge-engine optimization for whether it is **correct** and **safe**
to contribute back to `tailwind-merge` (analysis against v3.6.0). "Safe" means: parity-preserving for
*all* of tailwind-merge's supported inputs and configs, not just cnfast's narrower input domain.

The key distinction throughout: cnfast targets **static, ASCII, single-config** class strings (JSX
literals under the default config). `tailwind-merge` must stay correct for **arbitrary input, Unicode
whitespace, custom configs, `prefix`, `experimentalParseClassName`, and many instances**. Several
cnfast shortcuts are sound in the narrow domain but become behavior changes or growth vectors in the
wide one.

## TL;DR verdict table

| # | Optimization | Verdict | Why |
| - | ------------ | ------- | --- |
| 1 | Single-token fast path | **Safe — land first** | A lone token is always returned verbatim by upstream; no config can change that. |
| 2 | Normalized-input no-op shortcut | **Safe with work** | Correct, but depends on a custom splitter (see #4) to compute its inputs. |
| 3 | `charCodeAt` parsing | **Safe — low value** | Byte-identical; pure micro-opt. Possible readability pushback. |
| 4 | ASCII-only whitespace splitter | **Needs maintainer decision** | Drops Unicode-whitespace splitting that `/\s+/` does today — a behavior change. |
| 5 | Per-token descriptor cache | **Safe with work** | Parity-safe and bounded; adds a second cache (memory + bundle). Needs a size/perf case. |
| 6 | Interned keys + `Int32Array` claim tracker | **Not safe as-is** | Intern registry never evicts and grows unbounded on dynamic arbitrary-variant modifiers. |
| — | clsx fusion / tagged template / arg cache + `IS_V8` | **Out of scope** | Not part of `twMerge`'s contract; keep in cnfast. |

---

## Parity bar

A change is landable only if it is byte-identical to current `tailwind-merge` output across:

- the full ported `tailwind-merge` test suite,
- the differential fuzz test (`cn` vs real `twMerge(clsx(...))`),
- **and** the inputs cnfast does *not* exercise: Unicode whitespace, `createTailwindMerge`/
  `extendTailwindMerge` custom configs, `prefix`, `experimentalParseClassName`, multiple concurrent
  instances, and dynamically generated arbitrary variants (`data-[id=123]:`).

The last bullet is where cnfast's test corpus is silent, so each optimization below is judged against
it explicitly.

---

## 1. Single-token fast path — SAFE, land first

cnfast, `src/lib/config-utils.ts`:

```220:222:packages/cnfast/src/lib/config-utils.ts
    if (classCount === 1) {
      return classNames[0]!;
    }
```

**Correctness.** Upstream `mergeClassList` trims then splits, and for every token it only ever
appends `originalClassName` to the result — it never rewrites token content. With exactly one token
there is nothing to conflict against, so the output is always that single (trimmed) token, verbatim.
This holds under **every** config: with a `prefix`, a single `tw:px-4` returns `tw:px-4`; an external
class returns itself; `experimentalParseClassName` is irrelevant because the token is never parsed.

**Edge cases checked.** Empty string and all-whitespace input do *not* hit this path under upstream's
splitter the same way (upstream `"".split(/\s+/)` yields `[""]`, length 1, returning `""`; the fast
path would also return `""`), so the result is identical either way.

**Upstream diff surface.** One `if` at the top of `mergeClassList`, after the split. No config
coupling. This is the foot-in-the-door PR.

## 2. Normalized-input no-op shortcut — SAFE, but coupled to #4

cnfast, `src/lib/config-utils.ts`:

```273:279:packages/cnfast/src/lib/config-utils.ts
    if (
      !didDrop &&
      !splitSawNonSpaceWhitespace &&
      classList.length === tokenCharCount + classCount - 1
    ) {
      return classList;
    }
```

**Correctness.** When nothing was dropped and the input is already single-space-normalized, the
rebuilt string would be byte-identical to the input, so returning the input is sound. The
length-equality test detects normalization for free.

**Blocker.** Its two inputs — `splitSawNonSpaceWhitespace` and `tokenCharCount` — are produced by
cnfast's custom splitter and right-to-left pass. Upstream's `classList.trim().split(/\s+/)` produces
neither. So this cannot land without first reworking the splitter (#4) and the two-pass loop. It
rides on #4's decision; it is not independently landable.

## 3. `charCodeAt` parsing — SAFE, low value

cnfast replaces `className[index]` / `endsWith` / `startsWith` with `charCodeAt` comparisons in
`parseClassName` (`src/lib/parse-class-name.ts`). Reading the same characters by code point is
byte-identical, including the empty-string case (`"".charCodeAt(-1)` is `NaN`, never matches `!`).

**Upstream diff surface.** Only the inner default parse loop in `createParseClassName` changes; the
`prefix` and `experimentalParseClassName` wrappers are untouched. Self-contained and parity-safe.

**Caveat.** The win is small and the code reads less obviously than `className[index]`. Expect the
maintainer to weigh readability; pitch it only with a measurable cache-miss-corpus delta, not on
principle.

## 4. ASCII-only whitespace splitter — NEEDS A MAINTAINER DECISION

cnfast, `src/lib/config-utils.ts`:

```70:100:packages/cnfast/src/lib/config-utils.ts
  const splitClassList = (classList: string): string[] => {
    const tokens: string[] = [];
    const length = classList.length;
    let tokenStart = -1;
    splitSawNonSpaceWhitespace = false;

    for (let index = 0; index < length; index++) {
      const charCode = classList.charCodeAt(index);

      if (charCode === 32) {
        // ... split on space
      } else if (charCode >= 9 && charCode <= 13) {
        splitSawNonSpaceWhitespace = true;
        // ... split on tab/LF/VT/FF/CR
      } else if (tokenStart === -1) {
        tokenStart = index;
      }
    }
    // ...
  };
```

**This is a behavior change, not just a speedup.** Upstream's `/\s+/` matches Unicode whitespace
(`\u00a0` non-breaking space, `\u2028`, `\u3000`, etc.). cnfast's splitter only treats ASCII
`\t\n\v\f\r` and space as separators. A class string separated by a non-breaking space splits under
upstream today but would **not** split under cnfast's splitter — a silent parity break for any
existing user relying on that.

cnfast is correct to do this (Tailwind tokens are ASCII, and the change is guarded by its own fuzz
corpus, which is ASCII), but **the wide domain is exactly where it diverges.** Landing it upstream
means upstream formally drops Unicode-whitespace separators. That is the maintainer's call to make,
not ours to assume. Frame it as: "twMerge no longer supports non-ASCII whitespace separators —
acceptable?" If yes, #2 and the allocation win come with it. If no, both stay in cnfast.

## 5. Per-token descriptor cache — SAFE, but needs a size/perf case

cnfast memoizes the full per-token analysis (parse + class-group lookup + conflict groups) keyed by
the raw token, in a bounded two-generation LRU:

```188:206:packages/cnfast/src/lib/config-utils.ts
  const getClassDescriptor = (originalClassName: string): ClassDescriptor => {
    let descriptor = descriptorCache[originalClassName];
    if (descriptor !== undefined) {
      return descriptor;
    }

    descriptor = previousDescriptorCache[originalClassName];
    if (descriptor === undefined) {
      descriptor = computeClassDescriptor(originalClassName);
    }

    descriptorCache[originalClassName] = descriptor;
    if (++descriptorCacheSize > DESCRIPTOR_CACHE_SIZE) {
      descriptorCacheSize = 0;
      previousDescriptorCache = descriptorCache;
      descriptorCache = Object.create(null);
    }
    return descriptor;
  };
```

**Correctness.** For a fixed config instance, a token's parse result, class group, and conflict
groups are deterministic, so caching them is sound. `createConfigUtils` runs per instance, so the
cache (and the structures in #6) are naturally per-instance — no cross-instance leakage. The cache
is **bounded** (`DESCRIPTOR_CACHE_SIZE = 4096`, two-generation), so dynamic arbitrary values
(`w-[123px]`) cannot grow it without bound. This satisfies the "bound any per-input cache" rule.

**Why it's the headline change.** Upstream caches *whole strings* only. The per-token cache is the
real structural difference: `flex` shared across two different strings is analyzed once. This is the
biggest engine win that is also genuinely upstreamable.

**Cost to negotiate.** It adds a second cache (runtime memory) and bundle weight. dcastil is
size-sensitive, so this needs an explicit perf-per-byte case, and possibly a config knob
(`descriptorCacheSize`, defaulting to something conservative or `0` to disable). Land it **after** the
cheap wins build trust. Note it can be landed *with string keys* (no interning) to decouple it from
the unsafe part of #6 — slower than the integer tracker, but with none of #6's growth risk.

## 6. Interned conflict keys + `Int32Array` claim tracker — NOT SAFE AS-IS

cnfast interns every `{modifierId}{classGroupId}` conflict key to a dense integer in a registry that
**never evicts**, then tracks claimed keys with a generation-stamped `Int32Array`:

```102:116:packages/cnfast/src/lib/config-utils.ts
  const conflictKeyIds = new Map<string, number>();
  let nextConflictKeyId = 0;
  const internConflictKey = (conflictKey: string): number => {
    let id = conflictKeyIds.get(conflictKey);
    if (id === undefined) {
      id = nextConflictKeyId++;
      conflictKeyIds.set(conflictKey, id);
      if (id >= claimedGeneration.length) {
        const grown = new Int32Array(claimedGeneration.length * 2);
        grown.set(claimedGeneration);
        claimedGeneration = grown;
      }
    }
    return id;
  };
```

**Correctness of the algorithm itself: fine.** Interning preserves string equality, so comparing
integer IDs is equivalent to upstream's `classGroupsInConflict.indexOf(stringKey)`. The generation
stamp (with the skip-0-on-wrap guard) reproduces the claimed-set semantics exactly, and turns
upstream's O(n) `indexOf` scan into O(1). Per-instance, so no leakage.

**The blocker: unbounded growth on dynamic input.** The intern registry is permanent and keyed by
`modifierId + classGroupId`. `modifierId` is built from **variant modifiers**, which can be arbitrary
user values: `data-[id=123]:flex`, `data-[id=124]:flex`, … each produces a distinct `modifierId`,
hence a distinct never-evicted registry entry and an ever-growing `Int32Array`. The architecture doc
claims growth is "bounded by distinct modifier and group pairs, not arbitrary values" — that holds
for cnfast's static JSX domain, but it is **false for dynamically generated arbitrary variants**,
which `tailwind-merge` must tolerate. This violates cnfast's own rule ("do not let caches grow
unbounded on arbitrary class values") in the one domain where upstream can't ignore it.

**To make it landable, one of:**
- Bound the registry (e.g. cap distinct IDs; on overflow, fall back to the string-keyed path for new
  keys), or
- Drop interning and keep the descriptor cache (#5) with string keys + the existing `string[]` /
  `Set` tracker — most of the win from #5, none of #6's risk, or
- Tie registry lifetime to the descriptor LRU generation rotation so it can't outlive evicted tokens.

Until one of those is in place, #6 should **not** be proposed upstream.

---

## Out of scope for tailwind-merge (keep in cnfast)

- **clsx fusion** (object/array/dictionary resolution): `twMerge` deliberately takes only
  strings/`twJoin` values. Not its job.
- **Tagged-template cache** (`src/lib/merge-template.ts`): a `cn` ergonomics feature, not a merge
  concern.
- **V8 arg-sequence cache + `IS_V8` engine sniffing** (`src/index.ts`): keys on stable arg-string
  identity and detects V8 via `Error` properties. Engine sniffing is routinely rejected upstream, and
  the `cn(...args)` semantics differ from `twMerge`. Keep it as cnfast's moat.
- **Already upstream:** two-generation object LRU and the empty/single-modifier sort fast path exist
  in 3.6.0 — do not re-pitch.

## Recommended landing order

1. **#1 single-token fast path** — trivial, universally correct, builds trust.
2. **#3 `charCodeAt` parse** — only if a benchmark justifies the readability cost.
3. **Maintainer question on #4** — "drop Unicode-whitespace separators?" Gate #2 and the splitter
   win on the answer.
4. **#5 descriptor cache (string-keyed)** — the headline win, framed as a size/perf tradeoff with an
   optional config knob.
5. **#6 only if bounded** — propose the integer tracker as a follow-up *after* solving the registry
   growth, or drop it.

## Validation checklist (per PR, against upstream's repo)

- [ ] Ported test suite green.
- [ ] Differential fuzz vs current `twMerge` green, **with Unicode-whitespace and arbitrary-variant
      inputs added** to the corpus.
- [ ] Custom-config coverage: `prefix`, `experimentalParseClassName`, `extendTailwindMerge`, and ≥2
      concurrent instances.
- [ ] Growth test: 100k unique `data-[id=N]:` variants must not grow memory without bound (catches
      #6).
- [ ] Benchmark delta reported best-of-N **against upstream's own bench harness**, not cnfast's.
- [ ] Bundle-size delta reported (gzipped), since it gates maintainer acceptance.

## Open questions for the maintainer

1. Is dropping Unicode-whitespace separators (#4) acceptable for `twMerge`?
2. Is a second (descriptor) cache acceptable for the perf gain, and should it be configurable /
   disablable?
3. Appetite for a per-token integer-interning layer at all, given the bounding requirement (#6)?
