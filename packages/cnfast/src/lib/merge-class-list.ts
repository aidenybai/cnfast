import {
  CHAR_CARRIAGE_RETURN,
  CHAR_COLON,
  CHAR_EXCLAMATION,
  CHAR_OPEN_BRACKET,
  CHAR_OPEN_PAREN,
  CHAR_SLASH,
  CHAR_SPACE,
  CHAR_TAB,
} from "./char-codes.js";
import { createClassGroupLookup } from "./class-groups.js";
import { createFilledArray } from "../utils/create-filled-array.js";
import {
  FNV_PRIME,
  FNV_SIGNED_OFFSET_BASIS,
  INITIAL_CLAIM_SLOTS,
  INITIAL_CONFLICT_POOL_SLOTS,
  INITIAL_PREPARED_PART_SLOTS,
  INITIAL_TOKEN_SLOTS,
  INTERN_TABLE_HARD_MAX_SLOTS,
  INTERN_TABLE_INITIAL_SLOTS,
  INTERN_TABLE_MAX_SLOTS,
  JSC_STARTSWITH_VERIFY_MIN_LENGTH,
  MAX_CONFLICT_KEYS,
  OPEN_BRACKET_CHARACTER,
  PREPARED_PART_CACHE_SIZE,
  RESULT_INTERN_SLOTS,
  SPACE_CHARACTER,
} from "./constants.js";
import { IMPORTANT_MODIFIER, parseClassName } from "./parse-class-name.js";
import { createSortModifiers } from "./sort-modifiers.js";
import { IS_JSC } from "../utils/is-jsc.js";
import { sliceFlat } from "../utils/slice-flat.js";
import type { AnyClassGroupIds, AnyConfig } from "./types.js";

interface ClassDescriptor {
  classId: number;
  conflictStart: number;
  conflictEnd: number;
}

const EXTERNAL_DESCRIPTOR: ClassDescriptor = { classId: -1, conflictStart: 0, conflictEnd: 0 };

export interface MergeClassListEngine {
  mergeClassList(classList: string): string;
  mergePreparedParts(
    classListParts: readonly string[],
    partCount: number,
    classList: string,
  ): string;
}

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

  let claimedGeneration = new Int32Array(INITIAL_CLAIM_SLOTS);
  let currentGeneration = 0;

  let tokenStarts = new Int32Array(INITIAL_TOKEN_SLOTS);
  let tokenEnds = new Int32Array(INITIAL_TOKEN_SLOTS);
  let tokenHashes = new Int32Array(INITIAL_TOKEN_SLOTS);

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
    for (let index = 0; index < oldSlotCount; index++) {
      const token = oldTokens[index];
      if (token === null) continue;
      const oldMetaBase = index << 2;
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

    for (let index = 0; index <= length; index++) {
      const charCode = index < length ? classList.charCodeAt(index) : CHAR_SPACE;

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
          tokenEnds[tokenCount] = index;
          tokenHashes[tokenCount] = hash;
          tokenCount++;
          totalTokenLength += index - tokenStart;
          tokenStart = -1;
        }
      } else {
        if (tokenStart === -1) {
          tokenStart = index;
          hash = FNV_SIGNED_OFFSET_BASIS;
        }
        hash = Math.imul(hash ^ charCode, FNV_PRIME);
      }
    }

    splitTotalTokenLength = totalTokenLength;
    return tokenCount;
  };

  const conflictKeyIds = new Map<string, number>();
  const modifierIndexes = new Map<string, number>();
  const packedKeyIdMemo = new Map<number, number>();
  let nextConflictKeyId = 0;

  const getConflictKeyId = (conflictKey: string): number => {
    let conflictKeyId = conflictKeyIds.get(conflictKey);
    if (conflictKeyId === undefined) {
      conflictKeyId = nextConflictKeyId++;
      conflictKeyIds.set(conflictKey, conflictKeyId);
      if (conflictKeyId >= claimedGeneration.length) {
        const grown = new Int32Array(claimedGeneration.length * 2);
        grown.set(claimedGeneration);
        claimedGeneration = grown;
      }
    }
    return conflictKeyId;
  };

  const getModifierIndex = (modifier: string): number => {
    let index = modifierIndexes.get(modifier);
    if (index === undefined) {
      index = modifierIndexes.size;
      modifierIndexes.set(modifier, index);
    }
    return index;
  };

  let conflictPool = new Int32Array(INITIAL_CONFLICT_POOL_SLOTS);
  let conflictPoolCount = 0;
  const conflictRowStarts = new Map<number, number>();

  const createDescriptor = (
    classGroupId: AnyClassGroupIds,
    modifier: string,
    hasPostfixModifier: boolean,
  ): ClassDescriptor => {
    const groupIndex = groupIndexes.get(classGroupId);
    if (groupIndex === undefined) {
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
      for (let index = 0; index < rowLength; index++) {
        const conflictGroupIndex = conflictRow[index]!;
        let conflictId = packedKeyIdMemo.get(packedModifierBase + conflictGroupIndex);
        if (conflictId === undefined) {
          conflictId = getConflictKeyId(modifier + groupNames[conflictGroupIndex]!);
          packedKeyIdMemo.set(packedModifierBase + conflictGroupIndex, conflictId);
        }
        conflictPool[conflictStart + index] = conflictId;
      }
      conflictPoolCount = conflictStart + rowLength;
      conflictRowStarts.set(rowKey, conflictStart);
    }

    return { classId, conflictStart, conflictEnd: conflictStart + rowLength };
  };

  const computeClassDescriptor = (className: string): ClassDescriptor => {
    const length = className.length;
    let isPlain = true;
    for (let index = 0; index < length; index++) {
      const charCode = className.charCodeAt(index);
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

  const findInternedResult = (source: string, classCount: number): string | null => {
    let keptCount = 0;
    let keptCharCount = 0;
    let lastKeptIndex = 0;
    let key = FNV_SIGNED_OFFSET_BASIS;
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

  const storeInternedResult = (mergedClassName: string): void => {
    internedResults[resultInternSlot] = mergedClassName;
    internedResultKeys[resultInternSlot] = resultInternKey;
  };

  const UNPREPARABLE_PART = new Int32Array(0);

  let preparedPartCache = new Map<string, Int32Array>();
  let previousPreparedPartCache = new Map<string, Int32Array>();
  let preparedPartCacheCount = 0;

  let preparedPartSeenOnce = new Set<string>();
  let previousPreparedPartSeenOnce = new Set<string>();

  const shouldCachePreparedPart = (classListPart: string): boolean => {
    if (classListPart.indexOf(OPEN_BRACKET_CHARACTER) === -1) return true;
    if (preparedPartSeenOnce.has(classListPart) || previousPreparedPartSeenOnce.has(classListPart))
      return true;
    preparedPartSeenOnce.add(classListPart);
    if (preparedPartSeenOnce.size > PREPARED_PART_CACHE_SIZE) {
      previousPreparedPartSeenOnce = preparedPartSeenOnce;
      preparedPartSeenOnce = new Set();
    }
    return false;
  };

  const prepareClassListPart = (classListPart: string): Int32Array => {
    const classCount = splitClassList(classListPart);
    if (splitSawNonSpaceWhitespace) return UNPREPARABLE_PART;

    const preparedPartMetadata = new Int32Array(2 + classCount * 6);
    preparedPartMetadata[0] = classCount;
    preparedPartMetadata[1] =
      splitTotalTokenLength + classCount - 1 === classListPart.length ? 1 : 0;

    for (let index = 0; index < classCount; index++) {
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
            internedToken.charCodeAt(offset) === classListPart.charCodeAt(start + offset)
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
              previousToken.charCodeAt(offset) === classListPart.charCodeAt(start + offset)
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
        const token = sliceFlat(classListPart, start, end);
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
      preparedPartMetadata[handleOffset] = start;
      preparedPartMetadata[handleOffset + 1] = end;
      preparedPartMetadata[handleOffset + 2] = tokenHash;
      preparedPartMetadata[handleOffset + 3] = classId;
      preparedPartMetadata[handleOffset + 4] = conflictStart;
      preparedPartMetadata[handleOffset + 5] = conflictEnd;
    }

    return preparedPartMetadata;
  };

  let preparedPartHandles: Int32Array[] = createFilledArray(
    INITIAL_PREPARED_PART_SLOTS,
    UNPREPARABLE_PART,
  );
  let partBaseOffsets = new Int32Array(INITIAL_PREPARED_PART_SLOTS);

  const resetConflictRegistry = (): void => {
    conflictKeyIds.clear();
    modifierIndexes.clear();
    packedKeyIdMemo.clear();
    conflictRowStarts.clear();
    conflictPoolCount = 0;
    nextConflictKeyId = 0;
    preparedPartCache = new Map();
    previousPreparedPartCache = new Map();
    preparedPartCacheCount = 0;
    flushInternTable();
  };

  const mergeClassList = (classList: string): string => {
    const classCount = splitClassList(classList);

    if (classCount === 1) {
      const start = tokenStarts[0]!;
      const end = tokenEnds[0]!;
      return start === 0 && end === classList.length ? classList : classList.slice(start, end);
    }

    if (classCount === 0) {
      return "";
    }

    if (nextConflictKeyId > MAX_CONFLICT_KEYS) resetConflictRegistry();

    currentGeneration = (currentGeneration + 1) | 0;
    if (currentGeneration === 0) currentGeneration = 1;
    const generation = currentGeneration;

    let didDrop = false;
    for (let index = classCount - 1; index >= 0; index -= 1) {
      const start = tokenStarts[index]!;
      const end = tokenEnds[index]!;
      const tokenLength = end - start;
      const tokenHash = tokenHashes[index]!;

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

    if (
      !didDrop &&
      !splitSawNonSpaceWhitespace &&
      classList.length === splitTotalTokenLength + classCount - 1
    ) {
      return classList;
    }

    const internedResult = findInternedResult(classList, classCount);
    if (internedResult !== null) return internedResult;
    if (keptTokenCount === 1) {
      const start = tokenStarts[lastKeptTokenIndex]!;
      const end = tokenEnds[lastKeptTokenIndex]!;
      const interned = getInternedTokenAt(classList, start, end, tokenHashes[lastKeptTokenIndex]!);
      return interned !== null ? interned : classList.slice(start, end);
    }

    let mergedClassName = "";

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
          if (mergedClassName) mergedClassName += SPACE_CHARACTER;
          mergedClassName += classList.slice(runStart, runEnd);
          runStart = start;
        }
        runEnd = end;
      }
      if (runStart !== -1) {
        if (mergedClassName) mergedClassName += SPACE_CHARACTER;
        mergedClassName += classList.slice(runStart, runEnd);
      }
      storeInternedResult(mergedClassName);
      return mergedClassName;
    }

    for (let index = 0; index < classCount; index++) {
      const end = tokenEnds[index]!;
      if (end < 0) continue;
      if (mergedClassName) mergedClassName += SPACE_CHARACTER;
      mergedClassName += classList.slice(tokenStarts[index]!, end);
    }

    storeInternedResult(mergedClassName);
    return mergedClassName;
  };

  const mergePreparedParts = (
    classListParts: readonly string[],
    partCount: number,
    classList: string,
  ): string => {
    if (nextConflictKeyId > MAX_CONFLICT_KEYS) resetConflictRegistry();

    if (partCount > partBaseOffsets.length) {
      let capacity = partBaseOffsets.length;
      while (capacity < partCount) capacity *= 2;
      partBaseOffsets = new Int32Array(capacity);
      const grownPreparedParts: Int32Array[] = createFilledArray(capacity, UNPREPARABLE_PART);
      preparedPartHandles = grownPreparedParts;
    }

    let tokenCount = 0;
    let areAllPartsNormalized = true;
    for (let partIndex = 0; partIndex < partCount; partIndex++) {
      const classListPart = classListParts[partIndex]!;
      let preparedPartMetadata = preparedPartCache.get(classListPart);
      if (preparedPartMetadata === undefined) {
        preparedPartMetadata = previousPreparedPartCache.get(classListPart);
        if (preparedPartMetadata !== undefined) {
          preparedPartCache.set(classListPart, preparedPartMetadata);
        } else {
          preparedPartMetadata = prepareClassListPart(classListPart);
          if (shouldCachePreparedPart(classListPart)) {
            preparedPartCache.set(classListPart, preparedPartMetadata);
            if (++preparedPartCacheCount > PREPARED_PART_CACHE_SIZE) {
              preparedPartCacheCount = 0;
              previousPreparedPartCache = preparedPartCache;
              preparedPartCache = new Map();
            }
          }
        }
      }
      if (preparedPartMetadata === UNPREPARABLE_PART) return mergeClassList(classList);
      preparedPartHandles[partIndex] = preparedPartMetadata;
      tokenCount += preparedPartMetadata[0]!;
      if (preparedPartMetadata[1] === 0) areAllPartsNormalized = false;
    }

    let baseOffset = 0;
    for (let partIndex = 0; partIndex < partCount; partIndex++) {
      partBaseOffsets[partIndex] = baseOffset;
      baseOffset += classListParts[partIndex]!.length + 1;
    }

    if (tokenCount === 0) return "";
    if (tokenCount === 1) {
      for (let partIndex = 0; partIndex < partCount; partIndex++) {
        const preparedPartMetadata = preparedPartHandles[partIndex]!;
        if (preparedPartMetadata[0] === 1) {
          const start = partBaseOffsets[partIndex]! + preparedPartMetadata[2]!;
          const end = partBaseOffsets[partIndex]! + preparedPartMetadata[3]!;
          return start === 0 && end === classList.length ? classList : classList.slice(start, end);
        }
      }
    }

    if (tokenCount > tokenStarts.length) {
      let capacity = tokenStarts.length;
      while (capacity < tokenCount) capacity *= 2;
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

    let didDrop = false;
    let outputIndex = tokenCount - 1;
    for (let partIndex = partCount - 1; partIndex >= 0; partIndex--) {
      const preparedPartMetadata = preparedPartHandles[partIndex]!;
      const baseOffset = partBaseOffsets[partIndex]!;
      for (let tokenIndex = preparedPartMetadata[0]! - 1; tokenIndex >= 0; tokenIndex--) {
        const metadataOffset = 2 + tokenIndex * 6;
        tokenStarts[outputIndex] = baseOffset + preparedPartMetadata[metadataOffset]!;
        const end = baseOffset + preparedPartMetadata[metadataOffset + 1]!;
        tokenHashes[outputIndex] = preparedPartMetadata[metadataOffset + 2]!;

        const classId = preparedPartMetadata[metadataOffset + 3]!;
        if (classId === -1) {
          tokenEnds[outputIndex] = end;
        } else if (claimedGeneration[classId] === generation) {
          tokenEnds[outputIndex] = -end;
          didDrop = true;
        } else {
          claimedGeneration[classId] = generation;
          const conflictEnd = preparedPartMetadata[metadataOffset + 5]!;
          for (
            let poolIndex = preparedPartMetadata[metadataOffset + 4]!;
            poolIndex < conflictEnd;
            poolIndex++
          ) {
            claimedGeneration[conflictPool[poolIndex]!] = generation;
          }
          tokenEnds[outputIndex] = end;
        }
        outputIndex--;
      }
    }

    if (!didDrop && areAllPartsNormalized) return classList;

    const internedResult = findInternedResult(classList, tokenCount);
    if (internedResult !== null) return internedResult;
    if (keptTokenCount === 1) {
      return classList.slice(tokenStarts[lastKeptTokenIndex]!, tokenEnds[lastKeptTokenIndex]!);
    }

    let mergedClassName = "";
    let runStart = -1;
    let runEnd = 0;
    for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex++) {
      const end = tokenEnds[tokenIndex]!;
      if (end < 0) continue;
      const start = tokenStarts[tokenIndex]!;
      if (runStart === -1) {
        runStart = start;
      } else if (start !== runEnd + 1) {
        if (mergedClassName) mergedClassName += SPACE_CHARACTER;
        mergedClassName += classList.slice(runStart, runEnd);
        runStart = start;
      }
      runEnd = end;
    }
    if (runStart !== -1) {
      if (mergedClassName) mergedClassName += SPACE_CHARACTER;
      mergedClassName += classList.slice(runStart, runEnd);
    }
    storeInternedResult(mergedClassName);
    return mergedClassName;
  };

  return { mergeClassList, mergePreparedParts };
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
