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
} from "./validators.js";
import type {
  AnyClassGroupIds,
  AnyThemeGroupIds,
  ClassGroup,
  ClassValidator,
  Config,
  ThemeReference,
  ThemeObject,
} from "./types.js";

export const CLASS_PART_SEPARATOR = "-";

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

export const SHAPE_BRACKET = 1;
export const SHAPE_PAREN = 2;
export const SHAPE_OTHER = 4;
export const SHAPE_ALL = SHAPE_BRACKET | SHAPE_PAREN | SHAPE_OTHER;

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

const EMPTY_CLASS_GROUP: ClassGroup<AnyThemeGroupIds> = [];

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
  for (let index = 0; index < classGroup.length; index++) {
    addClassDefinition(classGroup[index]!, classPartObject, classGroupId, theme);
  }
};

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
    addValidatorDefinition(classDefinition, classPartObject, classGroupId);
    return;
  }

  if (isThemeReference(classDefinition)) {
    addClassGroup(
      theme[classDefinition.themeGroupId] || EMPTY_CLASS_GROUP,
      classPartObject,
      classGroupId,
      theme,
    );
    return;
  }

  addObjectDefinition(classDefinition, classPartObject, classGroupId, theme);
};

const addStringDefinition = (
  classDefinition: string,
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
): void => {
  const targetClassPart =
    classDefinition === "" ? classPartObject : getPart(classPartObject, classDefinition);
  targetClassPart.classGroupId = classGroupId;
};

const addValidatorDefinition = (
  classDefinition: ClassValidator,
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
): void => {
  if (classPartObject.validators === null) {
    classPartObject.validators = [];
  }
  classPartObject.validators.push(createClassValidatorObject(classGroupId, classDefinition));
};

const addObjectDefinition = (
  classDefinition: Record<string, ClassGroup<AnyThemeGroupIds>>,
  classPartObject: ClassPartObject,
  classGroupId: AnyClassGroupIds,
  theme: ThemeObject<AnyThemeGroupIds>,
): void => {
  const entries = Object.entries(classDefinition);
  for (let index = 0; index < entries.length; index++) {
    const [key, value] = entries[index]!;
    addClassGroup(value, getPart(classPartObject, key), classGroupId, theme);
  }
};

const getPart = (classPartObject: ClassPartObject, path: string): ClassPartObject => {
  let currentClassPart = classPartObject;
  const pathParts = path.split(CLASS_PART_SEPARATOR);

  for (let index = 0; index < pathParts.length; index++) {
    const pathPart = pathParts[index]!;
    let nextClassPart = currentClassPart.nextPart.get(pathPart);
    if (!nextClassPart) {
      nextClassPart = createClassPartObject();
      currentClassPart.nextPart.set(pathPart, nextClassPart);
    }
    currentClassPart = nextClassPart;
  }

  return currentClassPart;
};

const isThemeReference = (
  classDefinition: ThemeReference | Record<string, ClassGroup<AnyThemeGroupIds>>,
): classDefinition is ThemeReference =>
  "themeGroupId" in classDefinition && typeof classDefinition.themeGroupId === "string";
