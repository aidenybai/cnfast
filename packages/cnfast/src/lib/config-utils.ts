import { createClassGroupUtils } from "./class-group-utils";
import { IMPORTANT_MODIFIER, parseClassName } from "./parse-class-name";
import { createSortModifiers } from "./sort-modifiers";
import { AnyClassGroupIds, AnyConfig } from "./types";

export type ConfigUtils = ReturnType<typeof createConfigUtils>;

/**
 * Precomputed, cacheable result of analysing a single class name. Because parsing,
 * class-group lookup and conflict resolution are deterministic per class string, we
 * memoize this descriptor per unique token and amortize the work across every call
 * that reuses the token (tailwind-merge only caches whole class strings).
 */
export interface ClassDescriptor {
  /**
   * Interned integer ID of this class's conflict key `{modifierId}{classGroupId}`, or -1 for an
   * external (non-Tailwind) class. Encoding "external" in the id keeps the descriptor all-int32,
   * so the merge loop branches on one loaded value instead of a separate boolean field.
   */
  classId: number;
  /**
   * Half-open `[conflictStart, conflictEnd)` range into the shared `conflictPool` holding the
   * interned IDs of the conflict keys `{modifierId}{conflictGroupId}` this class overrides.
   * Structure-of-arrays: the claim loop walks contiguous int32 memory instead of chasing a
   * per-descriptor `number[]`, and descriptors themselves allocate no array.
   */
  conflictStart: number;
  conflictEnd: number;
}

const EXTERNAL_DESCRIPTOR: ClassDescriptor = { classId: -1, conflictStart: 0, conflictEnd: 0 };

/**
 * Per-token descriptor cache capacity (entries). Larger than the whole-string LRU because
 * individual tokens are far more numerous but cheap to store; the LRU bound prevents
 * unbounded growth when callers pass dynamically generated arbitrary values (e.g. `w-[123px]`).
 */
const DESCRIPTOR_CACHE_SIZE = 4096;

/**
 * Upper bound on distinct interned conflict keys before the registry (and the descriptor caches that
 * reference its IDs) are reset. A conflict key's `modifierId` can be an arbitrary variant such as
 * `data-[id=123]:`, so an app generating unbounded distinct variants would otherwise grow the
 * registry forever. Sized well above the distinct `(modifier, group)` pairs a real app produces, so
 * the reset never fires in normal use and only caps pathological, dynamically generated variants.
 */
const MAX_CONFLICT_KEYS = 16384;

export const createConfigUtils = (config: AnyConfig) => {
  const sortModifiers = createSortModifiers(config);
  const postfixLookupClassGroupIds = createPostfixLookupClassGroupIds(config);
  const {
    getClassGroupId,
    getConflictingClassGroupIds,
    groupIndexes,
    groupCount,
    groupNames,
    conflictRowsBase,
    conflictRowsPostfix,
  } = createClassGroupUtils(config);

  // Descriptor cache is the hottest lookup in the engine (once per token in `mergeClassList`).
  // It inlines a two-generation null-prototype LRU directly here (no get/set abstraction) so the
  // merge loop avoids an extra method-call hop per token.
  let descriptorCache: Record<string, ClassDescriptor> = Object.create(null);
  let previousDescriptorCache: Record<string, ClassDescriptor> = Object.create(null);
  let descriptorCacheSize = 0;

  // `mergeClassList` compares interned integer IDs instead of hashing conflict-key strings on
  // every token. `internConflictKey` assigns each `{modifierId}{classGroupId}` pair a dense
  // integer and holds it until the registry is reset. Most apps reuse a small, fixed set of pairs,
  // so a key keeps its ID for the session. But `modifierId` can be an arbitrary variant
  // (`data-[id=123]:`), so dynamically generated variants WOULD grow the registry without bound;
  // `mergeClassList` caps that by resetting the registry (and the descriptor caches that hold its
  // IDs) once `nextConflictKeyId` passes `MAX_CONFLICT_KEYS`, keeping memory bounded.
  //
  // Claimed keys are tracked by stamping a reusable `Int32Array` (indexed by conflict-key ID)
  // with a per-merge generation counter, instead of allocating a fresh `Set<number>` per call:
  // starting a pass is one integer bump, with no allocation and no per-element reset. The array
  // is grown when a new ID is interned, so the merge loop's index ops need no bounds checks.
  let claimedGeneration = new Int32Array(256);
  let currentGeneration = 0;

  // Reused "keep this token" flag buffer, indexed by token position, so the merge loop needs no
  // per-call `kept` array. Grown on demand for unusually long class lists; every slot up to the
  // token count is overwritten each pass, so no reset is needed.
  let keepFlags = new Uint8Array(64);

  // Canonical (interned) token strings for the current merge, indexed by token position. Filled
  // during pass 1 so the rebuild can concatenate already-allocated strings instead of slicing
  // fresh ones out of the input. Presized so the first real class lists don't pay elements-store
  // growth while the function is still in unoptimized tiers; the trailing `length = 0` keeps
  // packed-elements kind (no holes) while V8 retains the backing-store capacity.
  const classNames: string[] = new Array(64).fill("");
  classNames.length = 0;

  // Per-token boundaries and FNV-1a hashes recorded by the fused scan in `mergeClassList`, indexed
  // by token position. Offsets let the single-token fast path and true intern misses slice lazily
  // (most tokens never get sliced at all), and the hash feeds the intern-table probe below. Grown
  // in lockstep on demand; every slot up to the token count is overwritten each pass.
  let tokenStarts = new Int32Array(64);
  let tokenEnds = new Int32Array(64);
  let tokenHashes = new Int32Array(64);

  // Token intern table: the profiled #1 corpus cost is NOT descriptor compute, it is V8 re-hashing
  // a fresh `classList.slice(...)` for every `descriptorCache[token]` dictionary probe, every
  // merge. This open-addressed table is probed with a hash we already computed during the split
  // scan and verified by charCodeAt compare against the input range, so the hot path allocates no
  // slice and hashes no string. Parallel arrays (key string + int32 descriptor lanes) keep loads
  // monomorphic.
  //
  // Capacity is adaptive: the table starts small (apps with a modest class vocabulary never pay
  // for more) and doubles — rehashing in place, a rare one-off — until `TT_MAX_SIZE`, chosen so
  // the largest real app corpora measured (~12k unique tokens) fit without eviction churn. Only
  // at max size does it switch to two-generation eviction like the other caches: the full
  // generation becomes the (still probed) previous generation and hits there are re-promoted,
  // instead of discarding the whole working set at once. Linear probing always terminates because
  // load factor never exceeds 0.5: the grow/swap runs on the very insert that crosses the
  // half-full threshold, even mid-merge.
  const TT_INITIAL_SIZE = 2048;
  const TT_MAX_SIZE = 16384;
  let ttSize = TT_INITIAL_SIZE;
  let ttMask = ttSize - 1;
  // The previous generation keeps its own mask: during the growth phase it can be smaller than
  // the current table.
  let ttPreviousMask = ttMask;
  let ttKeys: (string | null)[] = new Array(TT_INITIAL_SIZE).fill(null);
  let ttPreviousKeys: (string | null)[] = new Array(TT_INITIAL_SIZE).fill(null);
  // Structure-of-arrays descriptor data per intern slot (classId, conflict-pool range) so the
  // claim loop reads plain int32 lanes instead of descriptor objects. Slots are only read after a
  // key match, and every key insert writes all three lanes, so the int arrays never need clearing
  // — flushing/recycling the key array alone invalidates them.
  let ttClassIds = new Int32Array(TT_INITIAL_SIZE);
  let ttConflictStarts = new Int32Array(TT_INITIAL_SIZE);
  let ttConflictEnds = new Int32Array(TT_INITIAL_SIZE);
  let ttPreviousClassIds = new Int32Array(TT_INITIAL_SIZE);
  let ttPreviousConflictStarts = new Int32Array(TT_INITIAL_SIZE);
  let ttPreviousConflictEnds = new Int32Array(TT_INITIAL_SIZE);
  let ttCount = 0;

  // FNV-1a over a materialized key string; must match the fused scan's incremental hash exactly.
  // Only used on the rare rehash/promote paths, never per merge.
  const fnvHashOf = (key: string): number => {
    let hash = -2128831035;
    for (let index = 0; index < key.length; index++) {
      hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
    }
    return hash;
  };

  // Doubles the current generation in place, re-slotting every live entry under the wider mask.
  // The previous generation is left untouched (it keeps `ttPreviousMask`).
  const growInternTable = (): void => {
    const oldKeys = ttKeys;
    const oldClassIds = ttClassIds;
    const oldConflictStarts = ttConflictStarts;
    const oldConflictEnds = ttConflictEnds;
    const oldSize = ttSize;
    ttSize = oldSize * 2;
    ttMask = ttSize - 1;
    ttKeys = new Array(ttSize).fill(null);
    ttClassIds = new Int32Array(ttSize);
    ttConflictStarts = new Int32Array(ttSize);
    ttConflictEnds = new Int32Array(ttSize);
    for (let index = 0; index < oldSize; index++) {
      const key = oldKeys[index];
      if (key === null) continue;
      let slot = fnvHashOf(key) & ttMask;
      while (ttKeys[slot] !== null) slot = (slot + 1) & ttMask;
      ttKeys[slot] = key;
      ttClassIds[slot] = oldClassIds[index]!;
      ttConflictStarts[slot] = oldConflictStarts[index]!;
      ttConflictEnds[slot] = oldConflictEnds[index]!;
    }
  };

  // Registry-reset path only (pathological dynamic workloads): shrink back to the initial
  // footprint rather than holding max-size arrays forever.
  const flushInternTable = (): void => {
    ttSize = TT_INITIAL_SIZE;
    ttMask = ttSize - 1;
    ttPreviousMask = ttMask;
    ttKeys = new Array(TT_INITIAL_SIZE).fill(null);
    ttPreviousKeys = new Array(TT_INITIAL_SIZE).fill(null);
    ttClassIds = new Int32Array(TT_INITIAL_SIZE);
    ttConflictStarts = new Int32Array(TT_INITIAL_SIZE);
    ttConflictEnds = new Int32Array(TT_INITIAL_SIZE);
    ttPreviousClassIds = new Int32Array(TT_INITIAL_SIZE);
    ttPreviousConflictStarts = new Int32Array(TT_INITIAL_SIZE);
    ttPreviousConflictEnds = new Int32Array(TT_INITIAL_SIZE);
    ttCount = 0;
  };

  // Set by the fused scan when a run of whitespace contains a non-space character (tab/LF/etc).
  // The no-op shortcut in `mergeClassList` can only return the raw input when every separator is a
  // plain space, since the rebuild always joins with `" "`.
  let splitSawNonSpaceWhitespace = false;

  // Fused split + hash scan: one charCodeAt pass over the class list that records token boundaries
  // and computes each token's FNV-1a hash inline, without allocating a slice per token. Splits on
  // runs of ASCII whitespace (space, tab, LF, VT, FF, CR) the same way `/\s+/` does for any
  // realistic class string, while skipping leading/trailing runs so no separate `trim()` pass (and
  // its string allocation) is needed. Tailwind class tokens are ASCII, so this never diverges from
  // the reference on real input; the parity + fuzz suites guard against regressions.
  let splitTokenCharCount = 0;
  const splitClassList = (classList: string): number => {
    const length = classList.length;
    let tokenStart = -1;
    let tokenCount = 0;
    let hash = 0;
    let tokenCharCount = 0;
    splitSawNonSpaceWhitespace = false;

    // `index === length` acts as a virtual trailing space so the final token flushes through the
    // same code path as the others.
    for (let index = 0; index <= length; index++) {
      const charCode = index < length ? classList.charCodeAt(index) : 32;

      if (charCode === 32 || (charCode >= 9 && charCode <= 13)) {
        if (charCode !== 32) splitSawNonSpaceWhitespace = true;
        if (tokenStart !== -1) {
          if (tokenCount === tokenStarts.length) {
            const capacity = tokenCount * 2;
            const grownStarts = new Int32Array(capacity);
            grownStarts.set(tokenStarts);
            tokenStarts = grownStarts;
            const grownEnds = new Int32Array(capacity);
            grownEnds.set(tokenEnds);
            tokenEnds = grownEnds;
            const grownHashes = new Int32Array(capacity);
            grownHashes.set(tokenHashes);
            tokenHashes = grownHashes;
          }
          tokenStarts[tokenCount] = tokenStart;
          tokenEnds[tokenCount] = index;
          tokenHashes[tokenCount] = hash;
          tokenCount++;
          tokenCharCount += index - tokenStart;
          tokenStart = -1;
        }
      } else {
        if (tokenStart === -1) {
          tokenStart = index;
          // FNV-1a offset basis (0x811c9dc5 as a signed int32).
          hash = -2128831035;
        }
        hash = Math.imul(hash ^ charCode, 16777619);
      }
    }

    splitTokenCharCount = tokenCharCount;
    return tokenCount;
  };

  // The conflict-key registry stays keyed by the exact concatenated `modifierId + classGroupId`
  // string. That is load-bearing for parity: tailwind-merge compares these concat strings, so two
  // DIFFERENT (modifier, group) pairs whose concats collide (e.g. `overflow-auto` vs
  // `overflo:w-4`, both "overflow") must resolve to the SAME id, and any injective numeric
  // (modifier, group) key would split them. The string hashing cost is instead bypassed by
  // `packedKeyIdMemo` below: static groups memoize `modifierIdx * groupCount + groupIdx -> id` in
  // a number-keyed Map, so the concat + string hash runs once per distinct pair and every later
  // descriptor compute is a smi-keyed lookup. `modifierIndexes` grows with distinct variant
  // strings (unbounded via arbitrary variants) and is cleared, along with the memo, on the same
  // registry reset that flushes every descriptor holding the derived IDs.
  const conflictKeyIds = new Map<string, number>();
  const modifierIndexes = new Map<string, number>();
  const packedKeyIdMemo = new Map<number, number>();
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
  const internModifier = (modifierId: string): number => {
    let index = modifierIndexes.get(modifierId);
    if (index === undefined) {
      index = modifierIndexes.size;
      modifierIndexes.set(modifierId, index);
    }
    return index;
  };

  // Shared conflict-ID pool backing every descriptor's `[conflictStart, conflictEnd)` range. Rows
  // are deduplicated per `(modifier, group, hasPostfixModifier)` triple via `conflictRowRefMemo`
  // (packed smi keys again), so pool size is bounded by distinct interned pairs — it survives
  // descriptor-cache and intern-table evictions and only resets with the conflict-key registry
  // itself, which flushes every descriptor holding ranges into it.
  let conflictPool = new Int32Array(1024);
  let conflictPoolCount = 0;
  const conflictRowRefMemo = new Map<number, number>();

  // Shared descriptor-building tail for both compute paths below: resolves the (modifier, group,
  // postfix) triple into an interned classId and a deduplicated conflict-pool range.
  const buildDescriptor = (
    classGroupId: AnyClassGroupIds,
    modifierId: string,
    hasPostfixModifier: boolean,
  ): ClassDescriptor => {
    const groupIndex = groupIndexes.get(classGroupId);
    if (groupIndex === undefined) {
      // Dynamic arbitrary-property group: not part of the config's enumerated groups and never
      // has conflict rows, so its conflict key stays on the direct string path. It still shares
      // `conflictKeyIds`, so a concat collision with a static pair's key unifies exactly as the
      // reference's string comparison would.
      return {
        classId: internConflictKey(modifierId + classGroupId),
        conflictStart: 0,
        conflictEnd: 0,
      };
    }

    // Static groups: the conflict row is a dense array-index load instead of the megamorphic
    // string-keyed `conflictingClassGroups[id]` read, and each `(modifier, group)` pair's interned
    // id is memoized under a packed smi key so the concat + string hash happens once per distinct
    // pair, not once per descriptor compute.
    const packedModifierBase = internModifier(modifierId) * groupCount;

    let classId = packedKeyIdMemo.get(packedModifierBase + groupIndex);
    if (classId === undefined) {
      classId = internConflictKey(modifierId + classGroupId);
      packedKeyIdMemo.set(packedModifierBase + groupIndex, classId);
    }

    const conflictRow = hasPostfixModifier
      ? conflictRowsPostfix[groupIndex]!
      : conflictRowsBase[groupIndex]!;
    const rowLength = conflictRow.length;
    if (rowLength === 0) {
      return { classId, conflictStart: 0, conflictEnd: 0 };
    }

    // The postfix bit is part of the row key because the same (modifier, group) pair resolves to
    // different conflict rows with and without a postfix modifier (e.g. `text-lg` vs `text-lg/7`).
    const rowKey = (packedModifierBase + groupIndex) * 2 + (hasPostfixModifier ? 1 : 0);
    let conflictStart = conflictRowRefMemo.get(rowKey);
    if (conflictStart === undefined) {
      if (conflictPoolCount + rowLength > conflictPool.length) {
        let capacity = conflictPool.length * 2;
        while (capacity < conflictPoolCount + rowLength) capacity *= 2;
        const grown = new Int32Array(capacity);
        grown.set(conflictPool);
        conflictPool = grown;
      }
      conflictStart = conflictPoolCount;
      for (let index = 0; index < rowLength; index++) {
        const conflictGroupIndex = conflictRow[index]!;
        let conflictId = packedKeyIdMemo.get(packedModifierBase + conflictGroupIndex);
        if (conflictId === undefined) {
          conflictId = internConflictKey(modifierId + groupNames[conflictGroupIndex]!);
          packedKeyIdMemo.set(packedModifierBase + conflictGroupIndex, conflictId);
        }
        conflictPool[conflictStart + index] = conflictId;
      }
      conflictPoolCount = conflictStart + rowLength;
      conflictRowRefMemo.set(rowKey, conflictStart);
    }

    return { classId, conflictStart, conflictEnd: conflictStart + rowLength };
  };

  const computeClassDescriptor = (originalClassName: string): ClassDescriptor => {
    // Plain-token fast path: a token containing none of `:` `/` `[` `(` `!` can't have variant
    // modifiers, a postfix modifier, an important marker, or an arbitrary value, so parseClassName
    // would only confirm { modifiers: [], base: token } at the cost of an array + object
    // allocation. ~90% of real-world tokens are plain, and full-miss compute is the dominant
    // fully-dynamic/cold-start cost, so they go straight to the group lookup. `]`/`)` without
    // their openers don't affect parseClassName's output when these five chars are absent, and
    // with an empty modifier the conflict keys are the raw group-id strings (`"" + id`), matching
    // what the general path below interns.
    const plainScanLength = originalClassName.length;
    let isPlain = true;
    for (let index = 0; index < plainScanLength; index++) {
      const charCode = originalClassName.charCodeAt(index);
      if (
        charCode === 58 /* ":" */ ||
        charCode === 47 /* "/" */ ||
        charCode === 91 /* "[" */ ||
        charCode === 40 /* "(" */ ||
        charCode === 33 /* "!" */
      ) {
        isPlain = false;
        break;
      }
    }

    if (isPlain) {
      const plainClassGroupId = getClassGroupId(originalClassName);
      if (!plainClassGroupId) {
        return EXTERNAL_DESCRIPTOR;
      }
      return buildDescriptor(plainClassGroupId, "", false);
    }

    const {
      isExternal,
      modifiers,
      hasImportantModifier,
      baseClassName,
      maybePostfixModifierPosition,
    } = parseClassName(originalClassName);

    if (isExternal) {
      return EXTERNAL_DESCRIPTOR;
    }

    let hasPostfixModifier = Boolean(maybePostfixModifierPosition);
    let classGroupId: ReturnType<typeof getClassGroupId>;

    if (hasPostfixModifier) {
      const baseClassNameWithoutPostfix = baseClassName.substring(0, maybePostfixModifierPosition);
      classGroupId = getClassGroupId(baseClassNameWithoutPostfix);

      const classGroupIdWithPostfix =
        classGroupId && postfixLookupClassGroupIds[classGroupId]
          ? getClassGroupId(baseClassName)
          : undefined;
      if (classGroupIdWithPostfix && classGroupIdWithPostfix !== classGroupId) {
        classGroupId = classGroupIdWithPostfix;
        hasPostfixModifier = false;
      }
    } else {
      classGroupId = getClassGroupId(baseClassName);
    }

    if (!classGroupId) {
      if (!hasPostfixModifier) {
        return EXTERNAL_DESCRIPTOR;
      }

      classGroupId = getClassGroupId(baseClassName);

      if (!classGroupId) {
        return EXTERNAL_DESCRIPTOR;
      }

      hasPostfixModifier = false;
    }

    const variantModifier =
      modifiers.length === 0
        ? ""
        : modifiers.length === 1
          ? modifiers[0]!
          : sortModifiers(modifiers).join(":");

    const modifierId = hasImportantModifier
      ? variantModifier + IMPORTANT_MODIFIER
      : variantModifier;

    return buildDescriptor(classGroupId, modifierId, hasPostfixModifier);
  };

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

  // Resolves conflicts in a joined class string, keeping the last (rightmost) class per group.
  // Lives inside this closure so the conflict tracker is touched as direct `Int32Array` index ops
  // (no `claim`/`check`/`begin` closure calls per token). `claimedGeneration` is read fresh on
  // every access, so a mid-loop `getClassDescriptor` miss that grows the array stays correct.
  const mergeClassList = (classList: string): string => {
    const classCount = splitClassList(classList);

    // A single token cannot conflict with itself, so it is always kept verbatim. ~60% of real class
    // lists reduce to one token, and this skips descriptor resolution (including a full compute on a
    // cache miss), conflict tracking, and the rebuild for all of them. When the token spans the whole
    // input (the common case: `cn`'s clsx step emits normalized strings) the input itself is
    // returned without even a slice.
    if (classCount === 1) {
      const start = tokenStarts[0]!;
      const end = tokenEnds[0]!;
      return start === 0 && end === classList.length ? classList : classList.slice(start, end);
    }

    if (classCount === 0) {
      return "";
    }

    // Keep the conflict-key registry bounded. It never evicts on its own, and arbitrary variants can
    // make distinct keys unbounded, so reset it once it passes `MAX_CONFLICT_KEYS`. The reset runs
    // here (between merges, never mid-pass) so interned IDs stay consistent within a single pass, and
    // the descriptor caches AND the token intern table are flushed alongside it because their
    // descriptors hold these IDs. The monotonic generation counter means reused IDs never read a
    // stale claim from a prior merge.
    if (nextConflictKeyId > MAX_CONFLICT_KEYS) {
      conflictKeyIds.clear();
      modifierIndexes.clear();
      packedKeyIdMemo.clear();
      conflictRowRefMemo.clear();
      conflictPoolCount = 0;
      nextConflictKeyId = 0;
      descriptorCache = Object.create(null);
      previousDescriptorCache = Object.create(null);
      descriptorCacheSize = 0;
      flushInternTable();
    }

    currentGeneration = (currentGeneration + 1) | 0;
    // Generation 0 is the array's initialized value; skip it so a fresh pass never reads stale
    // zero-stamps as "claimed" after the int32 counter wraps.
    if (currentGeneration === 0) currentGeneration = 1;
    const generation = currentGeneration;

    if (classCount > keepFlags.length) {
      let capacity = keepFlags.length;
      while (capacity < classCount) capacity *= 2;
      keepFlags = new Uint8Array(capacity);
    }

    // Pass 1, right-to-left: the rightmost class per conflict group wins, so a token is kept unless
    // a later class already claimed one of its conflict keys. Decisions land in `keepFlags`.
    //
    // Descriptor resolution goes through the token intern table, probed with the hash the split
    // scan already computed and verified by charCodeAt compare against the input range — no slice
    // and no V8 string-hash on a hit. Only a token absent from BOTH generations is sliced and sent
    // through `getClassDescriptor`. The probe is inlined here (not a helper) because a hit must
    // yield two values, the canonical string and its descriptor, without a temporary.
    let didDrop = false;
    for (let index = classCount - 1; index >= 0; index -= 1) {
      const start = tokenStarts[index]!;
      const end = tokenEnds[index]!;
      const tokenLength = end - start;
      const hash = tokenHashes[index]!;

      let slot = hash & ttMask;
      let key: string | null;
      while ((key = ttKeys[slot]!) !== null) {
        if (key.length === tokenLength) {
          let offset = 0;
          while (offset < tokenLength && key.charCodeAt(offset) === classList.charCodeAt(start + offset)) {
            offset++;
          }
          if (offset === tokenLength) break;
        }
        slot = (slot + 1) & ttMask;
      }

      let classId: number;
      let conflictStart: number;
      let conflictEnd: number;
      if (key !== null) {
        classId = ttClassIds[slot]!;
        conflictStart = ttConflictStarts[slot]!;
        conflictEnd = ttConflictEnds[slot]!;
      } else {
        // Miss in the current generation: check the previous one before paying for a slice +
        // dictionary probe/compute, and re-promote a hit so live tokens survive eviction.
        let previousSlot = hash & ttPreviousMask;
        let previousKey: string | null;
        while ((previousKey = ttPreviousKeys[previousSlot]!) !== null) {
          if (previousKey.length === tokenLength) {
            let offset = 0;
            while (
              offset < tokenLength &&
              previousKey.charCodeAt(offset) === classList.charCodeAt(start + offset)
            ) {
              offset++;
            }
            if (offset === tokenLength) break;
          }
          previousSlot = (previousSlot + 1) & ttPreviousMask;
        }

        if (previousKey !== null) {
          key = previousKey;
          classId = ttPreviousClassIds[previousSlot]!;
          conflictStart = ttPreviousConflictStarts[previousSlot]!;
          conflictEnd = ttPreviousConflictEnds[previousSlot]!;
        } else {
          key = classList.slice(start, end);
          const descriptor = getClassDescriptor(key);
          classId = descriptor.classId;
          conflictStart = descriptor.conflictStart;
          conflictEnd = descriptor.conflictEnd;
        }

        // `slot` is the first empty slot the current-generation probe stopped at, so inserting
        // there keeps the probe chain intact.
        ttKeys[slot] = key;
        ttClassIds[slot] = classId;
        ttConflictStarts[slot] = conflictStart;
        ttConflictEnds[slot] = conflictEnd;
        if (++ttCount > (ttSize >> 1)) {
          if (ttSize < TT_MAX_SIZE) {
            // Below max capacity, grow instead of evicting: nothing is discarded and the app's
            // live vocabulary keeps interning at full speed.
            growInternTable();
          } else {
            // Generation swap: the filled table becomes the (still probed) previous generation
            // and the old previous generation's arrays are recycled as the new current one when
            // sizes match (they can lag behind during the growth phase). Running this on the
            // crossing insert — even mid-merge — is what bounds the load factor; tokens already
            // resolved this pass hold direct references, so the swap cannot invalidate them.
            // Only the key array needs clearing: the int lanes are never read before a key match.
            const recycledKeys = ttPreviousKeys;
            const recycledClassIds = ttPreviousClassIds;
            const recycledConflictStarts = ttPreviousConflictStarts;
            const recycledConflictEnds = ttPreviousConflictEnds;
            ttPreviousKeys = ttKeys;
            ttPreviousClassIds = ttClassIds;
            ttPreviousConflictStarts = ttConflictStarts;
            ttPreviousConflictEnds = ttConflictEnds;
            ttPreviousMask = ttMask;
            if (recycledKeys.length === ttSize) {
              recycledKeys.fill(null);
              ttKeys = recycledKeys;
              ttClassIds = recycledClassIds;
              ttConflictStarts = recycledConflictStarts;
              ttConflictEnds = recycledConflictEnds;
            } else {
              ttKeys = new Array(ttSize).fill(null);
              ttClassIds = new Int32Array(ttSize);
              ttConflictStarts = new Int32Array(ttSize);
              ttConflictEnds = new Int32Array(ttSize);
            }
            ttCount = 0;
          }
        }
      }

      classNames[index] = key;

      if (classId === -1) {
        keepFlags[index] = 1;
        continue;
      }

      if (claimedGeneration[classId] === generation) {
        keepFlags[index] = 0;
        didDrop = true;
        continue;
      }

      claimedGeneration[classId] = generation;
      for (let poolIndex = conflictStart; poolIndex < conflictEnd; poolIndex++) {
        claimedGeneration[conflictPool[poolIndex]!] = generation;
      }

      keepFlags[index] = 1;
    }

    // No-op shortcut: when nothing was dropped and the input is already space-normalized, the
    // rebuild would just recreate `classList`, so return it directly and skip the rebuild
    // allocation. The length equality holds iff whitespace is exactly `classCount - 1` separators
    // (no leading, trailing, or doubled runs); combined with "no non-space whitespace" that means
    // the input is byte-identical to `tokens.join(" ")`. `cn`'s clsx step always feeds such strings.
    if (
      !didDrop &&
      !splitSawNonSpaceWhitespace &&
      classList.length === splitTokenCharCount + classCount - 1
    ) {
      return classList;
    }

    // Pass 2, left-to-right: emit kept tokens in source order (no reversal needed).
    let result = "";

    if (!splitSawNonSpaceWhitespace) {
      // Contiguous kept runs are emitted as single `classList.slice(...)` calls instead of
      // per-token `" " +` concats: adjacent kept tokens whose offsets satisfy
      // `nextStart === previousEnd + 1` are separated by exactly one character, and with no
      // non-space whitespace anywhere that character must be a plain space — so the input bytes
      // for the whole run are already the joined output. Drop-heavy merges typically keep a few
      // long runs, so this allocates one flat slice per run (cheaper for the whole-string cache
      // to hash downstream) instead of a cons-string chain per token.
      let runStartOffset = -1;
      let runEndOffset = 0;
      for (let index = 0; index < classCount; index++) {
        if (keepFlags[index] === 1) {
          const start = tokenStarts[index]!;
          if (runStartOffset === -1) {
            runStartOffset = start;
          } else if (start !== runEndOffset + 1) {
            if (result) result += " ";
            result += classList.slice(runStartOffset, runEndOffset);
            runStartOffset = start;
          }
          runEndOffset = tokenEnds[index]!;
        }
      }
      if (runStartOffset !== -1) {
        if (result) result += " ";
        result += classList.slice(runStartOffset, runEndOffset);
      }
      return result;
    }

    // Fallback for inputs with tabs/newlines/etc between tokens: rebuild from the canonical
    // per-token strings interned in pass 1.
    for (let index = 0; index < classCount; index++) {
      if (keepFlags[index] === 1) {
        if (result) result += " ";
        result += classNames[index];
      }
    }

    return result;
  };

  return {
    parseClassName,
    sortModifiers,
    postfixLookupClassGroupIds,
    getClassGroupId,
    getConflictingClassGroupIds,
    getClassDescriptor,
    mergeClassList,
  };
};

const createPostfixLookupClassGroupIds = (config: AnyConfig) => {
  const lookup: Partial<Record<AnyClassGroupIds, true>> = Object.create(null);
  const classGroupIds = config.postfixLookupClassGroups;

  if (classGroupIds) {
    for (let index = 0; index < classGroupIds.length; index++) {
      lookup[classGroupIds[index]!] = true;
    }
  }

  return lookup;
};
