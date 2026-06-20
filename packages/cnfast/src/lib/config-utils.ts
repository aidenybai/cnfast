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
  isExternal: boolean;
  /** Interned integer ID of this class's conflict key `{modifierId}{classGroupId}`. */
  classId: number;
  /** Interned integer IDs of the conflict keys `{modifierId}{conflictGroupId}` this class overrides. */
  conflictIds: number[];
}

const EXTERNAL_DESCRIPTOR: ClassDescriptor = { isExternal: true, classId: -1, conflictIds: [] };

/**
 * Per-token descriptor cache capacity (entries). Larger than the whole-string LRU because
 * individual tokens are far more numerous but cheap to store; the LRU bound prevents
 * unbounded growth when callers pass dynamically generated arbitrary values (e.g. `w-[123px]`).
 */
const DESCRIPTOR_CACHE_SIZE = 4096;

export const createConfigUtils = (config: AnyConfig) => {
  const sortModifiers = createSortModifiers(config);
  const postfixLookupClassGroupIds = createPostfixLookupClassGroupIds(config);
  const { getClassGroupId, getConflictingClassGroupIds } = createClassGroupUtils(config);

  // Descriptor cache is the hottest lookup in the engine (once per token in `mergeClassList`).
  // It inlines a two-generation null-prototype LRU directly here (no get/set abstraction) so the
  // merge loop avoids an extra method-call hop per token.
  let descriptorCache: Record<string, ClassDescriptor> = Object.create(null);
  let previousDescriptorCache: Record<string, ClassDescriptor> = Object.create(null);
  let descriptorCacheSize = 0;

  // `mergeClassList` compares interned integer IDs instead of hashing conflict-key strings on
  // every token. `internConflictKey` assigns each `{modifierId}{classGroupId}` pair a dense
  // integer; the registry is permanent (never evicted) so a key keeps its ID even after its
  // descriptor leaves the LRU above. Growth is bounded by distinct pairs, NOT arbitrary values
  // (`w-[123px]` → group `w`), so it stays small in practice.
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

  // Set by `splitClassList` when a run of whitespace contains a non-space character (tab/LF/etc).
  // The no-op shortcut in `mergeClassList` can only return the raw input when every separator is a
  // plain space, since the rebuild always joins with `" "`.
  let splitSawNonSpaceWhitespace = false;

  // Splits on runs of ASCII whitespace (space, tab, LF, VT, FF, CR) the same way `/\s+/` does for
  // any realistic class string, while skipping leading/trailing runs so no separate `trim()` pass
  // (and its string allocation) is needed. Tailwind class tokens are ASCII, so this never diverges
  // from the reference on real input; the parity + fuzz suites guard against regressions.
  const splitClassList = (classList: string): string[] => {
    const tokens: string[] = [];
    const length = classList.length;
    let tokenStart = -1;
    splitSawNonSpaceWhitespace = false;

    for (let index = 0; index < length; index++) {
      const charCode = classList.charCodeAt(index);

      if (charCode === 32) {
        if (tokenStart !== -1) {
          tokens.push(classList.slice(tokenStart, index));
          tokenStart = -1;
        }
      } else if (charCode >= 9 && charCode <= 13) {
        splitSawNonSpaceWhitespace = true;
        if (tokenStart !== -1) {
          tokens.push(classList.slice(tokenStart, index));
          tokenStart = -1;
        }
      } else if (tokenStart === -1) {
        tokenStart = index;
      }
    }

    if (tokenStart !== -1) {
      tokens.push(classList.slice(tokenStart));
    }

    return tokens;
  };

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

  const computeClassDescriptor = (originalClassName: string): ClassDescriptor => {
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

    const conflictGroups = getConflictingClassGroupIds(classGroupId, hasPostfixModifier);
    const conflictIds: number[] = [];
    for (let index = 0; index < conflictGroups.length; index++) {
      conflictIds.push(internConflictKey(modifierId + conflictGroups[index]!));
    }

    return {
      isExternal: false,
      classId: internConflictKey(modifierId + classGroupId),
      conflictIds,
    };
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
    const classNames = splitClassList(classList);
    const classCount = classNames.length;

    // A single token cannot conflict with itself, so it is always kept verbatim. ~60% of real class
    // lists reduce to one token, and this skips descriptor resolution (including a full compute on a
    // cache miss), conflict tracking, and the rebuild for all of them. Empty input (`classCount` 0)
    // falls through: the loops below no-op and the rebuild returns "".
    if (classCount === 1) {
      return classNames[0]!;
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
    // `tokenCharCount` accumulates every token's length (kept or dropped) so the no-op shortcut
    // below can tell whether the input was already normalized without a second scan.
    let didDrop = false;
    let tokenCharCount = 0;
    for (let index = classCount - 1; index >= 0; index -= 1) {
      const className = classNames[index]!;
      tokenCharCount += className.length;
      const descriptor = getClassDescriptor(className);

      if (descriptor.isExternal) {
        keepFlags[index] = 1;
        continue;
      }

      const classId = descriptor.classId;
      if (claimedGeneration[classId] === generation) {
        keepFlags[index] = 0;
        didDrop = true;
        continue;
      }

      claimedGeneration[classId] = generation;
      const conflictIds = descriptor.conflictIds;
      for (let conflictIndex = 0; conflictIndex < conflictIds.length; conflictIndex++) {
        claimedGeneration[conflictIds[conflictIndex]!] = generation;
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
      classList.length === tokenCharCount + classCount - 1
    ) {
      return classList;
    }

    // Pass 2, left-to-right: emit kept tokens in source order (no reversal needed).
    let result = "";
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
