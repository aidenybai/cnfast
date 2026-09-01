import {
  CHAR_CLOSE_BRACKET,
  CHAR_CLOSE_PAREN,
  CHAR_DASH,
  CHAR_OPEN_BRACKET,
  CHAR_OPEN_PAREN,
} from "./char-codes.js";
import {
  CLASS_PART_SEPARATOR,
  createClassMap,
  SHAPE_BRACKET,
  SHAPE_OTHER,
  SHAPE_PAREN,
  type ClassPartObject,
} from "./class-map.js";
import { concatArrays } from "../utils/concat-arrays.js";
import { createFilledArray } from "../utils/create-filled-array.js";
import { COLON_CHARACTER } from "./constants.js";
import type { AnyClassGroupIds, AnyConfig } from "./types.js";

const ARBITRARY_PROPERTY_PREFIX = "arbitrary..";

const EMPTY_CONFLICT_ROW: readonly number[] = [];

export const createClassGroupLookup = (config: AnyConfig) => {
  const classMap = createClassMap(config);
  const { conflictingClassGroups, conflictingClassGroupModifiers } = config;

  const getClassGroupId = (className: string): AnyClassGroupIds | undefined => {
    const classNameLength = className.length;
    if (
      classNameLength !== 0 &&
      className.charCodeAt(0) === CHAR_OPEN_BRACKET &&
      className.charCodeAt(classNameLength - 1) === CHAR_CLOSE_BRACKET
    ) {
      return getArbitraryPropertyGroupId(className);
    }

    const classParts = className.split(CLASS_PART_SEPARATOR);
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
  for (const classGroupId in conflictingClassGroups) {
    addGroupIndex(classGroupId);
    for (const conflict of conflictingClassGroups[classGroupId]!) addGroupIndex(conflict);
  }
  for (const classGroupId in conflictingClassGroupModifiers) {
    addGroupIndex(classGroupId);
    for (const conflict of conflictingClassGroupModifiers[classGroupId]!) addGroupIndex(conflict);
  }
  const groupCount = groupIndexes.size;

  const createConflictRow = (classGroupIds: readonly AnyClassGroupIds[]): readonly number[] => {
    if (classGroupIds.length === 0) return EMPTY_CONFLICT_ROW;
    const conflictRow: number[] = [];
    for (let index = 0; index < classGroupIds.length; index++) {
      conflictRow.push(groupIndexes.get(classGroupIds[index]!)!);
    }
    return conflictRow;
  };
  const conflictRowsBase = createFilledArray<readonly number[]>(groupCount, EMPTY_CONFLICT_ROW);
  const conflictRowsPostfix = createFilledArray<readonly number[]>(groupCount, EMPTY_CONFLICT_ROW);
  const groupNames = createFilledArray<AnyClassGroupIds>(groupCount, "");
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
  if (startIndex === classParts.length) {
    return classPartObject.classGroupId;
  }

  const nextClassPartObject = classPartObject.nextPart.get(classParts[startIndex]!);
  if (nextClassPartObject) {
    const classGroupId = getGroupIdRecursive(classParts, startIndex + 1, nextClassPartObject);
    if (classGroupId) return classGroupId;
  }

  const validators = classPartObject.validators;
  if (validators === null) {
    return undefined;
  }

  const remainingClassName =
    startIndex === 0
      ? classParts.join(CLASS_PART_SEPARATOR)
      : classParts.slice(startIndex).join(CLASS_PART_SEPARATOR);

  let classNameShape = SHAPE_OTHER;
  const remainingLength = remainingClassName.length;
  if (remainingLength > 2) {
    const firstCharCode = remainingClassName.charCodeAt(0);
    if (
      firstCharCode === CHAR_OPEN_BRACKET &&
      remainingClassName.charCodeAt(remainingLength - 1) === CHAR_CLOSE_BRACKET
    ) {
      classNameShape = SHAPE_BRACKET;
    } else if (
      firstCharCode === CHAR_OPEN_PAREN &&
      remainingClassName.charCodeAt(remainingLength - 1) === CHAR_CLOSE_PAREN
    ) {
      classNameShape = SHAPE_PAREN;
    }
  }

  for (let index = 0; index < validators.length; index++) {
    const validatorObject = validators[index]!;
    if (
      (validatorObject.shapeMask & classNameShape) !== 0 &&
      validatorObject.validator(remainingClassName)
    ) {
      return validatorObject.classGroupId;
    }
  }

  return undefined;
};

const getArbitraryPropertyGroupId = (className: string): AnyClassGroupIds | undefined => {
  const arbitraryProperty = className.slice(1, -1);
  const colonIndex = arbitraryProperty.indexOf(COLON_CHARACTER);
  if (colonIndex === -1) {
    return undefined;
  }
  const propertyName = arbitraryProperty.slice(0, colonIndex);
  return propertyName ? ARBITRARY_PROPERTY_PREFIX + propertyName : undefined;
};
