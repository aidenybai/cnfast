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
import { createFilledArray } from "../utils/create-filled-array";
import {
  INTERN_TABLE_HARD_MAX_SLOTS,
  INTERN_TABLE_INITIAL_SLOTS,
  INTERN_TABLE_MAX_SLOTS,
  JSC_STARTSWITH_VERIFY_MIN_LENGTH,
  MAX_CONFLICT_KEYS,
  PREPARED_ARG_CACHE_SIZE,
  RESULT_INTERN_SLOTS,
} from "./constants";
import { IMPORTANT_MODIFIER, parseClassName } from "./parse-class-name";
import { createSortModifiers } from "./sort-modifiers";
import { AnyClassGroupIds, AnyConfig } from "./types";
import { IS_JSC } from "../utils/is-jsc";
import { sliceFlat } from "../utils/slice-flat";

interface ClassDescriptor {
  /** Interned id of this class's conflict key, or -1 for a non-Tailwind class kept verbatim. */
  classId: number;
  /** Half-open range into `conflictPool` holding the conflict-key ids this class overrides. */
  conflictStart: number;
  conflictEnd: number;
}

const EXTERNAL_DESCRIPTOR: ClassDescriptor = { classId: -1, conflictStart: 0, conflictEnd: 0 };

export interface MergeClassListEngine {
  /** Merge an already-joined, space-separated class string. */
  mergeClassList(classList: string): string;
  /**
   * Merge a variadic call whose args are individually available: `joined` MUST equal
   * `parts.join(" ")` over the first `partCount` non-empty strings. Byte-identical to
   * `mergeClassList(joined)`, but on prepared-handle memo hits pass 1 is pure int arithmetic.
   */
  mergePreparedParts(parts: readonly string[], partCount: number, joined: string): string;
}

const FNV_OFFSET_BASIS = -2128831035; // 0x811c9dc5 as signed int32
const FNV_PRIME = 16777619;

/**
 * Build the merge engine for one config.
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
export const createMergeClassList = (config: AnyConfig): MergeClassListEngine => {
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

  let claimedGeneration = new Int32Array(256);
  let currentGeneration = 0;

  // Drops are sign-tagged in place: pass 1 negates a dropped token's `tokenEnds` entry (token
  // ends are always >= 1), so no separate keep-flag array is stored or re-read. `splitClassList`
  // overwrites every entry each pass, so a negated end never leaks into the next merge.
  let tokenStarts = new Int32Array(64);
  let tokenEnds = new Int32Array(64);
  let tokenHashes = new Int32Array(64);

  /**
   * Token intern table (see step 2 of the algorithm overview).
   *
   * Open-addressed, linear-probed, load factor capped at 0.5. `internedTokens` holds canonical
   * strings; one stride-4 Int32Array (`internedTokenMeta`) holds each slot's
   * [hash, classId, conflictStart, conflictEnd]. The hash lane rejects a mismatched occupied
   * slot with a single int load, before the string is ever dereferenced; the descriptor lanes
   * are only read after a token match and every insert writes all four, so clearing the token
   * array alone invalidates a generation.
   *
   * The table doubles in place until INTERN_TABLE_MAX_SLOTS (nothing is discarded while an
   * app's vocabulary still fits), then switches to two generations: the full table becomes the
   * still-probed previous generation, and previous-generation hits are re-promoted so live
   * tokens survive rotation. Sustained re-promotion pressure lifts the cap further, up to
   * INTERN_TABLE_HARD_MAX_SLOTS (see `growOrRotateInternTable`).
   */
  let internSlotCount = INTERN_TABLE_INITIAL_SLOTS;
  let internSlotMask = internSlotCount - 1;
  let previousInternSlotMask = internSlotMask;
  let internedTokens: (string | null)[] = createFilledArray<string | null>(
    INTERN_TABLE_INITIAL_SLOTS,
    null,
  );
  let previousInternedTokens: (string | null)[] = createFilledArray<string | null>(
    INTERN_TABLE_INITIAL_SLOTS,
    null,
  );
  let internedTokenMeta = new Int32Array(INTERN_TABLE_INITIAL_SLOTS * 4);
  let previousInternedTokenMeta = new Int32Array(INTERN_TABLE_INITIAL_SLOTS * 4);
  let internedTokenCount = 0;
  let rePromotionCount = 0;

  const growInternTable = (): void => {
    const oldTokens = internedTokens;
    const oldMeta = internedTokenMeta;
    const oldSlotCount = internSlotCount;
    internSlotCount = oldSlotCount * 2;
    internSlotMask = internSlotCount - 1;
    internedTokens = createFilledArray<string | null>(internSlotCount, null);
    internedTokenMeta = new Int32Array(internSlotCount * 4);
    for (let i = 0; i < oldSlotCount; i++) {
      const token = oldTokens[i];
      if (token === null) continue;
      const oldMetaBase = i << 2;
      const hash = oldMeta[oldMetaBase]!;
      let slot = hash & internSlotMask;
      while (internedTokens[slot] !== null) slot = (slot + 1) & internSlotMask;
      internedTokens[slot] = token;
      const metaBase = slot << 2;
      internedTokenMeta[metaBase] = hash;
      internedTokenMeta[metaBase + 1] = oldMeta[oldMetaBase + 1]!;
      internedTokenMeta[metaBase + 2] = oldMeta[oldMetaBase + 2]!;
      internedTokenMeta[metaBase + 3] = oldMeta[oldMetaBase + 3]!;
    }
  };

  // Runs on the exact insert that crosses the half-full threshold, even mid-merge, which is
  // what guarantees the probe loops terminate. Tokens already resolved this pass hold direct
  // references, so rotating cannot invalidate them; the retired arrays are recycled when their
  // size still matches. The retired meta lanes need no clearing: they are only read behind a
  // non-null token in the same slot, and every token insert rewrites all four lanes.
  //
  // Past the soft max the table still doubles (up to the hard max) when re-promotions prove the
  // rotation was forced by live capacity rather than churn (rationale on
  // INTERN_TABLE_HARD_MAX_SLOTS in constants.ts).
  const growOrRotateInternTable = (): void => {
    if (
      internSlotCount < INTERN_TABLE_MAX_SLOTS ||
      (internSlotCount < INTERN_TABLE_HARD_MAX_SLOTS && rePromotionCount > internSlotCount >> 2)
    ) {
      rePromotionCount = 0;
      growInternTable();
      return;
    }
    rePromotionCount = 0;
    const recycledTokens = previousInternedTokens;
    const recycledMeta = previousInternedTokenMeta;
    previousInternedTokens = internedTokens;
    previousInternedTokenMeta = internedTokenMeta;
    previousInternSlotMask = internSlotMask;
    if (recycledTokens.length === internSlotCount) {
      recycledTokens.fill(null);
      internedTokens = recycledTokens;
      internedTokenMeta = recycledMeta;
    } else {
      internedTokens = createFilledArray<string | null>(internSlotCount, null);
      internedTokenMeta = new Int32Array(internSlotCount * 4);
    }
    internedTokenCount = 0;
  };

  const flushInternTable = (): void => {
    internSlotCount = INTERN_TABLE_INITIAL_SLOTS;
    internSlotMask = internSlotCount - 1;
    previousInternSlotMask = internSlotMask;
    internedTokens = createFilledArray<string | null>(INTERN_TABLE_INITIAL_SLOTS, null);
    previousInternedTokens = createFilledArray<string | null>(INTERN_TABLE_INITIAL_SLOTS, null);
    internedTokenMeta = new Int32Array(INTERN_TABLE_INITIAL_SLOTS * 4);
    previousInternedTokenMeta = new Int32Array(INTERN_TABLE_INITIAL_SLOTS * 4);
    internedTokenCount = 0;
    rePromotionCount = 0;
  };

  const getInternedTokenAt = (
    source: string,
    start: number,
    end: number,
    hash: number,
  ): string | null => {
    const tokenLength = end - start;
    let slot = hash & internSlotMask;
    let candidate: string | null;
    while ((candidate = internedTokens[slot]!) !== null) {
      if (internedTokenMeta[slot << 2] === hash && candidate.length === tokenLength) {
        let offset = 0;
        while (
          offset < tokenLength &&
          candidate.charCodeAt(offset) === source.charCodeAt(start + offset)
        ) {
          offset++;
        }
        if (offset === tokenLength) return candidate;
      }
      slot = (slot + 1) & internSlotMask;
    }
    let previousSlot = hash & previousInternSlotMask;
    while ((candidate = previousInternedTokens[previousSlot]!) !== null) {
      if (
        previousInternedTokenMeta[previousSlot << 2] === hash &&
        candidate.length === tokenLength
      ) {
        let offset = 0;
        while (
          offset < tokenLength &&
          candidate.charCodeAt(offset) === source.charCodeAt(start + offset)
        ) {
          offset++;
        }
        if (offset === tokenLength) return candidate;
      }
      previousSlot = (previousSlot + 1) & previousInternSlotMask;
    }
    return null;
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

  // Result-intern table (rationale on RESULT_INTERN_SLOTS in constants.ts). The key folds the
  // kept tokens' already-computed FNV-1a hashes (O(kept tokens), never O(chars)); equal result
  // bytes imply an equal kept-token sequence (tokens contain no spaces), so byte-equal results
  // always collide into the same slot, and a full byte verification against the source's token
  // ranges guards the hit — the hash alone is never trusted. Entries never need invalidation:
  // keys and values are pure content, independent of the conflict-key registry.
  const resultInternMask = RESULT_INTERN_SLOTS - 1;
  const internedResults: (string | null)[] = createFilledArray<string | null>(
    RESULT_INTERN_SLOTS,
    null,
  );
  const internedResultKeys = new Int32Array(RESULT_INTERN_SLOTS);
  let resultInternSlot = 0;
  let resultInternKey = 0;
  let keptTokenCount = 0;
  let lastKeptTokenIndex = 0;

  // Counts the kept tokens (into `keptTokenCount`/`lastKeptTokenIndex` for the callers' single-
  // survivor shortcuts, skipping the probe in that case) and returns the canonical prior result
  // when a byte-equal one is interned, else null with `resultInternSlot`/`resultInternKey` set
  // for `storeInternedResult`.
  const findInternedResult = (source: string, classCount: number): string | null => {
    let keptCount = 0;
    let keptCharCount = 0;
    let lastKeptIndex = 0;
    let key = FNV_OFFSET_BASIS;
    for (let index = 0; index < classCount; index++) {
      const end = tokenEnds[index]!;
      if (end < 0) continue;
      keptCount++;
      keptCharCount += end - tokenStarts[index]!;
      lastKeptIndex = index;
      key = Math.imul(key ^ tokenHashes[index]!, FNV_PRIME);
    }
    keptTokenCount = keptCount;
    lastKeptTokenIndex = lastKeptIndex;
    if (keptCount === 1) return null;

    resultInternSlot = key & resultInternMask;
    resultInternKey = key;
    if (internedResultKeys[resultInternSlot] !== key) return null;
    const candidate = internedResults[resultInternSlot];
    // Length check first, then byte-verify the candidate against the kept tokens' ranges in the
    // source. Separator positions are skipped, not compared: every stored entry came from our
    // own rebuild, which always joins with single spaces, so with the length equal and every
    // token byte equal the separators are spaces by construction.
    if (candidate === null || candidate.length !== keptCharCount + keptCount - 1) return null;
    let position = 0;
    for (let index = 0; index < classCount; index++) {
      const end = tokenEnds[index]!;
      if (end < 0) continue;
      if (position !== 0) position++;
      const start = tokenStarts[index]!;
      for (let cursor = start; cursor < end; cursor++) {
        if (candidate.charCodeAt(position++) !== source.charCodeAt(cursor)) return null;
      }
    }
    return candidate;
  };

  const storeInternedResult = (result: string): void => {
    internedResults[resultInternSlot] = result;
    internedResultKeys[resultInternSlot] = resultInternKey;
  };

  /**
   * Per-argument prepared handles.
   *
   * A whole-string-cache miss whose ARGUMENTS are individually familiar (the compositional
   * pattern: same fragments, novel combination — a grid cell mixing stable variant strings with
   * one live arbitrary value) still pays the full split scan over the joined string plus a
   * charCode-verified intern probe per token, even though every byte of every argument was seen
   * before. A "prepared handle" memoizes one argument's parse as a single Int32Array:
   *
   *     [tokenCount, normalizedFlag,
   *      (startInArg, endInArg, tokenHash, classId, conflictStart, conflictEnd)*]
   *
   * The hash lane exists for the result-intern table: its key folds per-token content hashes, and
   * replaying them from the handle keeps the drop-path rebuild free of any O(chars) re-hash.
   *
   * `normalizedFlag` is 1 iff the arg is byte-identical to its tokens joined by single spaces —
   * when every part of a call is normalized, the joined string is too, which is what the no-drop
   * shortcut needs. Token offsets are relative to the ARG; the merge shifts them by the arg's base
   * offset in the joined string (pure arithmetic — `joined` is always `parts.join(" ")`), so
   * pass 2 can still slice contiguous kept runs out of the joined input. Handles hold interned
   * conflict-key ids, so the memo is flushed by the same registry reset that flushes the token
   * intern table.
   */
  const UNPREPARABLE = new Int32Array(0);

  // Two-generation memo keyed by the arg string. Keys are the stable per-render arg strings (JSX
  // literals), so the engine's cached string hashes make `Map.get` cheap — the same reason the
  // entry-level arg cache uses a Map while the whole-string cache (probed with fresh rope joins)
  // deliberately does not. Previous-generation hits are promoted by reference.
  let preparedArgCache = new Map<string, Int32Array>();
  let previousPreparedArgCache = new Map<string, Int32Array>();
  let preparedArgCacheCount = 0;

  // Second-sighting doorkeeper for '['-containing args, mirroring the entry cache's: a live
  // interpolated arbitrary value (`bg-[rgb(${...})]`) produces a never-repeating arg per render,
  // and memoizing it would pay a Map insert plus handle retention for an entry that is never
  // read. Stable '[' literals (`w-[350px]`) are admitted on their second sighting.
  let preparedSeenOnce = new Set<string>();
  let previousPreparedSeenOnce = new Set<string>();

  const admitPreparedArg = (arg: string): boolean => {
    if (arg.indexOf("[") === -1) return true;
    if (preparedSeenOnce.has(arg) || previousPreparedSeenOnce.has(arg)) return true;
    preparedSeenOnce.add(arg);
    if (preparedSeenOnce.size > PREPARED_ARG_CACHE_SIZE) {
      previousPreparedSeenOnce = preparedSeenOnce;
      preparedSeenOnce = new Set();
    }
    return false;
  };

  // Builds the handle for one argument string. Runs once per unique admitted arg per memo
  // generation: the split reuses the fused scan, and descriptor resolution goes through the
  // intern table — the single token-level memo — promoting previous-generation hits and
  // interning computed double-misses exactly like `mergeClassList`'s pass 1, so a token pays
  // `computeClassDescriptor` once regardless of which entry point sees it first.
  const prepareArg = (arg: string): Int32Array => {
    const count = splitClassList(arg);
    // Tabs/newlines make the offset arithmetic diverge from what a split of the joined string
    // would produce for the no-op shortcut and run rebuild; such args are rare, so the whole
    // call falls back to the ordinary joined-string merge.
    if (splitSawNonSpaceWhitespace) return UNPREPARABLE;

    const handle = new Int32Array(2 + count * 6);
    handle[0] = count;
    // Same identity as `mergeClassList`'s no-op shortcut: exactly `count - 1` single-space
    // separators and nothing else.
    handle[1] = splitTotalTokenLength + count - 1 === arg.length ? 1 : 0;

    for (let index = 0; index < count; index++) {
      const start = tokenStarts[index]!;
      const end = tokenEnds[index]!;
      const tokenLength = end - start;
      const tokenHash = tokenHashes[index]!;

      let classId = 0;
      let conflictStart = 0;
      let conflictEnd = 0;
      let found = false;

      let slot = tokenHash & internSlotMask;
      let internedToken: string | null;
      while ((internedToken = internedTokens[slot]!) !== null) {
        if (internedTokenMeta[slot << 2] === tokenHash && internedToken.length === tokenLength) {
          let offset = 0;
          while (
            offset < tokenLength &&
            internedToken.charCodeAt(offset) === arg.charCodeAt(start + offset)
          ) {
            offset++;
          }
          if (offset === tokenLength) {
            const metaBase = slot << 2;
            classId = internedTokenMeta[metaBase + 1]!;
            conflictStart = internedTokenMeta[metaBase + 2]!;
            conflictEnd = internedTokenMeta[metaBase + 3]!;
            found = true;
            break;
          }
        }
        slot = (slot + 1) & internSlotMask;
      }

      if (!found) {
        let previousSlot = tokenHash & previousInternSlotMask;
        let previousToken: string | null;
        while ((previousToken = previousInternedTokens[previousSlot]!) !== null) {
          if (
            previousInternedTokenMeta[previousSlot << 2] === tokenHash &&
            previousToken.length === tokenLength
          ) {
            let offset = 0;
            while (
              offset < tokenLength &&
              previousToken.charCodeAt(offset) === arg.charCodeAt(start + offset)
            ) {
              offset++;
            }
            if (offset === tokenLength) {
              const previousMetaBase = previousSlot << 2;
              classId = previousInternedTokenMeta[previousMetaBase + 1]!;
              conflictStart = previousInternedTokenMeta[previousMetaBase + 2]!;
              conflictEnd = previousInternedTokenMeta[previousMetaBase + 3]!;
              internedTokens[slot] = previousToken;
              const metaBase = slot << 2;
              internedTokenMeta[metaBase] = tokenHash;
              internedTokenMeta[metaBase + 1] = classId;
              internedTokenMeta[metaBase + 2] = conflictStart;
              internedTokenMeta[metaBase + 3] = conflictEnd;
              rePromotionCount++;
              if (++internedTokenCount > internSlotCount >> 1) growOrRotateInternTable();
              found = true;
              break;
            }
          }
          previousSlot = (previousSlot + 1) & previousInternSlotMask;
        }
      }

      if (!found) {
        const token = sliceFlat(arg, start, end);
        const descriptor = computeClassDescriptor(token);
        classId = descriptor.classId;
        conflictStart = descriptor.conflictStart;
        conflictEnd = descriptor.conflictEnd;
        internedTokens[slot] = token;
        const metaBase = slot << 2;
        internedTokenMeta[metaBase] = tokenHash;
        internedTokenMeta[metaBase + 1] = classId;
        internedTokenMeta[metaBase + 2] = conflictStart;
        internedTokenMeta[metaBase + 3] = conflictEnd;
        if (++internedTokenCount > internSlotCount >> 1) growOrRotateInternTable();
      }

      const handleOffset = 2 + index * 6;
      handle[handleOffset] = start;
      handle[handleOffset + 1] = end;
      handle[handleOffset + 2] = tokenHash;
      handle[handleOffset + 3] = classId;
      handle[handleOffset + 4] = conflictStart;
      handle[handleOffset + 5] = conflictEnd;
    }

    return handle;
  };

  // Reusable scratch for the per-call handle list and part base offsets (grown, never shrunk;
  // `cn` calls are synchronous and non-reentrant so a closure-level scratch is safe).
  let partHandles: Int32Array[] = createFilledArray(16, UNPREPARABLE);
  let partBases = new Int32Array(16);

  // Rare-path body of the `MAX_CONFLICT_KEYS` bound, shared by both merge entry points. The
  // registry never evicts on its own, and arbitrary variants can mint unbounded keys, so once it
  // passes the cap reset it and every structure holding its ids — between merges, never
  // mid-pass, so ids stay consistent within a pass. The prepared-arg memo is flushed alongside
  // because its handles embed interned conflict-key ids; the monotonic generation counter means
  // reused ids never read a stale claim from a prior merge.
  const resetConflictRegistry = (): void => {
    conflictKeyIds.clear();
    modifierIndexes.clear();
    packedKeyIdMemo.clear();
    conflictRowStarts.clear();
    conflictPoolCount = 0;
    nextConflictKeyId = 0;
    preparedArgCache = new Map();
    previousPreparedArgCache = new Map();
    preparedArgCacheCount = 0;
    flushInternTable();
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

    // The cheap threshold check stays inline (this is the hot path); only the rare reset body is
    // shared with `mergePreparedParts`.
    if (nextConflictKeyId > MAX_CONFLICT_KEYS) resetConflictRegistry();

    currentGeneration = (currentGeneration + 1) | 0;
    // Generation 0 is the array's initialized value; skip it so a fresh pass never reads stale
    // zero-stamps as "claimed" after the int32 counter wraps.
    if (currentGeneration === 0) currentGeneration = 1;
    const generation = currentGeneration;

    let didDrop = false;
    for (let index = classCount - 1; index >= 0; index -= 1) {
      const start = tokenStarts[index]!;
      const end = tokenEnds[index]!;
      const tokenLength = end - start;
      const tokenHash = tokenHashes[index]!;

      // A hash-and-length match is almost always the token itself, so the verify runs its full
      // length; on JSC the `startsWith` builtin beats the char loop for longer tokens.
      const useBuiltinVerify = IS_JSC && tokenLength >= JSC_STARTSWITH_VERIFY_MIN_LENGTH;

      let slot = tokenHash & internSlotMask;
      let internedToken: string | null;
      while ((internedToken = internedTokens[slot]!) !== null) {
        if (internedTokenMeta[slot << 2] === tokenHash && internedToken.length === tokenLength) {
          if (useBuiltinVerify) {
            if (classList.startsWith(internedToken, start)) break;
          } else {
            let offset = 0;
            while (
              offset < tokenLength &&
              internedToken.charCodeAt(offset) === classList.charCodeAt(start + offset)
            ) {
              offset++;
            }
            if (offset === tokenLength) break;
          }
        }
        slot = (slot + 1) & internSlotMask;
      }

      // Hit path: the conflict lanes are loaded only when the token actually claims, so a
      // dropped or external token costs one int load beyond the probe.
      if (internedToken !== null) {
        const metaBase = slot << 2;
        const classId = internedTokenMeta[metaBase + 1]!;
        if (classId === -1) continue;
        if (claimedGeneration[classId] === generation) {
          tokenEnds[index] = -end;
          didDrop = true;
          continue;
        }
        claimedGeneration[classId] = generation;
        const conflictEnd = internedTokenMeta[metaBase + 3]!;
        for (
          let poolIndex = internedTokenMeta[metaBase + 2]!;
          poolIndex < conflictEnd;
          poolIndex++
        ) {
          claimedGeneration[conflictPool[poolIndex]!] = generation;
        }
        continue;
      }

      let classId: number;
      let conflictStart: number;
      let conflictEnd: number;
      {
        let previousSlot = tokenHash & previousInternSlotMask;
        let previousToken: string | null;
        while ((previousToken = previousInternedTokens[previousSlot]!) !== null) {
          if (
            previousInternedTokenMeta[previousSlot << 2] === tokenHash &&
            previousToken.length === tokenLength
          ) {
            if (useBuiltinVerify) {
              if (classList.startsWith(previousToken, start)) break;
            } else {
              let offset = 0;
              while (
                offset < tokenLength &&
                previousToken.charCodeAt(offset) === classList.charCodeAt(start + offset)
              ) {
                offset++;
              }
              if (offset === tokenLength) break;
            }
          }
          previousSlot = (previousSlot + 1) & previousInternSlotMask;
        }

        if (previousToken !== null) {
          internedToken = previousToken;
          const previousMetaBase = previousSlot << 2;
          classId = previousInternedTokenMeta[previousMetaBase + 1]!;
          conflictStart = previousInternedTokenMeta[previousMetaBase + 2]!;
          conflictEnd = previousInternedTokenMeta[previousMetaBase + 3]!;
          rePromotionCount++;
        } else {
          internedToken = sliceFlat(classList, start, end);
          const descriptor = computeClassDescriptor(internedToken);
          classId = descriptor.classId;
          conflictStart = descriptor.conflictStart;
          conflictEnd = descriptor.conflictEnd;
        }

        // `slot` is the first empty slot the current-generation probe stopped at, so inserting
        // there keeps the probe chain intact.
        internedTokens[slot] = internedToken;
        const metaBase = slot << 2;
        internedTokenMeta[metaBase] = tokenHash;
        internedTokenMeta[metaBase + 1] = classId;
        internedTokenMeta[metaBase + 2] = conflictStart;
        internedTokenMeta[metaBase + 3] = conflictEnd;
        if (++internedTokenCount > internSlotCount >> 1) growOrRotateInternTable();
      }

      if (classId === -1) continue;

      if (claimedGeneration[classId] === generation) {
        tokenEnds[index] = -end;
        didDrop = true;
        continue;
      }

      claimedGeneration[classId] = generation;
      for (let poolIndex = conflictStart; poolIndex < conflictEnd; poolIndex++) {
        claimedGeneration[conflictPool[poolIndex]!] = generation;
      }
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

    const internedResult = findInternedResult(classList, classCount);
    if (internedResult !== null) return internedResult;
    // A single surviving token needs no rebuild: pass 1 interned its canonical string
    // (byte-verified against the input range), so re-probing returns that object without
    // allocating. The fallback slice is only reachable when the table rotated twice mid-pass.
    if (keptTokenCount === 1) {
      const start = tokenStarts[lastKeptTokenIndex]!;
      const end = tokenEnds[lastKeptTokenIndex]!;
      const interned = getInternedTokenAt(classList, start, end, tokenHashes[lastKeptTokenIndex]!);
      return interned !== null ? interned : classList.slice(start, end);
    }

    let result = "";

    if (!splitSawNonSpaceWhitespace) {
      let runStart = -1;
      let runEnd = 0;
      for (let index = 0; index < classCount; index++) {
        const end = tokenEnds[index]!;
        if (end < 0) continue;
        const start = tokenStarts[index]!;
        if (runStart === -1) {
          runStart = start;
        } else if (start !== runEnd + 1) {
          if (result) result += " ";
          result += classList.slice(runStart, runEnd);
          runStart = start;
        }
        runEnd = end;
      }
      if (runStart !== -1) {
        if (result) result += " ";
        result += classList.slice(runStart, runEnd);
      }
      storeInternedResult(result);
      return result;
    }

    // Tabs or newlines between tokens: input offsets no longer mirror the output, so each kept
    // token is sliced on demand (byte-equal to its interned canonical by construction).
    for (let index = 0; index < classCount; index++) {
      const end = tokenEnds[index]!;
      if (end < 0) continue;
      if (result) result += " ";
      result += classList.slice(tokenStarts[index]!, end);
    }

    storeInternedResult(result);
    return result;
  };

  // Byte-identical to `mergeClassList(joined)` — a memoized per-arg parse only changes WHERE the
  // token boundaries and descriptors come from, never what they are — but on memo hits it skips
  // the whole-string split scan and every charCode-verified intern probe: pass 1 becomes
  // arithmetic over cached int32 data. Any unpreparable part falls back to the ordinary path.
  const mergePreparedParts = (
    parts: readonly string[],
    partCount: number,
    joined: string,
  ): string => {
    if (nextConflictKeyId > MAX_CONFLICT_KEYS) resetConflictRegistry();

    if (partCount > partBases.length) {
      let capacity = partBases.length;
      while (capacity < partCount) capacity *= 2;
      partBases = new Int32Array(capacity);
      const grownHandles: Int32Array[] = createFilledArray(capacity, UNPREPARABLE);
      partHandles = grownHandles;
    }

    // Resolve every part to its handle (memo hit, or prepare on miss) before touching the shared
    // token arrays — `prepareArg` uses them as split scratch.
    let classCount = 0;
    let allNormalized = true;
    for (let part = 0; part < partCount; part++) {
      const arg = parts[part]!;
      let handle = preparedArgCache.get(arg);
      if (handle === undefined) {
        handle = previousPreparedArgCache.get(arg);
        if (handle !== undefined) {
          // Promote by reference (no insert accounting), like `findBucket` in the entry cache.
          preparedArgCache.set(arg, handle);
        } else {
          handle = prepareArg(arg);
          if (admitPreparedArg(arg)) {
            preparedArgCache.set(arg, handle);
            if (++preparedArgCacheCount > PREPARED_ARG_CACHE_SIZE) {
              preparedArgCacheCount = 0;
              previousPreparedArgCache = preparedArgCache;
              preparedArgCache = new Map();
            }
          }
        }
      }
      if (handle === UNPREPARABLE) return mergeClassList(joined);
      partHandles[part] = handle;
      classCount += handle[0]!;
      if (handle[1] === 0) allNormalized = false;
    }

    // Part base offsets into `joined`: parts are joined with exactly one space.
    let partBase = 0;
    for (let part = 0; part < partCount; part++) {
      partBases[part] = partBase;
      partBase += parts[part]!.length + 1;
    }

    // Degenerate token counts mirror `mergeClassList`'s early returns byte for byte.
    if (classCount === 0) return "";
    if (classCount === 1) {
      for (let part = 0; part < partCount; part++) {
        const handle = partHandles[part]!;
        if (handle[0] === 1) {
          const start = partBases[part]! + handle[2]!;
          const end = partBases[part]! + handle[3]!;
          return start === 0 && end === joined.length ? joined : joined.slice(start, end);
        }
      }
    }

    if (classCount > tokenStarts.length) {
      // Grown as a trio so `splitClassList`'s single capacity check stays valid.
      let capacity = tokenStarts.length;
      while (capacity < classCount) capacity *= 2;
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

    currentGeneration = (currentGeneration + 1) | 0;
    if (currentGeneration === 0) currentGeneration = 1;
    const generation = currentGeneration;

    // Pass 1, right-to-left over parts and their tokens — identical claim semantics to
    // `mergeClassList`, but descriptors are int loads from the handles: no split, no probe, no
    // slice, no string hash. Absolute token offsets land in `tokenStarts`/`tokenEnds` for pass 2.
    let didDrop = false;
    let index = classCount - 1;
    for (let part = partCount - 1; part >= 0; part--) {
      const handle = partHandles[part]!;
      const base = partBases[part]!;
      for (let token = handle[0]! - 1; token >= 0; token--) {
        const handleOffset = 2 + token * 6;
        tokenStarts[index] = base + handle[handleOffset]!;
        const end = base + handle[handleOffset + 1]!;
        tokenHashes[index] = handle[handleOffset + 2]!;

        const classId = handle[handleOffset + 3]!;
        if (classId === -1) {
          tokenEnds[index] = end;
        } else if (claimedGeneration[classId] === generation) {
          tokenEnds[index] = -end;
          didDrop = true;
        } else {
          claimedGeneration[classId] = generation;
          const conflictEnd = handle[handleOffset + 5]!;
          for (let poolIndex = handle[handleOffset + 4]!; poolIndex < conflictEnd; poolIndex++) {
            claimedGeneration[conflictPool[poolIndex]!] = generation;
          }
          tokenEnds[index] = end;
        }
        index--;
      }
    }

    // No-op shortcut: every part normalized means `joined` is already `tokens.join(" ")`.
    if (!didDrop && allNormalized) return joined;

    // No canonical token string is at hand here (handles carry offsets, not strings), so the
    // single-survivor shortcut slices instead; the intern table is shared with `mergeClassList`,
    // unifying byte-equal results across both entry points.
    const internedResult = findInternedResult(joined, classCount);
    if (internedResult !== null) return internedResult;
    if (keptTokenCount === 1) {
      return joined.slice(tokenStarts[lastKeptTokenIndex]!, tokenEnds[lastKeptTokenIndex]!);
    }

    // Pass 2: same contiguous kept-run rebuild as `mergeClassList` (prepared parts never contain
    // non-space whitespace, so the interned-name fallback is unreachable here).
    let result = "";
    let runStart = -1;
    let runEnd = 0;
    for (let tokenIndex = 0; tokenIndex < classCount; tokenIndex++) {
      const end = tokenEnds[tokenIndex]!;
      if (end < 0) continue;
      const start = tokenStarts[tokenIndex]!;
      if (runStart === -1) {
        runStart = start;
      } else if (start !== runEnd + 1) {
        if (result) result += " ";
        result += joined.slice(runStart, runEnd);
        runStart = start;
      }
      runEnd = end;
    }
    if (runStart !== -1) {
      if (result) result += " ";
      result += joined.slice(runStart, runEnd);
    }
    storeInternedResult(result);
    return result;
  };

  return { mergeClassList, mergePreparedParts };
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
