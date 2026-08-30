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
import { createFilledArray } from "../utils/create-filled-array";
import { COLON_CHARACTER } from "./constants";

const ARBITRARY_PROPERTY_PREFIX = "arbitrary..";

const EMPTY_CONFLICT_ROW: readonly number[] = [];

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

  let classNameShape = SHAPE_OTHER;
  const restLength = classRest.length;
  if (restLength > 2) {
    const firstCharCode = classRest.charCodeAt(0);
    if (
      firstCharCode === CHAR_OPEN_BRACKET &&
      classRest.charCodeAt(restLength - 1) === CHAR_CLOSE_BRACKET
    ) {
      classNameShape = SHAPE_BRACKET;
    } else if (
      firstCharCode === CHAR_OPEN_PAREN &&
      classRest.charCodeAt(restLength - 1) === CHAR_CLOSE_PAREN
    ) {
      classNameShape = SHAPE_PAREN;
    }
  }

  for (let index = 0; index < validators.length; index++) {
    const validatorObject = validators[index]!;
    if (
      (validatorObject.shapeMask & classNameShape) !== 0 &&
      validatorObject.validator(classRest)
    ) {
      return validatorObject.classGroupId;
    }
  }

  return undefined;
};

const getArbitraryPropertyGroupId = (className: string): AnyClassGroupIds | undefined => {
  const content = className.slice(1, -1);
  const colonIndex = content.indexOf(COLON_CHARACTER);
  if (colonIndex === -1) {
    return undefined;
  }
  const property = content.slice(0, colonIndex);
  return property ? ARBITRARY_PROPERTY_PREFIX + property : undefined;
};
