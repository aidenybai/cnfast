import { createSourceMask } from "./create-source-mask";

export type ClassListArgs = (string | false | null)[];

interface LiteralReadResult {
  classNames: string[];
  endIndex: number;
}

interface ObjectKeyReadResult {
  className: string;
  endIndex: number;
}

const CLASS_CALL_REGEX = /\b(cn|clsx|cx|cva|tv|tw|twMerge|twJoin|classNames|classnames)\s*\(/g;
const CLASS_ATTRIBUTE_REGEX =
  /(\bv-bind:class|:class|\bclass:list|\bclassName|\bclassList|\[ngClass\]|\[class\]|\bclass)\s*=\s*/g;
const CLASS_DIRECTIVE_REGEX =
  /(?:\bclass:(?!list\b)([\w-]+)(?=\s*(?:=|[/>]))|\[class\.([\w-]+)\]\s*=)/g;
const CLASS_LIST_CALL_REGEX = /\.classList\.(?:add|remove|toggle|replace)\s*\(/g;
const CLASS_NAME_ASSIGNMENT_REGEX = /\.className\s*=\s*/g;
const CLASS_TEMPLATE_REGEX = /\b(?:tw(?:\.[A-Za-z_$][\w$]*)?|twMerge|twJoin)\s*`/g;
const CLASS_TOKEN_REGEX = /^[\w[\](){}!:/.,#%&+*~<>=@$?-]+$/;
const OBJECT_CLASS_HELPERS = new Set(["cn", "clsx", "cx", "classNames", "classnames"]);

const looksLikeClassList = (value: string): boolean => {
  const trimmedValue = value.trim();
  if (!trimmedValue) return false;
  const classNames = trimmedValue.split(/\s+/);
  for (let index = 0; index < classNames.length; index++) {
    if (!CLASS_TOKEN_REGEX.test(classNames[index]!)) return false;
  }
  return true;
};

const isComparedLiteral = (source: string, startIndex: number, endIndex: number): boolean => {
  const precedingSource = source.slice(Math.max(0, startIndex - 4), startIndex).trimEnd();
  const followingSource = source.slice(endIndex, endIndex + 4).trimStart();
  return /(?:===|!==|==|!=)$/.test(precedingSource) || /^(?:===|!==|==|!=)/.test(followingSource);
};

const isObjectKey = (source: string, startIndex: number, endIndex: number): boolean => {
  let previousIndex = startIndex - 1;
  while (/\s/.test(source[previousIndex] ?? "")) previousIndex--;
  const previousCharacter = source[previousIndex];
  const followingSource = source.slice(endIndex).trimStart();
  return (
    (previousCharacter === "{" || previousCharacter === ",") && followingSource.startsWith(":")
  );
};

const isClassLiteral = (
  source: string,
  startIndex: number,
  endIndex: number,
  value: string,
  includesObjectKeys: boolean,
): boolean =>
  looksLikeClassList(value) &&
  !isComparedLiteral(source, startIndex, endIndex) &&
  (includesObjectKeys || !isObjectKey(source, startIndex, endIndex));

const getUnquotedObjectKey = (
  source: string,
  startIndex: number,
): ObjectKeyReadResult | undefined => {
  if (!/[A-Za-z_$]/.test(source[startIndex] ?? "")) return;

  let previousIndex = startIndex - 1;
  while (/\s/.test(source[previousIndex] ?? "")) previousIndex--;
  if (source[previousIndex] !== "{" && source[previousIndex] !== ",") return;

  let endIndex = startIndex + 1;
  while (/[\w$]/.test(source[endIndex] ?? "")) endIndex++;
  let colonIndex = endIndex;
  while (/\s/.test(source[colonIndex] ?? "")) colonIndex++;
  if (source[colonIndex] !== ":") return;
  return { className: source.slice(startIndex, endIndex), endIndex };
};

const getClosingBraceIndex = (
  source: string,
  sourceMask: Uint8Array,
  startIndex: number,
): number => {
  let braceDepth = 1;
  for (let index = startIndex; index < source.length; index++) {
    if (sourceMask[index] === 0) continue;
    if (source[index] === "{") braceDepth++;
    else if (source[index] === "}" && --braceDepth === 0) return index;
  }
  return source.length;
};

const collectLiterals = (
  source: string,
  sourceMask: Uint8Array,
  startIndex: number,
  endIndex: number,
  includesObjectKeys = false,
): string[] => {
  const classNames: string[] = [];
  let index = startIndex;
  while (index < endIndex) {
    if (sourceMask[index] === 1) {
      const character = source[index];
      if (character === '"' || character === "'" || character === "`") {
        const literalResult = readLiteral(source, sourceMask, index, includesObjectKeys);
        classNames.push(...literalResult.classNames);
        index = literalResult.endIndex;
        continue;
      }
      if (includesObjectKeys) {
        const objectKey = getUnquotedObjectKey(source, index);
        if (objectKey && looksLikeClassList(objectKey.className)) {
          classNames.push(objectKey.className);
          index = objectKey.endIndex;
          continue;
        }
      }
    }
    index++;
  }
  return classNames;
};

const readLiteral = (
  source: string,
  sourceMask: Uint8Array,
  startIndex: number,
  includesObjectKeys = false,
): LiteralReadResult => {
  const quote = source[startIndex]!;
  const classNames: string[] = [];
  let value = "";
  let index = startIndex + 1;

  while (index < source.length) {
    const character = source[index]!;
    if (character === "\\") {
      value += source[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (character === quote) {
      if (isClassLiteral(source, startIndex, index + 1, value, includesObjectKeys)) {
        classNames.unshift(value);
      }
      return { classNames, endIndex: index + 1 };
    }
    if (quote === "`" && character === "$" && source[index + 1] === "{") {
      value += " ";
      const expressionEndIndex = getClosingBraceIndex(source, sourceMask, index + 2);
      classNames.push(
        ...collectLiterals(source, sourceMask, index + 2, expressionEndIndex, includesObjectKeys),
      );
      index = expressionEndIndex + 1;
      continue;
    }
    value += character;
    index++;
  }

  if (isClassLiteral(source, startIndex, index, value, includesObjectKeys)) {
    classNames.unshift(value);
  }
  return { classNames, endIndex: index };
};

const collectCallArguments = (
  source: string,
  sourceMask: Uint8Array,
  openParenIndex: number,
  includesObjectKeys: boolean,
): LiteralReadResult => {
  let parenthesisDepth = 1;
  let index = openParenIndex + 1;
  while (index < source.length && parenthesisDepth > 0) {
    if (sourceMask[index] === 1) {
      if (source[index] === "(") parenthesisDepth++;
      else if (source[index] === ")") parenthesisDepth--;
    }
    index++;
  }
  return {
    classNames: collectLiterals(
      source,
      sourceMask,
      openParenIndex + 1,
      index - 1,
      includesObjectKeys,
    ),
    endIndex: index,
  };
};

const addClassGroup = (classGroups: Map<string, ClassListArgs>, classNames: string[]): boolean => {
  if (classNames.length === 0) return false;
  const classGroupKey = classNames.join("\u0000");
  if (!classGroups.has(classGroupKey)) classGroups.set(classGroupKey, classNames);
  return true;
};

const getAttributeValues = (
  source: string,
  sourceMask: Uint8Array,
  valueStartIndex: number,
  isQuotedExpression: boolean,
  includesObjectKeys: boolean,
): string[] => {
  let startIndex = valueStartIndex;
  while (/\s/.test(source[startIndex] ?? "")) startIndex++;
  const character = source[startIndex];
  if (character === '"' || character === "'" || character === "`") {
    const literalResult = readLiteral(source, sourceMask, startIndex, includesObjectKeys);
    if (!isQuotedExpression) return literalResult.classNames;
    const expression = source.slice(startIndex + 1, literalResult.endIndex - 1);
    return collectLiterals(
      expression,
      createSourceMask(expression),
      0,
      expression.length,
      includesObjectKeys,
    );
  }
  if (character !== "{") return [];
  const endIndex = getClosingBraceIndex(source, sourceMask, startIndex + 1);
  return collectLiterals(source, sourceMask, startIndex + 1, endIndex, includesObjectKeys);
};

export const harvestClassGroups = (
  source: string,
  classGroups: Map<string, ClassListArgs>,
): boolean => {
  const sourceMask = createSourceMask(source);
  let didFindClasses = false;

  CLASS_CALL_REGEX.lastIndex = 0;
  let scannedUntil = -1;
  let callMatch: RegExpExecArray | null;
  while ((callMatch = CLASS_CALL_REGEX.exec(source))) {
    if (sourceMask[callMatch.index] === 0) continue;
    const openParenIndex = callMatch.index + callMatch[0].length - 1;
    if (openParenIndex < scannedUntil) continue;
    const callArguments = collectCallArguments(
      source,
      sourceMask,
      openParenIndex,
      OBJECT_CLASS_HELPERS.has(callMatch[1]!),
    );
    if (addClassGroup(classGroups, callArguments.classNames)) didFindClasses = true;
    scannedUntil = callArguments.endIndex;
  }

  CLASS_ATTRIBUTE_REGEX.lastIndex = 0;
  let attributeMatch: RegExpExecArray | null;
  while ((attributeMatch = CLASS_ATTRIBUTE_REGEX.exec(source))) {
    if (sourceMask[attributeMatch.index] === 0) continue;
    const attributeName = attributeMatch[1]!;
    const isQuotedExpression =
      attributeName === ":class" ||
      attributeName === "v-bind:class" ||
      attributeName === "[ngClass]" ||
      attributeName === "[class]";
    const includesObjectKeys =
      isQuotedExpression ||
      attributeName === "class:list" ||
      attributeName === "classList" ||
      attributeName === "[ngClass]";
    const classNames = getAttributeValues(
      source,
      sourceMask,
      CLASS_ATTRIBUTE_REGEX.lastIndex,
      isQuotedExpression,
      includesObjectKeys,
    );
    if (addClassGroup(classGroups, classNames)) didFindClasses = true;
  }

  CLASS_DIRECTIVE_REGEX.lastIndex = 0;
  let directiveMatch: RegExpExecArray | null;
  while ((directiveMatch = CLASS_DIRECTIVE_REGEX.exec(source))) {
    if (sourceMask[directiveMatch.index] === 1) {
      if (addClassGroup(classGroups, [directiveMatch[1] ?? directiveMatch[2]!])) {
        didFindClasses = true;
      }
    }
  }

  CLASS_NAME_ASSIGNMENT_REGEX.lastIndex = 0;
  let assignmentMatch: RegExpExecArray | null;
  while ((assignmentMatch = CLASS_NAME_ASSIGNMENT_REGEX.exec(source))) {
    if (sourceMask[assignmentMatch.index] === 0) continue;
    const classNames = getAttributeValues(
      source,
      sourceMask,
      CLASS_NAME_ASSIGNMENT_REGEX.lastIndex,
      false,
      false,
    );
    if (addClassGroup(classGroups, classNames)) didFindClasses = true;
  }

  CLASS_LIST_CALL_REGEX.lastIndex = 0;
  let classListMatch: RegExpExecArray | null;
  while ((classListMatch = CLASS_LIST_CALL_REGEX.exec(source))) {
    if (sourceMask[classListMatch.index] === 0) continue;
    const openParenIndex = classListMatch.index + classListMatch[0].length - 1;
    const classNames = collectCallArguments(source, sourceMask, openParenIndex, false).classNames;
    if (addClassGroup(classGroups, classNames)) didFindClasses = true;
  }

  CLASS_TEMPLATE_REGEX.lastIndex = 0;
  let templateMatch: RegExpExecArray | null;
  while ((templateMatch = CLASS_TEMPLATE_REGEX.exec(source))) {
    if (sourceMask[templateMatch.index] === 0) continue;
    const classNames = readLiteral(
      source,
      sourceMask,
      CLASS_TEMPLATE_REGEX.lastIndex - 1,
    ).classNames;
    if (addClassGroup(classGroups, classNames)) didFindClasses = true;
  }

  return didFindClasses;
};
