import { createClassGroupUtils } from "./class-group-utils";
import {
  DESCRIPTOR_CACHE_CAPACITY,
  INTERN_TABLE_INITIAL_SLOTS,
  INTERN_TABLE_MAX_SLOTS,
  MAX_CONFLICT_KEYS,
} from "./constants";
import { IMPORTANT_MODIFIER, parseClassName } from "./parse-class-name";
import { createSortModifiers } from "./sort-modifiers";
import { AnyClassGroupIds, AnyConfig } from "./types";

export type ConfigUtils = ReturnType<typeof createConfigUtils>;

/**
 * Memoized analysis of one class name. All-int32 so the merge loop branches on loaded integers
 * (classId -1 encodes "external, keep verbatim") and walks conflict IDs as a contiguous
 * `[conflictStart, conflictEnd)` range of the shared `conflictPool` instead of chasing a
 * per-descriptor array.
 */
export interface ClassDescriptor {
  classId: number;
  conflictStart: number;
  conflictEnd: number;
}

const EXTERNAL_DESCRIPTOR: ClassDescriptor = { classId: -1, conflictStart: 0, conflictEnd: 0 };

const FNV_OFFSET_BASIS = -2128831035; // 0x811c9dc5 as signed int32
const FNV_PRIME = 16777619;

const CHAR_CODE_TAB = 9;
const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_SPACE = 32;

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

  let descriptorCache: Record<string, ClassDescriptor> = Object.create(null);
  let previousDescriptorCache: Record<string, ClassDescriptor> = Object.create(null);
  let descriptorCacheSize = 0;

  // Claimed conflict keys are generation stamps in an Int32Array indexed by interned key ID:
  // starting a merge is one counter bump, with no allocation and no per-element reset.
  let claimedGeneration = new Int32Array(256);
  let currentGeneration = 0;

  // Per-merge scratch, reused across calls and grown on demand. Every slot up to the token count
  // is overwritten each pass, so nothing needs clearing.
  let keepFlags = new Uint8Array(64);
  let tokenStarts = new Int32Array(64);
  let tokenEnds = new Int32Array(64);
  let tokenHashes = new Int32Array(64);
  const canonicalTokens: string[] = new Array(64).fill("");
  canonicalTokens.length = 0;

  /**
   * Token intern table.
   *
   * The profiled top cost of the miss path is not descriptor computation; it is the engine
   * re-hashing a fresh `classList.slice(...)` for every `descriptorCache[token]` probe, on every
   * merge, because a string's hash is cached on the object that first computed it and each slice
   * is a new object. This table is probed with the FNV-1a hash the split scan already computed
   * and verifies candidates by length + charCodeAt against the input range, so a hit allocates
   * no slice and hashes no string, and yields both the canonical token string and its
   * descriptor.
   *
   * Open-addressed with linear probing over parallel arrays: `internedTokens[slot]` holds the
   * canonical string; three Int32Array lanes hold that slot's descriptor. The int lanes are only
   * read after a token match and every insert writes all lanes, so clearing the token array
   * alone invalidates a generation.
   *
   * Capacity is adaptive: the table doubles in place (rare, one-off rehash) until
   * INTERN_TABLE_MAX_SLOTS, then switches to two-generation rotation with re-promotion of
   * previous-generation hits. Growth or rotation runs on the exact insert that crosses the
   * half-full threshold, even mid-merge, which caps load factor at 0.5 and guarantees the probe
   * loop terminates.
   */
  let internSlotCount = INTERN_TABLE_INITIAL_SLOTS;
  let internSlotMask = internSlotCount - 1;
  // The previous generation keeps its own mask: during the growth phase it can be smaller.
  let previousInternSlotMask = internSlotMask;
  let internedTokens: (string | null)[] = new Array(INTERN_TABLE_INITIAL_SLOTS).fill(null);
  let previousInternedTokens: (string | null)[] = new Array(INTERN_TABLE_INITIAL_SLOTS).fill(null);
  let internedClassIds = new Int32Array(INTERN_TABLE_INITIAL_SLOTS);
  let internedConflictStarts = new Int32Array(INTERN_TABLE_INITIAL_SLOTS);
  let internedConflictEnds = new Int32Array(INTERN_TABLE_INITIAL_SLOTS);
  let previousInternedClassIds = new Int32Array(INTERN_TABLE_INITIAL_SLOTS);
  let previousInternedConflictStarts = new Int32Array(INTERN_TABLE_INITIAL_SLOTS);
  let previousInternedConflictEnds = new Int32Array(INTERN_TABLE_INITIAL_SLOTS);
  let internedTokenCount = 0;

  // Must match the split scan's incremental hash exactly; only runs on rehash, never per merge.
  const hashToken = (token: string): number => {
    let hash = FNV_OFFSET_BASIS;
    for (let index = 0; index < token.length; index++) {
      hash = Math.imul(hash ^ token.charCodeAt(index), FNV_PRIME);
    }
    return hash;
  };

  const growInternTable = (): void => {
    const oldTokens = internedTokens;
    const oldClassIds = internedClassIds;
    const oldConflictStarts = internedConflictStarts;
    const oldConflictEnds = internedConflictEnds;
    const oldSlotCount = internSlotCount;
    internSlotCount = oldSlotCount * 2;
    internSlotMask = internSlotCount - 1;
    internedTokens = new Array(internSlotCount).fill(null);
    internedClassIds = new Int32Array(internSlotCount);
    internedConflictStarts = new Int32Array(internSlotCount);
    internedConflictEnds = new Int32Array(internSlotCount);
    for (let index = 0; index < oldSlotCount; index++) {
      const token = oldTokens[index];
      if (token === null) continue;
      let slot = hashToken(token) & internSlotMask;
      while (internedTokens[slot] !== null) slot = (slot + 1) & internSlotMask;
      internedTokens[slot] = token;
      internedClassIds[slot] = oldClassIds[index]!;
      internedConflictStarts[slot] = oldConflictStarts[index]!;
      internedConflictEnds[slot] = oldConflictEnds[index]!;
    }
  };

  // Registry-reset path only: shrink back to the initial footprint rather than holding max-size
  // arrays forever.
  const flushInternTable = (): void => {
    internSlotCount = INTERN_TABLE_INITIAL_SLOTS;
    internSlotMask = internSlotCount - 1;
    previousInternSlotMask = internSlotMask;
    internedTokens = new Array(INTERN_TABLE_INITIAL_SLOTS).fill(null);
    previousInternedTokens = new Array(INTERN_TABLE_INITIAL_SLOTS).fill(null);
    internedClassIds = new Int32Array(INTERN_TABLE_INITIAL_SLOTS);
    internedConflictStarts = new Int32Array(INTERN_TABLE_INITIAL_SLOTS);
    internedConflictEnds = new Int32Array(INTERN_TABLE_INITIAL_SLOTS);
    previousInternedClassIds = new Int32Array(INTERN_TABLE_INITIAL_SLOTS);
    previousInternedConflictStarts = new Int32Array(INTERN_TABLE_INITIAL_SLOTS);
    previousInternedConflictEnds = new Int32Array(INTERN_TABLE_INITIAL_SLOTS);
    internedTokenCount = 0;
  };

  // The rebuild joins with " ", so the no-op shortcut may only return the raw input when every
  // separator was a plain space.
  let splitSawNonSpaceWhitespace = false;
  let splitTotalTokenLength = 0;

  // Fused split + hash scan: one charCodeAt pass records each token's (start, end) offsets and
  // FNV-1a hash into the reused scratch arrays, with no slice per token. Splits on ASCII
  // whitespace runs exactly as /\s+/ would for realistic class strings; `index === length` acts
  // as a virtual trailing space so the final token flushes through the same path.
  const splitClassList = (classList: string): number => {
    const length = classList.length;
    let tokenStart = -1;
    let tokenCount = 0;
    let hash = 0;
    let totalTokenLength = 0;
    splitSawNonSpaceWhitespace = false;

    for (let index = 0; index <= length; index++) {
      const charCode = index < length ? classList.charCodeAt(index) : CHAR_CODE_SPACE;

      if (
        charCode === CHAR_CODE_SPACE ||
        (charCode >= CHAR_CODE_TAB && charCode <= CHAR_CODE_CARRIAGE_RETURN)
      ) {
        if (charCode !== CHAR_CODE_SPACE) splitSawNonSpaceWhitespace = true;
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
          totalTokenLength += index - tokenStart;
          tokenStart = -1;
        }
      } else {
        if (tokenStart === -1) {
          tokenStart = index;
          hash = FNV_OFFSET_BASIS;
        }
        hash = Math.imul(hash ^ charCode, FNV_PRIME);
      }
    }

    splitTotalTokenLength = totalTokenLength;
    return tokenCount;
  };

  // The registry stays keyed by the exact concatenated `{modifier}{classGroupId}` string. That is
  // load-bearing for parity: tailwind-merge compares these concat strings, so two DIFFERENT
  // (modifier, group) pairs whose concats collide must resolve to the SAME id — `overflow-auto`
  // (modifier "", group "overflow") and `overflo:w-4` (modifier "overflo", group "w") both key
  // "overflow" — and any injective numeric key would split them. The hashing cost is bypassed by
  // `packedKeyIdMemo` instead: static groups memoize `modifierIndex * groupCount + groupIndex`
  // to id in a number-keyed Map, so the concat + string hash runs once per distinct pair.
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

  const internModifier = (modifier: string): number => {
    let index = modifierIndexes.get(modifier);
    if (index === undefined) {
      index = modifierIndexes.size;
      modifierIndexes.set(modifier, index);
    }
    return index;
  };

  // Shared pool backing every descriptor's conflict-ID range, deduplicated per
  // (modifier, group, postfix) row. Survives descriptor-cache and intern-table evictions; only
  // resets with the conflict-key registry itself.
  let conflictPool = new Int32Array(1024);
  let conflictPoolCount = 0;
  const conflictRowRefMemo = new Map<number, number>();

  const buildDescriptor = (
    classGroupId: AnyClassGroupIds,
    modifier: string,
    hasPostfixModifier: boolean,
  ): ClassDescriptor => {
    const groupIndex = groupIndexes.get(classGroupId);
    if (groupIndex === undefined) {
      // Dynamic arbitrary-property group (`[color:red]`): not in the config's enumerated groups
      // and never has conflict rows. It still shares `conflictKeyIds`, so a concat collision
      // with a static pair's key unifies exactly as the reference's string comparison would.
      return {
        classId: internConflictKey(modifier + classGroupId),
        conflictStart: 0,
        conflictEnd: 0,
      };
    }

    const packedModifierBase = internModifier(modifier) * groupCount;

    let classId = packedKeyIdMemo.get(packedModifierBase + groupIndex);
    if (classId === undefined) {
      classId = internConflictKey(modifier + classGroupId);
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
    // different conflict rows with and without a postfix modifier (`text-lg` vs `text-lg/7`).
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
          conflictId = internConflictKey(modifier + groupNames[conflictGroupIndex]!);
          packedKeyIdMemo.set(packedModifierBase + conflictGroupIndex, conflictId);
        }
        conflictPool[conflictStart + index] = conflictId;
      }
      conflictPoolCount = conflictStart + rowLength;
      conflictRowRefMemo.set(rowKey, conflictStart);
    }

    return { classId, conflictStart, conflictEnd: conflictStart + rowLength };
  };

  const computeClassDescriptor = (className: string): ClassDescriptor => {
    // Plain-token fast path: a token containing none of `:` `/` `[` `(` `!` cannot have variant
    // modifiers, a postfix modifier, an important marker, or an arbitrary value, so parseClassName
    // would only confirm `{ modifiers: [], base: token }` at the cost of an array and an object.
    // ~90% of real-world tokens are plain. A stray `]` or `)` without its opener does not change
    // parseClassName's output when these five characters are absent, and with an empty modifier
    // the conflict keys are the raw group-id strings ("" + id), byte-identical to what the
    // general path interns.
    const classNameLength = className.length;
    let isPlain = true;
    for (let index = 0; index < classNameLength; index++) {
      const charCode = className.charCodeAt(index);
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
      const plainClassGroupId = getClassGroupId(className);
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
    } = parseClassName(className);

    if (isExternal) {
      return EXTERNAL_DESCRIPTOR;
    }

    let hasPostfixModifier = Boolean(maybePostfixModifierPosition);
    let classGroupId: ReturnType<typeof getClassGroupId>;

    if (hasPostfixModifier) {
      // A `/` can be a postfix modifier or part of the class itself (`text-lg/7` vs `w-1/2`);
      // groups listed in `postfixLookupClassGroups` retry with the full name to disambiguate.
      const baseWithoutPostfix = baseClassName.substring(0, maybePostfixModifierPosition);
      classGroupId = getClassGroupId(baseWithoutPostfix);

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

    const modifier = hasImportantModifier ? variantModifier + IMPORTANT_MODIFIER : variantModifier;

    return buildDescriptor(classGroupId, modifier, hasPostfixModifier);
  };

  const getClassDescriptor = (className: string): ClassDescriptor => {
    let descriptor = descriptorCache[className];
    if (descriptor !== undefined) {
      return descriptor;
    }

    descriptor = previousDescriptorCache[className];
    if (descriptor === undefined) {
      descriptor = computeClassDescriptor(className);
    }

    descriptorCache[className] = descriptor;
    if (++descriptorCacheSize > DESCRIPTOR_CACHE_CAPACITY) {
      descriptorCacheSize = 0;
      previousDescriptorCache = descriptorCache;
      descriptorCache = Object.create(null);
    }
    return descriptor;
  };

  /**
   * Resolve conflicts in a joined class string, keeping the last (rightmost) class per conflict
   * group. Byte-identical to tailwind-merge for every input.
   *
   * The merge runs in two passes over token offsets, with no per-token allocation on the warm
   * path:
   *
   * 1. Fused split. `splitClassList` records each token's (start, end, hash) into reused
   *    scratch arrays; tokens are not sliced out of the input.
   *
   * 2. Claim pass, right to left. The rightmost class per group wins, so walking backwards lets
   *    each token claim its own conflict key plus every key it overrides; an earlier token that
   *    finds its key already claimed is dropped:
   *
   *        input: "p-2 text-sm hover:p-3 p-4"
   *
   *        p-4        claims {p} + overrides {px, py, ps, pe, pt, pr, pb, pl}   keep
   *        hover:p-3  claims {hover:p} + {hover:px, ...} (per-modifier keys)    keep
   *        text-sm    claims {font-size} + {leading}                            keep
   *        p-2        {p} already claimed                                       drop
   *
   *    Claims are generation stamps in `claimedGeneration`, indexed by interned key ID. Each
   *    token's descriptor comes from the intern table (hash probe + charCodeAt verify, zero
   *    allocation on a hit); only a token absent from both generations is sliced and computed.
   *
   * 3. Rebuild, left to right. When nothing was dropped and the input was already
   *    space-normalized, the input itself is returned (the common case: `cn`'s join always
   *    produces normalized strings). Otherwise contiguous kept tokens separated by single
   *    spaces are emitted as one `classList.slice` per run:
   *
   *        input: "p-2 text-sm p-4"    keepFlags: [0, 1, 1]    result: slice("text-sm p-4")
   *
   *    A flat slice is also cheaper for the whole-string cache to hash downstream than a
   *    per-token cons-string chain.
   */
  const mergeClassList = (classList: string): string => {
    const classCount = splitClassList(classList);

    // A single token cannot conflict with itself; ~60% of real class lists are one token. When
    // the token spans the whole input, return the input without even a slice.
    if (classCount === 1) {
      const start = tokenStarts[0]!;
      const end = tokenEnds[0]!;
      return start === 0 && end === classList.length ? classList : classList.slice(start, end);
    }

    if (classCount === 0) {
      return "";
    }

    // The registry never evicts on its own and arbitrary variants can mint unbounded keys, so
    // reset it (and every structure holding its IDs) once it passes the cap — between merges,
    // never mid-pass, so IDs stay consistent within a pass.
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

    // Claim pass. The intern-table probe is inlined because a hit must yield two values — the
    // canonical string and its descriptor lanes — without a temporary.
    let didDrop = false;
    for (let index = classCount - 1; index >= 0; index -= 1) {
      const start = tokenStarts[index]!;
      const end = tokenEnds[index]!;
      const tokenLength = end - start;
      const tokenHash = tokenHashes[index]!;

      let slot = tokenHash & internSlotMask;
      let internedToken: string | null;
      while ((internedToken = internedTokens[slot]!) !== null) {
        if (internedToken.length === tokenLength) {
          let offset = 0;
          while (
            offset < tokenLength &&
            internedToken.charCodeAt(offset) === classList.charCodeAt(start + offset)
          ) {
            offset++;
          }
          if (offset === tokenLength) break;
        }
        slot = (slot + 1) & internSlotMask;
      }

      let classId: number;
      let conflictStart: number;
      let conflictEnd: number;
      if (internedToken !== null) {
        classId = internedClassIds[slot]!;
        conflictStart = internedConflictStarts[slot]!;
        conflictEnd = internedConflictEnds[slot]!;
      } else {
        // Probe the previous generation before paying for a slice + descriptor compute, and
        // re-promote a hit so live tokens survive rotation.
        let previousSlot = tokenHash & previousInternSlotMask;
        let previousToken: string | null;
        while ((previousToken = previousInternedTokens[previousSlot]!) !== null) {
          if (previousToken.length === tokenLength) {
            let offset = 0;
            while (
              offset < tokenLength &&
              previousToken.charCodeAt(offset) === classList.charCodeAt(start + offset)
            ) {
              offset++;
            }
            if (offset === tokenLength) break;
          }
          previousSlot = (previousSlot + 1) & previousInternSlotMask;
        }

        if (previousToken !== null) {
          internedToken = previousToken;
          classId = previousInternedClassIds[previousSlot]!;
          conflictStart = previousInternedConflictStarts[previousSlot]!;
          conflictEnd = previousInternedConflictEnds[previousSlot]!;
        } else {
          internedToken = classList.slice(start, end);
          const descriptor = getClassDescriptor(internedToken);
          classId = descriptor.classId;
          conflictStart = descriptor.conflictStart;
          conflictEnd = descriptor.conflictEnd;
        }

        // `slot` is the first empty slot the current-generation probe stopped at, so inserting
        // there keeps the probe chain intact.
        internedTokens[slot] = internedToken;
        internedClassIds[slot] = classId;
        internedConflictStarts[slot] = conflictStart;
        internedConflictEnds[slot] = conflictEnd;
        if (++internedTokenCount > internSlotCount >> 1) {
          if (internSlotCount < INTERN_TABLE_MAX_SLOTS) {
            growInternTable();
          } else {
            // Rotate generations. Tokens already resolved this pass hold direct references, so
            // the swap cannot invalidate them; the retired arrays are recycled when their size
            // still matches.
            const recycledTokens = previousInternedTokens;
            const recycledClassIds = previousInternedClassIds;
            const recycledConflictStarts = previousInternedConflictStarts;
            const recycledConflictEnds = previousInternedConflictEnds;
            previousInternedTokens = internedTokens;
            previousInternedClassIds = internedClassIds;
            previousInternedConflictStarts = internedConflictStarts;
            previousInternedConflictEnds = internedConflictEnds;
            previousInternSlotMask = internSlotMask;
            if (recycledTokens.length === internSlotCount) {
              recycledTokens.fill(null);
              internedTokens = recycledTokens;
              internedClassIds = recycledClassIds;
              internedConflictStarts = recycledConflictStarts;
              internedConflictEnds = recycledConflictEnds;
            } else {
              internedTokens = new Array(internSlotCount).fill(null);
              internedClassIds = new Int32Array(internSlotCount);
              internedConflictStarts = new Int32Array(internSlotCount);
              internedConflictEnds = new Int32Array(internSlotCount);
            }
            internedTokenCount = 0;
          }
        }
      }

      canonicalTokens[index] = internedToken;

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

    // No-op shortcut: nothing dropped and whitespace is exactly `classCount - 1` single spaces
    // means the input is byte-identical to what the rebuild would produce.
    if (
      !didDrop &&
      !splitSawNonSpaceWhitespace &&
      classList.length === splitTotalTokenLength + classCount - 1
    ) {
      return classList;
    }

    let result = "";

    if (!splitSawNonSpaceWhitespace) {
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

    // Tabs or newlines between tokens: rebuild from the canonical per-token strings instead.
    for (let index = 0; index < classCount; index++) {
      if (keepFlags[index] === 1) {
        if (result) result += " ";
        result += canonicalTokens[index];
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
