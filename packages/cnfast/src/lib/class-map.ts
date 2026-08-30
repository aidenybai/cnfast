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
import {
  AnyClassGroupIds,
  AnyThemeGroupIds,
  ClassGroup,
  ClassValidator,
  Config,
  ThemeGetter,
  ThemeObject,
} from "./types";

export const CLASS_PART_SEPARATOR = "-";

/**
 * One node of the class-name trie. `bg-red-500` walks bg -> red -> 500; a node's `classGroupId`
 * answers exact matches and its `validators` answer dynamic remainders (`bg-[url(...)]`).
 */
export interface ClassPartObject {
  nextPart: Map<string, ClassPartObject>;
  validators: ClassValidatorObject[] | null;
  classGroupId: AnyClassGroupIds | undefined;
}

export interface ClassValidatorObject {
  classGroupId: AnyClassGroupIds;
  validator: ClassValidator;
  shapeMask: number;
}

/**
 * Token shapes for validator gating. A trie node can carry ~17 validators (`bg-` does), yet most
 * can only ever match one shape: the `isArbitraryValue` family demands `[...]`, the
 * `isArbitraryVariable` family `(...)`, and the plain-value validators can match neither.
 * Tagging each validator with the shapes it could match lets the lookup loop skip the rest with
 * one integer test instead of running every parser.
 */
export const SHAPE_BRACKET = 1; // [ ... ] with at least one inner char
export const SHAPE_PAREN = 2; // ( ... ) with at least one inner char
export const SHAPE_OTHER = 4;
export const SHAPE_ALL = SHAPE_BRACKET | SHAPE_PAREN | SHAPE_OTHER;

// Masks must be a SUPERSET of matchability: a validator may only be skipped when it provably
// cannot match the shape. `isAnyNonArbitrary` stays SHAPE_ALL because a `[...]`-shaped token
// containing a line terminator fails both arbitrary parsers and therefore IS "non-arbitrary"
// despite its bracket shape. Validators from custom `createCn` configs are unknown here, default
// to SHAPE_ALL, and are never skipped.
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
  [isFraction, SHAPE_OTHER],
  [isNumber, SHAPE_OTHER],
  [isInteger, SHAPE_OTHER],
  [isPercent, SHAPE_OTHER],
  [isTshirtSize, SHAPE_OTHER],
  [isNamedContainerQuery, SHAPE_OTHER],
  [isAny, SHAPE_ALL],
  [isAnyNonArbitrary, SHAPE_ALL],
]);

const createClassValidatorObject = (
  classGroupId: AnyClassGroupIds,
  validator: ClassValidator,
): ClassValidatorObject => ({
  classGroupId,
  validator,
  shapeMask: VALIDATOR_SHAPE_MASKS.get(validator) ?? SHAPE_ALL,
});

const createClassPartObject = (): ClassPartObject => ({
  nextPart: new Map(),
  validators: null,
  classGroupId: undefined,
});

export const createClassMap = (
  config: Config<AnyClassGroupIds, AnyThemeGroupIds>,
): ClassPartObject => {
  const { theme, classGroups } = config;
  const classMap = createClassPartObject();

  for (const classGroupId in classGroups) {
    addClassGroup(classGroups[classGroupId]!, classMap, classGroupId, theme);
  }

  return classMap;
};

const addClassGroup = (
  classGroup: ClassGroup<AnyThemeGroupIds>,
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
  theme: ThemeObject<AnyThemeGroupIds>,
): void => {
  for (let i = 0; i < classGroup.length; i++) {
    addClassDefinition(classGroup[i]!, classPartObject, classGroupId, theme);
  }
};

// One dispatch function per definition type keeps each call site monomorphic.
const addClassDefinition = (
  classDefinition: ClassGroup<AnyThemeGroupIds>[number],
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
  theme: ThemeObject<AnyThemeGroupIds>,
): void => {
  if (typeof classDefinition === "string") {
    addStringDefinition(classDefinition, classPartObject, classGroupId);
    return;
  }

  if (typeof classDefinition === "function") {
    addFunctionDefinition(classDefinition, classPartObject, classGroupId, theme);
    return;
  }

  addObjectDefinition(
    classDefinition as Record<string, ClassGroup<AnyThemeGroupIds>>,
    classPartObject,
    classGroupId,
    theme,
  );
};

const addStringDefinition = (
  classDefinition: string,
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
): void => {
  const target =
    classDefinition === "" ? classPartObject : getPart(classPartObject, classDefinition);
  target.classGroupId = classGroupId;
};

const addFunctionDefinition = (
  classDefinition: ClassValidator | ThemeGetter,
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
  theme: ThemeObject<AnyThemeGroupIds>,
): void => {
  if (isThemeGetter(classDefinition)) {
    addClassGroup(classDefinition(theme), classPartObject, classGroupId, theme);
    return;
  }

  if (classPartObject.validators === null) {
    classPartObject.validators = [];
  }
  classPartObject.validators.push(
    createClassValidatorObject(classGroupId, classDefinition as ClassValidator),
  );
};

const addObjectDefinition = (
  classDefinition: Record<string, ClassGroup<AnyThemeGroupIds>>,
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
  theme: ThemeObject<AnyThemeGroupIds>,
): void => {
  const entries = Object.entries(classDefinition);
  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i]!;
    addClassGroup(value, getPart(classPartObject, key), classGroupId, theme);
  }
};

const getPart = (classPartObject: ClassPartObject, path: string): ClassPartObject => {
  let current = classPartObject;
  const parts = path.split(CLASS_PART_SEPARATOR);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
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
