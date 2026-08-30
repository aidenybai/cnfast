import {
  CHAR_CLOSE_BRACKET,
  CHAR_CLOSE_PAREN,
  CHAR_DASH,
  CHAR_OPEN_BRACKET,
  CHAR_OPEN_PAREN,
} from "./char-codes";
import {
  CLASS_PART_SEPARATOR,
  ClassPartObject,
  createClassMap,
  SHAPE_BRACKET,
  SHAPE_OTHER,
  SHAPE_PAREN,
} from "./class-map";
import { AnyClassGroupIds, AnyConfig } from "./types";
import { concatArrays } from "../utils/concat-arrays";

// Two dots because a single dot is the class-group prefix used by plugins.
const ARBITRARY_PROPERTY_PREFIX = "arbitrary..";

const EMPTY_CONFLICT_ROW: readonly number[] = [];

/**
 * Build the class-name -> class-group lookup for one config, plus dense integer group ids with
 * precomputed conflict rows.
 *
 * The dense ids exist because IC profiling showed the reference's string-keyed
 * `conflictingClassGroups[classGroupId]` loads were 294 of the library's 303 megamorphic sites.
 * Enumerating every group once at build time turns each steady-state conflict lookup into an
 * array-index load, and lets the descriptor layer memoize interned conflict keys under packed
 * numeric (modifierIndex, groupIndex) keys instead of concatenating and hashing a string per
 * lookup. Groups minted dynamically (`[color:red]` -> `arbitrary..color`) never have conflict
 * rows and are deliberately not interned, so the map stays fixed-size for the config's life.
 */
export const createClassGroupLookup = (config: AnyConfig) => {
  const classMap = createClassMap(config);
  const { conflictingClassGroups, conflictingClassGroupModifiers } = config;

  const getClassGroupId = (className: string): AnyClassGroupIds | undefined => {
    const length = className.length;
    if (
      length !== 0 &&
      className.charCodeAt(0) === CHAR_OPEN_BRACKET &&
      className.charCodeAt(length - 1) === CHAR_CLOSE_BRACKET
    ) {
      return getArbitraryPropertyGroupId(className);
    }

    const classParts = className.split(CLASS_PART_SEPARATOR);
    // A leading `-` (negative value, `-inset-1`) yields an empty first part; skip it.
    const startIndex = classParts.length > 1 && className.charCodeAt(0) === CHAR_DASH ? 1 : 0;
    return getGroupIdRecursive(classParts, startIndex, classMap);
  };

  const getConflictingGroupIds = (
    classGroupId: AnyClassGroupIds,
    hasPostfixModifier: boolean,
  ): readonly AnyClassGroupIds[] => {
    const baseConflicts = conflictingClassGroups[classGroupId];
    if (hasPostfixModifier) {
      const modifierConflicts = conflictingClassGroupModifiers[classGroupId];
      if (modifierConflicts) {
        return baseConflicts ? concatArrays(baseConflicts, modifierConflicts) : modifierConflicts;
      }
    }
    return baseConflicts || EMPTY_CONFLICT_ROW_IDS;
  };

  const groupIndexes = new Map<AnyClassGroupIds, number>();
  const addGroupIndex = (classGroupId: AnyClassGroupIds): void => {
    if (!groupIndexes.has(classGroupId)) {
      groupIndexes.set(classGroupId, groupIndexes.size);
    }
  };
  for (const classGroupId in config.classGroups) {
    addGroupIndex(classGroupId);
  }
  // Exotic custom configs may name conflict groups that have no class definitions; index those
  // too so every row entry below resolves.
  for (const classGroupId in conflictingClassGroups) {
    addGroupIndex(classGroupId);
    for (const conflict of conflictingClassGroups[classGroupId]!) addGroupIndex(conflict);
  }
  for (const classGroupId in conflictingClassGroupModifiers) {
    addGroupIndex(classGroupId);
    for (const conflict of conflictingClassGroupModifiers[classGroupId]!) addGroupIndex(conflict);
  }
  const groupCount = groupIndexes.size;

  const createConflictRow = (ids: readonly AnyClassGroupIds[]): readonly number[] => {
    if (ids.length === 0) return EMPTY_CONFLICT_ROW;
    const row: number[] = new Array(ids.length);
    for (let i = 0; i < ids.length; i++) row[i] = groupIndexes.get(ids[i]!)!;
    return row;
  };
  const conflictRowsBase: (readonly number[])[] = new Array(groupCount);
  const conflictRowsPostfix: (readonly number[])[] = new Array(groupCount);
  const groupNames: AnyClassGroupIds[] = new Array(groupCount);
  for (const [classGroupId, groupIndex] of groupIndexes) {
    groupNames[groupIndex] = classGroupId;
    conflictRowsBase[groupIndex] = createConflictRow(getConflictingGroupIds(classGroupId, false));
    conflictRowsPostfix[groupIndex] = createConflictRow(getConflictingGroupIds(classGroupId, true));
  }

  return {
    getClassGroupId,
    groupIndexes,
    groupCount,
    groupNames,
    conflictRowsBase,
    conflictRowsPostfix,
  };
};

const EMPTY_CONFLICT_ROW_IDS: readonly AnyClassGroupIds[] = [];

const getGroupIdRecursive = (
  classParts: string[],
  startIndex: number,
  classPartObject: ClassPartObject,
): AnyClassGroupIds | undefined => {
  if (classParts.length - startIndex === 0) {
    return classPartObject.classGroupId;
  }

  const nextClassPartObject = classPartObject.nextPart.get(classParts[startIndex]!);
  if (nextClassPartObject) {
    const result = getGroupIdRecursive(classParts, startIndex + 1, nextClassPartObject);
    if (result) return result;
  }

  const validators = classPartObject.validators;
  if (validators === null) {
    return undefined;
  }

  const classRest =
    startIndex === 0
      ? classParts.join(CLASS_PART_SEPARATOR)
      : classParts.slice(startIndex).join(CLASS_PART_SEPARATOR);

  // Classify the candidate's shape once so one integer AND per validator can skip the parsers
  // that cannot match it (see SHAPE_* in class-map.ts). The `> 2` guard mirrors the arbitrary
  // parsers' minimum match (`[x]`), so `[]` counts as SHAPE_OTHER.
  let shape = SHAPE_OTHER;
  const restLength = classRest.length;
  if (restLength > 2) {
    const firstCharCode = classRest.charCodeAt(0);
    if (
      firstCharCode === CHAR_OPEN_BRACKET &&
      classRest.charCodeAt(restLength - 1) === CHAR_CLOSE_BRACKET
    ) {
      shape = SHAPE_BRACKET;
    } else if (
      firstCharCode === CHAR_OPEN_PAREN &&
      classRest.charCodeAt(restLength - 1) === CHAR_CLOSE_PAREN
    ) {
      shape = SHAPE_PAREN;
    }
  }

  for (let i = 0; i < validators.length; i++) {
    const validatorObject = validators[i]!;
    if ((validatorObject.shapeMask & shape) !== 0 && validatorObject.validator(classRest)) {
      return validatorObject.classGroupId;
    }
  }

  return undefined;
};

// `className` is guaranteed by the caller to start with `[` and end with `]`.
const getArbitraryPropertyGroupId = (className: string): AnyClassGroupIds | undefined => {
  const content = className.slice(1, -1);
  const colonIndex = content.indexOf(":");
  if (colonIndex === -1) {
    return undefined;
  }
  const property = content.slice(0, colonIndex);
  return property ? ARBITRARY_PROPERTY_PREFIX + property : undefined;
};
