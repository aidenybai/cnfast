import {
  AnyClassGroupIds,
  AnyConfig,
  AnyThemeGroupIds,
  ClassGroup,
  ClassValidator,
  Config,
  ThemeGetter,
  ThemeObject,
} from "./types";
import { concatArrays } from "./utils";
import {
  isAny,
  isAnyNonArbitrary,
  isArbitraryFamilyName,
  isArbitraryImage,
  isArbitraryLength,
  isArbitraryNumber,
  isArbitraryPosition,
  isArbitraryShadow,
  isArbitrarySize,
  isArbitraryValue,
  isArbitraryVariable,
  isArbitraryVariableFamilyName,
  isArbitraryVariableImage,
  isArbitraryVariableLength,
  isArbitraryVariablePosition,
  isArbitraryVariableShadow,
  isArbitraryVariableSize,
  isArbitraryVariableWeight,
  isArbitraryWeight,
  isFraction,
  isInteger,
  isNamedContainerQuery,
  isNumber,
  isPercent,
  isTshirtSize,
} from "./validators";

export interface ClassPartObject {
  nextPart: Map<string, ClassPartObject>;
  validators: ClassValidatorObject[] | null;
  classGroupId: AnyClassGroupIds | undefined; // Always define optional props for consistent shape
}

interface ClassValidatorObject {
  classGroupId: AnyClassGroupIds;
  validator: ClassValidator;
  /** Shape-gate: bitmask of token shapes (SHAPE_*) this validator could possibly match. */
  shapeMask: number;
}

// Token shape classes for validator shape-gating. A node's validator chain runs both anchored
// arbitrary parsers on every candidate (`bg-` alone carries ~17 validators), yet most validators
// can only ever match one first/last-char shape: the `isArbitraryValue` family demands `[...]`,
// the `isArbitraryVariable` family `(...)`, and the plain-value validators (`isNumber`,
// `isPercent`, ...) can never match either bracket shape. Annotating each validator with a mask
// at classMap build time lets the lookup loop skip impossible validators with one integer test.
const SHAPE_BRACKET = 1; // `[` ... `]`, at least one inner char
const SHAPE_PAREN = 2; // `(` ... `)`, at least one inner char
const SHAPE_OTHER = 4; // everything else
const SHAPE_ALL = SHAPE_BRACKET | SHAPE_PAREN | SHAPE_OTHER;
// Not `[...]`/`(...)` shaped. Safe for validators whose match demands a first/last char the
// bracket shapes can't provide (digit/letter/%/@ starts, %/letter ends, `Number()` parses).
const SHAPE_NOT_ARBITRARY = SHAPE_OTHER;

// Masks are a SUPERSET of matchability: skipping is only allowed when a validator provably cannot
// return true for the shape. Notably `isAnyNonArbitrary` stays SHAPE_ALL: a `[...]`-shaped token
// containing a line terminator fails both arbitrary parsers (`.` excludes line terminators), so it
// CAN be "non-arbitrary" despite its bracket shape. Unknown validators (custom `createCn`
// configs) default to SHAPE_ALL and are never skipped.
const VALIDATOR_SHAPE_MASKS = new Map<ClassValidator, number>([
  [isArbitraryValue, SHAPE_BRACKET],
  [isArbitrarySize, SHAPE_BRACKET],
  [isArbitraryLength, SHAPE_BRACKET],
  [isArbitraryNumber, SHAPE_BRACKET],
  [isArbitraryWeight, SHAPE_BRACKET],
  [isArbitraryFamilyName, SHAPE_BRACKET],
  [isArbitraryPosition, SHAPE_BRACKET],
  [isArbitraryImage, SHAPE_BRACKET],
  [isArbitraryShadow, SHAPE_BRACKET],
  [isArbitraryVariable, SHAPE_PAREN],
  [isArbitraryVariableLength, SHAPE_PAREN],
  [isArbitraryVariableFamilyName, SHAPE_PAREN],
  [isArbitraryVariablePosition, SHAPE_PAREN],
  [isArbitraryVariableSize, SHAPE_PAREN],
  [isArbitraryVariableImage, SHAPE_PAREN],
  [isArbitraryVariableShadow, SHAPE_PAREN],
  [isArbitraryVariableWeight, SHAPE_PAREN],
  [isFraction, SHAPE_NOT_ARBITRARY], // `^\d`...`\d$`
  [isNumber, SHAPE_NOT_ARBITRARY], // Number("[...]"/"(...)") is always NaN
  [isInteger, SHAPE_NOT_ARBITRARY],
  [isPercent, SHAPE_NOT_ARBITRARY], // must end with `%`
  [isTshirtSize, SHAPE_NOT_ARBITRARY], // must end with a size letter
  [isNamedContainerQuery, SHAPE_NOT_ARBITRARY], // must start with `@`
  [isAny, SHAPE_ALL],
  [isAnyNonArbitrary, SHAPE_ALL],
]);

// Factory function ensures consistent object shapes
const createClassValidatorObject = (
  classGroupId: AnyClassGroupIds,
  validator: ClassValidator,
): ClassValidatorObject => ({
  classGroupId,
  validator,
  shapeMask: VALIDATOR_SHAPE_MASKS.get(validator) ?? SHAPE_ALL,
});

// Factory ensures consistent ClassPartObject shape
const createClassPartObject = (
  nextPart: Map<string, ClassPartObject> = new Map(),
  validators: ClassValidatorObject[] | null = null,
  classGroupId?: AnyClassGroupIds,
): ClassPartObject => ({
  nextPart,
  validators,
  classGroupId,
});

const CLASS_PART_SEPARATOR = "-";

const EMPTY_CONFLICTS: readonly AnyClassGroupIds[] = [];
// Two dots because a single dot is the class-group prefix used by plugins.
const ARBITRARY_PROPERTY_PREFIX = "arbitrary..";

const EMPTY_CONFLICT_ROW: readonly number[] = [];

export const createClassGroupUtils = (config: AnyConfig) => {
  const classMap = createClassMap(config);
  const { conflictingClassGroups, conflictingClassGroupModifiers } = config;

  const getClassGroupId = (className: string) => {
    // `charCodeAt` compares instead of `className[0] === "["`: one-char string indexing
    // materializes a string and was a recorded "wrong map" deopt source on this path. The length
    // guard keeps the reads in bounds for the empty base name (deopt-free slow-path avoidance).
    const length = className.length;
    if (
      length !== 0 &&
      className.charCodeAt(0) === 91 /* "[" */ &&
      className.charCodeAt(length - 1) === 93 /* "]" */
    ) {
      return getGroupIdForArbitraryProperty(className);
    }

    const classParts = className.split(CLASS_PART_SEPARATOR);
    // Classes like `-inset-1` produce an empty string as first classPart (equivalently: the class
    // starts with `-`). We assume that classes for negative values are used correctly and skip it.
    const startIndex = classParts.length > 1 && className.charCodeAt(0) === 45 /* "-" */ ? 1 : 0;
    return getGroupRecursive(classParts, startIndex, classMap);
  };

  const getConflictingClassGroupIds = (
    classGroupId: AnyClassGroupIds,
    hasPostfixModifier: boolean,
  ): readonly AnyClassGroupIds[] => {
    if (hasPostfixModifier) {
      const modifierConflicts = conflictingClassGroupModifiers[classGroupId];
      const baseConflicts = conflictingClassGroups[classGroupId];

      if (modifierConflicts) {
        if (baseConflicts) {
          return concatArrays(baseConflicts, modifierConflicts);
        }
        return modifierConflicts;
      }
      return baseConflicts || EMPTY_CONFLICTS;
    }

    return conflictingClassGroups[classGroupId] || EMPTY_CONFLICTS;
  };

  // Dense integer IDs for every class group named in the config. IC profiling showed the
  // string-keyed `conflictingClassGroups[classGroupId]` loads were 294 of 303 megamorphic sites
  // in the library; enumerating the groups once at config-build time turns every steady-state
  // conflict lookup into a monomorphic array-index load and lets the descriptor layer memoize
  // interned conflict-key IDs under packed numeric `(modifierIndex, groupIndex)` keys instead of
  // concatenating + hashing a string per conflict. Group IDs minted dynamically at lookup time
  // (`[color:red]` -> `arbitrary..color`) are deliberately NOT interned: they never have conflict
  // rows, so callers use their string path and this map stays fixed-size for the config's life.
  const groupIndexes = new Map<AnyClassGroupIds, number>();
  const internGroupIndex = (classGroupId: AnyClassGroupIds): number => {
    let index = groupIndexes.get(classGroupId);
    if (index === undefined) {
      index = groupIndexes.size;
      groupIndexes.set(classGroupId, index);
    }
    return index;
  };
  for (const classGroupId in config.classGroups) {
    internGroupIndex(classGroupId);
  }
  // Conflict values may (in exotic custom configs) name groups that have no class definitions;
  // intern those too so every row entry below resolves to an index.
  for (const classGroupId in conflictingClassGroups) {
    internGroupIndex(classGroupId);
    for (const conflict of conflictingClassGroups[classGroupId]!) internGroupIndex(conflict);
  }
  for (const classGroupId in conflictingClassGroupModifiers) {
    internGroupIndex(classGroupId);
    for (const conflict of conflictingClassGroupModifiers[classGroupId]!) {
      internGroupIndex(conflict);
    }
  }
  const groupCount = groupIndexes.size;

  // Precomputed per-group conflict rows as packed index arrays, one variant per
  // `hasPostfixModifier` value, mirroring `getConflictingClassGroupIds` exactly (including the
  // base-then-modifier concat order). Indexed by group index; rows share `EMPTY_CONFLICT_ROW` so
  // conflict-free groups cost nothing.
  const toConflictRow = (ids: readonly AnyClassGroupIds[] | undefined): readonly number[] => {
    if (!ids || ids.length === 0) return EMPTY_CONFLICT_ROW;
    const row: number[] = new Array(ids.length);
    for (let index = 0; index < ids.length; index++) row[index] = groupIndexes.get(ids[index]!)!;
    return row;
  };
  const conflictRowsBase: (readonly number[])[] = new Array(groupCount);
  const conflictRowsPostfix: (readonly number[])[] = new Array(groupCount);
  const groupNames: AnyClassGroupIds[] = new Array(groupCount);
  for (const [classGroupId, groupIndex] of groupIndexes) {
    groupNames[groupIndex] = classGroupId;
    conflictRowsBase[groupIndex] = toConflictRow(conflictingClassGroups[classGroupId]);
    conflictRowsPostfix[groupIndex] = toConflictRow(
      getConflictingClassGroupIds(classGroupId, true),
    );
  }

  return {
    getClassGroupId,
    getConflictingClassGroupIds,
    groupIndexes,
    groupCount,
    groupNames,
    conflictRowsBase,
    conflictRowsPostfix,
  };
};

const getGroupRecursive = (
  classParts: string[],
  startIndex: number,
  classPartObject: ClassPartObject,
): AnyClassGroupIds | undefined => {
  const remainingPartCount = classParts.length - startIndex;
  if (remainingPartCount === 0) {
    return classPartObject.classGroupId;
  }

  const currentClassPart = classParts[startIndex]!;
  const nextClassPartObject = classPartObject.nextPart.get(currentClassPart);

  if (nextClassPartObject) {
    const result = getGroupRecursive(classParts, startIndex + 1, nextClassPartObject);
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
  const validatorsLength = validators.length;

  // Classify the candidate's shape once, then let one integer AND per validator skip the ones
  // that can't match it (see VALIDATOR_SHAPE_MASKS). The `> 2` guard mirrors the arbitrary
  // parsers' minimum match length (`[x]`), so e.g. `[]` counts as SHAPE_OTHER.
  let shape = SHAPE_OTHER;
  const restLength = classRest.length;
  if (restLength > 2) {
    const firstCharCode = classRest.charCodeAt(0);
    if (firstCharCode === 91 /* "[" */ && classRest.charCodeAt(restLength - 1) === 93 /* "]" */) {
      shape = SHAPE_BRACKET;
    } else if (
      firstCharCode === 40 /* "(" */ &&
      classRest.charCodeAt(restLength - 1) === 41 /* ")" */
    ) {
      shape = SHAPE_PAREN;
    }
  }

  for (let index = 0; index < validatorsLength; index++) {
    const validatorObject = validators[index]!;
    if ((validatorObject.shapeMask & shape) !== 0 && validatorObject.validator(classRest)) {
      return validatorObject.classGroupId;
    }
  }

  return undefined;
};

// `className` is expected to start with `[` and end with `]` (the caller guarantees it).
const getGroupIdForArbitraryProperty = (className: string): AnyClassGroupIds | undefined => {
  const content = className.slice(1, -1);
  const colonIndex = content.indexOf(":");
  if (colonIndex === -1) {
    return undefined;
  }
  const property = content.slice(0, colonIndex);
  return property ? ARBITRARY_PROPERTY_PREFIX + property : undefined;
};

/**
 * Exported for testing only
 */
export const createClassMap = (config: Config<AnyClassGroupIds, AnyThemeGroupIds>) => {
  const { theme, classGroups } = config;
  return processClassGroups(classGroups, theme);
};

// Split into separate functions to maintain monomorphic call sites
const processClassGroups = (
  classGroups: Record<AnyClassGroupIds, ClassGroup<AnyThemeGroupIds>>,
  theme: ThemeObject<AnyThemeGroupIds>,
): ClassPartObject => {
  const classMap = createClassPartObject();

  for (const classGroupId in classGroups) {
    const group = classGroups[classGroupId]!;
    processClassesRecursively(group, classMap, classGroupId, theme);
  }

  return classMap;
};

const processClassesRecursively = (
  classGroup: ClassGroup<AnyThemeGroupIds>,
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
  theme: ThemeObject<AnyThemeGroupIds>,
) => {
  const length = classGroup.length;
  for (let index = 0; index < length; index++) {
    const classDefinition = classGroup[index]!;
    processClassDefinition(classDefinition, classPartObject, classGroupId, theme);
  }
};

// Split into separate functions for each type to maintain monomorphic call sites
const processClassDefinition = (
  classDefinition: ClassGroup<AnyThemeGroupIds>[number],
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
  theme: ThemeObject<AnyThemeGroupIds>,
) => {
  if (typeof classDefinition === "string") {
    processStringDefinition(classDefinition, classPartObject, classGroupId);
    return;
  }

  if (typeof classDefinition === "function") {
    processFunctionDefinition(classDefinition, classPartObject, classGroupId, theme);
    return;
  }

  processObjectDefinition(
    classDefinition as Record<string, ClassGroup<AnyThemeGroupIds>>,
    classPartObject,
    classGroupId,
    theme,
  );
};

const processStringDefinition = (
  classDefinition: string,
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
) => {
  const classPartObjectToEdit =
    classDefinition === "" ? classPartObject : getPart(classPartObject, classDefinition);
  classPartObjectToEdit.classGroupId = classGroupId;
};

const processFunctionDefinition = (
  classDefinition: ClassValidator | ThemeGetter,
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
  theme: ThemeObject<AnyThemeGroupIds>,
) => {
  if (isThemeGetter(classDefinition)) {
    processClassesRecursively(classDefinition(theme), classPartObject, classGroupId, theme);
    return;
  }

  if (classPartObject.validators === null) {
    classPartObject.validators = [];
  }
  classPartObject.validators.push(
    createClassValidatorObject(classGroupId, classDefinition as ClassValidator),
  );
};

const processObjectDefinition = (
  classDefinition: Record<string, ClassGroup<AnyThemeGroupIds>>,
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
  theme: ThemeObject<AnyThemeGroupIds>,
) => {
  const entries = Object.entries(classDefinition);
  const length = entries.length;
  for (let index = 0; index < length; index++) {
    const [key, value] = entries[index]!;
    processClassesRecursively(value, getPart(classPartObject, key), classGroupId, theme);
  }
};

const getPart = (classPartObject: ClassPartObject, path: string): ClassPartObject => {
  let current = classPartObject;
  const parts = path.split(CLASS_PART_SEPARATOR);
  const length = parts.length;

  for (let index = 0; index < length; index++) {
    const part = parts[index]!;

    let next = current.nextPart.get(part);
    if (!next) {
      next = createClassPartObject();
      current.nextPart.set(part, next);
    }
    current = next;
  }

  return current;
};

const isThemeGetter = (
  classDefinition: ClassValidator | ThemeGetter,
): classDefinition is ThemeGetter =>
  "isThemeGetter" in classDefinition && (classDefinition as ThemeGetter).isThemeGetter === true;
