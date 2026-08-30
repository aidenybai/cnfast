import {
  CHAR_CARRIAGE_RETURN,
  CHAR_COLON,
  CHAR_EXCLAMATION,
  CHAR_OPEN_BRACKET,
  CHAR_OPEN_PAREN,
  CHAR_SLASH,
  CHAR_SPACE,
  CHAR_TAB,
} from "./char-codes";
import { createClassGroupLookup } from "./class-groups";
import {
  DESCRIPTOR_CACHE_CAPACITY,
  INTERN_TABLE_INITIAL_SLOTS,
  INTERN_TABLE_MAX_SLOTS,
  MAX_CONFLICT_KEYS,
} from "./constants";
import { IMPORTANT_MODIFIER, parseClassName } from "./parse-class-name";
import { createSortModifiers } from "./sort-modifiers";
import { AnyClassGroupIds, AnyConfig } from "./types";

interface ClassDescriptor {
  /** Interned id of this class's conflict key, or -1 for a non-Tailwind class kept verbatim. */
  classId: number;
  /** Half-open range into `conflictPool` holding the conflict-key ids this class overrides. */
  conflictStart: number;
  conflictEnd: number;
}

const EXTERNAL_DESCRIPTOR: ClassDescriptor = { classId: -1, conflictStart: 0, conflictEnd: 0 };

const FNV_OFFSET_BASIS = -2128831035; // 0x811c9dc5 as signed int32
const FNV_PRIME = 16777619;

/**
 * Build the merge function for one config.
 *
 * `mergeClassList` resolves conflicts in a space-separated class string, keeping the last
 * (rightmost) class per conflict group. Output is byte-identical to tailwind-merge for every
 * input.
 *
 * High-level overview of the algorithm:
 *
 * 1. Split and hash in one scan.
 *
 * One charCodeAt pass over the input records each token's start offset, end offset, and FNV-1a
 * hash into reused scratch arrays. No token is sliced out of the input.
 *
 *     input:   "p-2 text-sm hover:p-3 p-4"
 *     starts:  [0,   4,      12,       22]
 *     ends:    [3,   11,     21,       25]
 *     hashes:  [h0,  h1,     h2,       h3]
 *
 * 2. Resolve and claim, right to left.
 *
 * The rightmost class per conflict group wins, so the scan runs backwards: each token claims
 * its own conflict key plus every key it overrides, and an earlier token whose own key was
 * already claimed is dropped. A modifier prefixes every key, so `hover:p-3` and `p-4` never
 * collide.
 *
 *     K: keep flags, one per token; . = undecided
 *
 *     "p-4"        claims p and its overrides px, py, ps, pe, pt, pr, pb, pl
 *                                                                 K: [. . . 1]
 *     "hover:p-3"  claims hover:p, hover:px, hover:py, ...        K: [. . 1 1]
 *     "text-sm"    claims font-size, leading                      K: [. 1 1 1]
 *     "p-2"        its key p is already claimed -> drop           K: [0 1 1 1]
 *
 * Conflict keys are interned to integer ids once, and claims are generation stamps in an
 * Int32Array indexed by those ids (`claimedGeneration[classId] = generation`). Starting a new
 * merge bumps the generation counter, which unclaims every key at once: no allocation, no
 * clearing.
 *
 * Each token resolves to its (classId, conflict range) through the token intern table. The
 * table is open-addressed and probed with the hash from step 1; a candidate slot is verified by
 * comparing char codes directly against the input range, so a hit slices nothing and hashes no
 * string. This matters because the engine caches a string's hash on the string object itself:
 * a fresh `classList.slice(...)` would be re-hashed on every single merge, and that re-hashing
 * was the largest measured cost of the whole miss path. Only a token found in neither table
 * generation is sliced and fully computed.
 *
 * 3. Rebuild, left to right.
 *
 * When nothing was dropped and the separators were already single spaces, the input string
 * itself is returned. Otherwise every contiguous run of kept tokens becomes one
 * `classList.slice` call:
 *
 *     K:      [0 1 1 1]
 *     result: classList.slice(4, 25)   // "text-sm hover:p-3 p-4"
 *
 * One flat slice per run, instead of a cons-string chain built token by token, is also cheaper
 * for the whole-string cache to hash downstream.
 */
export const createMergeClassList = (config: AnyConfig) => {
  const sortModifiers = createSortModifiers(config);
  const postfixLookupClassGroupIds = createPostfixLookupClassGroupIds(config);
  const {
    getClassGroupId,
    groupIndexes,
    groupCount,
    groupNames,
    conflictRowsBase,
    conflictRowsPostfix,
  } = createClassGroupLookup(config);

  let descriptorCache: Record<string, ClassDescriptor> = Object.create(null);
  let previousDescriptorCache: Record<string, ClassDescriptor> = Object.create(null);
  let descriptorCacheSize = 0;

  let claimedGeneration = new Int32Array(256);
  let currentGeneration = 0;

  let keepFlags = new Uint8Array(64);
  let tokenStarts = new Int32Array(64);
  let tokenEnds = new Int32Array(64);
  let tokenHashes = new Int32Array(64);
  const canonicalTokens: string[] = new Array(64).fill("");
  canonicalTokens.length = 0;

  /**
   * Token intern table (see step 2 of the algorithm overview).
   *
   * Open-addressed, linear-probed, load factor capped at 0.5. Parallel arrays: `internedTokens`
   * holds canonical strings, three Int32Array lanes hold each slot's descriptor. The int lanes
   * are only read after a token match and every insert writes all lanes, so clearing the token
   * array alone invalidates a generation.
   *
   * The table doubles in place until INTERN_TABLE_MAX_SLOTS (nothing is discarded while an
   * app's vocabulary still fits), then switches to two generations: the full table becomes the
   * still-probed previous generation, and previous-generation hits are re-promoted so live
   * tokens survive rotation. Growth or rotation runs on the exact insert that crosses the
   * half-full threshold, even mid-merge, which is what guarantees the probe loop terminates.
   */
  let internSlotCount = INTERN_TABLE_INITIAL_SLOTS;
  let internSlotMask = internSlotCount - 1;
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

  // Must produce the same value as the split scan's incremental hash.
  const getTokenHash = (token: string): number => {
    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < token.length; i++) {
      hash = Math.imul(hash ^ token.charCodeAt(i), FNV_PRIME);
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
    for (let i = 0; i < oldSlotCount; i++) {
      const token = oldTokens[i];
      if (token === null) continue;
      let slot = getTokenHash(token) & internSlotMask;
      while (internedTokens[slot] !== null) slot = (slot + 1) & internSlotMask;
      internedTokens[slot] = token;
      internedClassIds[slot] = oldClassIds[i]!;
      internedConflictStarts[slot] = oldConflictStarts[i]!;
      internedConflictEnds[slot] = oldConflictEnds[i]!;
    }
  };

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

  let splitSawNonSpaceWhitespace = false;
  let splitTotalTokenLength = 0;

  const splitClassList = (classList: string): number => {
    const length = classList.length;
    let tokenStart = -1;
    let tokenCount = 0;
    let hash = 0;
    let totalTokenLength = 0;
    splitSawNonSpaceWhitespace = false;

    // `i === length` acts as a virtual trailing space so the last token flushes through the
    // same path as the others.
    for (let i = 0; i <= length; i++) {
      const charCode = i < length ? classList.charCodeAt(i) : CHAR_SPACE;

      if (charCode === CHAR_SPACE || (charCode >= CHAR_TAB && charCode <= CHAR_CARRIAGE_RETURN)) {
        if (charCode !== CHAR_SPACE) splitSawNonSpaceWhitespace = true;
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
          tokenEnds[tokenCount] = i;
          tokenHashes[tokenCount] = hash;
          tokenCount++;
          totalTokenLength += i - tokenStart;
          tokenStart = -1;
        }
      } else {
        if (tokenStart === -1) {
          tokenStart = i;
          hash = FNV_OFFSET_BASIS;
        }
        hash = Math.imul(hash ^ charCode, FNV_PRIME);
      }
    }

    splitTotalTokenLength = totalTokenLength;
    return tokenCount;
  };

  // Conflict keys stay keyed by the exact concatenated `{modifier}{classGroupId}` string. That
  // is load-bearing for parity: tailwind-merge compares these concatenated strings, so two
  // DIFFERENT (modifier, group) pairs whose concatenations collide must resolve to the SAME id.
  // `overflow-auto` (modifier "", group "overflow") and `overflo:w-4` (modifier "overflo",
  // group "w") both produce the key "overflow", and a numeric (modifier, group) key would
  // wrongly keep them apart. The string hashing cost is avoided by `packedKeyIdMemo` instead:
  // each (modifierIndex, groupIndex) pair memoizes its interned id under a packed integer key,
  // so the concatenation and hash run once per distinct pair.
  const conflictKeyIds = new Map<string, number>();
  const modifierIndexes = new Map<string, number>();
  const packedKeyIdMemo = new Map<number, number>();
  let nextConflictKeyId = 0;

  const getConflictKeyId = (conflictKey: string): number => {
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

  const getModifierIndex = (modifier: string): number => {
    let index = modifierIndexes.get(modifier);
    if (index === undefined) {
      index = modifierIndexes.size;
      modifierIndexes.set(modifier, index);
    }
    return index;
  };

  // Conflict-id ranges are deduplicated per (modifier, group, postfix) row and shared through
  // one pool, so descriptors are three integers regardless of how many groups they override.
  let conflictPool = new Int32Array(1024);
  let conflictPoolCount = 0;
  const conflictRowStarts = new Map<number, number>();

  const createDescriptor = (
    classGroupId: AnyClassGroupIds,
    modifier: string,
    hasPostfixModifier: boolean,
  ): ClassDescriptor => {
    const groupIndex = groupIndexes.get(classGroupId);
    if (groupIndex === undefined) {
      // Arbitrary-property groups (`[color:red]`) are minted at lookup time and never have
      // conflict rows. They still share `conflictKeyIds`, so a concatenation collision with a
      // static pair's key unifies exactly as the reference's string comparison would.
      return {
        classId: getConflictKeyId(modifier + classGroupId),
        conflictStart: 0,
        conflictEnd: 0,
      };
    }

    const packedModifierBase = getModifierIndex(modifier) * groupCount;

    let classId = packedKeyIdMemo.get(packedModifierBase + groupIndex);
    if (classId === undefined) {
      classId = getConflictKeyId(modifier + classGroupId);
      packedKeyIdMemo.set(packedModifierBase + groupIndex, classId);
    }

    const conflictRow = hasPostfixModifier
      ? conflictRowsPostfix[groupIndex]!
      : conflictRowsBase[groupIndex]!;
    const rowLength = conflictRow.length;
    if (rowLength === 0) {
      return { classId, conflictStart: 0, conflictEnd: 0 };
    }

    // The postfix bit is part of the row key because the same (modifier, group) pair overrides
    // different groups with and without a postfix modifier (`text-lg` vs `text-lg/7`).
    const rowKey = (packedModifierBase + groupIndex) * 2 + (hasPostfixModifier ? 1 : 0);
    let conflictStart = conflictRowStarts.get(rowKey);
    if (conflictStart === undefined) {
      if (conflictPoolCount + rowLength > conflictPool.length) {
        let capacity = conflictPool.length * 2;
        while (capacity < conflictPoolCount + rowLength) capacity *= 2;
        const grown = new Int32Array(capacity);
        grown.set(conflictPool);
        conflictPool = grown;
      }
      conflictStart = conflictPoolCount;
      for (let i = 0; i < rowLength; i++) {
        const conflictGroupIndex = conflictRow[i]!;
        let conflictId = packedKeyIdMemo.get(packedModifierBase + conflictGroupIndex);
        if (conflictId === undefined) {
          conflictId = getConflictKeyId(modifier + groupNames[conflictGroupIndex]!);
          packedKeyIdMemo.set(packedModifierBase + conflictGroupIndex, conflictId);
        }
        conflictPool[conflictStart + i] = conflictId;
      }
      conflictPoolCount = conflictStart + rowLength;
      conflictRowStarts.set(rowKey, conflictStart);
    }

    return { classId, conflictStart, conflictEnd: conflictStart + rowLength };
  };

  const computeClassDescriptor = (className: string): ClassDescriptor => {
    // A token containing none of `:` `/` `[` `(` `!` cannot have variant modifiers, a postfix
    // modifier, an important marker, or an arbitrary value, so parseClassName would only
    // confirm `{ modifiers: [], base: token }` at the cost of an array and an object. ~90% of
    // real-world tokens are plain. A stray `]` or `)` without its opener does not change
    // parseClassName's output when these five characters are absent, and with an empty modifier
    // the conflict keys are the raw group-id strings, byte-identical to the general path.
    const length = className.length;
    let isPlain = true;
    for (let i = 0; i < length; i++) {
      const charCode = className.charCodeAt(i);
      if (
        charCode === CHAR_COLON ||
        charCode === CHAR_SLASH ||
        charCode === CHAR_OPEN_BRACKET ||
        charCode === CHAR_OPEN_PAREN ||
        charCode === CHAR_EXCLAMATION
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
      return createDescriptor(plainClassGroupId, "", false);
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

    return createDescriptor(classGroupId, modifier, hasPostfixModifier);
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

    // The conflict-key registry never evicts on its own, and arbitrary variants can mint
    // unbounded keys, so once it passes the cap reset it and every structure holding its ids —
    // between merges, never mid-pass, so ids stay consistent within a pass.
    if (nextConflictKeyId > MAX_CONFLICT_KEYS) {
      conflictKeyIds.clear();
      modifierIndexes.clear();
      packedKeyIdMemo.clear();
      conflictRowStarts.clear();
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
            // Tokens already resolved this pass hold direct references, so rotating cannot
            // invalidate them; the retired arrays are recycled when their size still matches.
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

    // Nothing dropped and whitespace was exactly `classCount - 1` single spaces: the input is
    // byte-identical to what the rebuild would produce.
    if (
      !didDrop &&
      !splitSawNonSpaceWhitespace &&
      classList.length === splitTotalTokenLength + classCount - 1
    ) {
      return classList;
    }

    let result = "";

    if (!splitSawNonSpaceWhitespace) {
      let runStart = -1;
      let runEnd = 0;
      for (let index = 0; index < classCount; index++) {
        if (keepFlags[index] === 1) {
          const start = tokenStarts[index]!;
          if (runStart === -1) {
            runStart = start;
          } else if (start !== runEnd + 1) {
            if (result) result += " ";
            result += classList.slice(runStart, runEnd);
            runStart = start;
          }
          runEnd = tokenEnds[index]!;
        }
      }
      if (runStart !== -1) {
        if (result) result += " ";
        result += classList.slice(runStart, runEnd);
      }
      return result;
    }

    // Tabs or newlines between tokens: input offsets no longer mirror the output, so rebuild
    // from the canonical per-token strings.
    for (let index = 0; index < classCount; index++) {
      if (keepFlags[index] === 1) {
        if (result) result += " ";
        result += canonicalTokens[index];
      }
    }

    return result;
  };

  return mergeClassList;
};

const createPostfixLookupClassGroupIds = (config: AnyConfig) => {
  const lookup: Partial<Record<AnyClassGroupIds, true>> = Object.create(null);
  const classGroupIds = config.postfixLookupClassGroups;

  if (classGroupIds) {
    for (let i = 0; i < classGroupIds.length; i++) {
      lookup[classGroupIds[i]!] = true;
    }
  }

  return lookup;
};
