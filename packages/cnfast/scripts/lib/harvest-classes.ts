import { createSourceMask } from "./create-source-mask";

export type ClassListArgs = (string | false | null)[];

interface LiteralReadResult {
  values: string[];
  end: number;
}

interface ObjectKeyReadResult {
  value: string;
  end: number;
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
  const trimmed = value.trim();
  if (!trimmed) return false;
  const tokens = trimmed.split(/\s+/);
  for (let index = 0; index < tokens.length; index++) {
    if (!CLASS_TOKEN_REGEX.test(tokens[index]!)) return false;
  }
  return true;
};

const isComparedLiteral = (source: string, start: number, end: number): boolean => {
  const before = source.slice(Math.max(0, start - 4), start).trimEnd();
  const after = source.slice(end, end + 4).trimStart();
  return /(?:===|!==|==|!=)$/.test(before) || /^(?:===|!==|==|!=)/.test(after);
};

const isObjectKey = (source: string, start: number, end: number): boolean => {
  let previousIndex = start - 1;
  while (/\s/.test(source[previousIndex] ?? "")) previousIndex--;
  const previousCharacter = source[previousIndex];
  const after = source.slice(end).trimStart();
  return (previousCharacter === "{" || previousCharacter === ",") && after.startsWith(":");
};

const isClassLiteral = (
  source: string,
  start: number,
  end: number,
  value: string,
  includesObjectKeys: boolean,
): boolean =>
  looksLikeClassList(value) &&
  !isComparedLiteral(source, start, end) &&
  (includesObjectKeys || !isObjectKey(source, start, end));

const getUnquotedObjectKey = (source: string, start: number): ObjectKeyReadResult | undefined => {
  if (!/[A-Za-z_$]/.test(source[start] ?? "")) return;

  let previousIndex = start - 1;
  while (/\s/.test(source[previousIndex] ?? "")) previousIndex--;
  if (source[previousIndex] !== "{" && source[previousIndex] !== ",") return;

  let end = start + 1;
  while (/[\w$]/.test(source[end] ?? "")) end++;
  let colonIndex = end;
  while (/\s/.test(source[colonIndex] ?? "")) colonIndex++;
  if (source[colonIndex] !== ":") return;
  return { value: source.slice(start, end), end };
};

const getClosingBrace = (source: string, mask: Uint8Array, start: number): number => {
  let depth = 1;
  for (let index = start; index < source.length; index++) {
    if (mask[index] === 0) continue;
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return index;
  }
  return source.length;
};

const collectLiterals = (
  source: string,
  mask: Uint8Array,
  start: number,
  end: number,
  includesObjectKeys = false,
): string[] => {
  const values: string[] = [];
  let index = start;
  while (index < end) {
    if (mask[index] === 1) {
      const character = source[index];
      if (character === '"' || character === "'" || character === "`") {
        const literal = readLiteral(source, mask, index, includesObjectKeys);
        values.push(...literal.values);
        index = literal.end;
        continue;
      }
      if (includesObjectKeys) {
        const objectKey = getUnquotedObjectKey(source, index);
        if (objectKey && looksLikeClassList(objectKey.value)) {
          values.push(objectKey.value);
          index = objectKey.end;
          continue;
        }
      }
    }
    index++;
  }
  return values;
};

const readLiteral = (
  source: string,
  mask: Uint8Array,
  start: number,
  includesObjectKeys = false,
): LiteralReadResult => {
  const quote = source[start]!;
  const values: string[] = [];
  let value = "";
  let index = start + 1;

  while (index < source.length) {
    const character = source[index]!;
    if (character === "\\") {
      value += source[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (character === quote) {
      if (isClassLiteral(source, start, index + 1, value, includesObjectKeys))
        values.unshift(value);
      return { values, end: index + 1 };
    }
    if (quote === "`" && character === "$" && source[index + 1] === "{") {
      value += " ";
      const expressionEnd = getClosingBrace(source, mask, index + 2);
      values.push(...collectLiterals(source, mask, index + 2, expressionEnd, includesObjectKeys));
      index = expressionEnd + 1;
      continue;
    }
    value += character;
    index++;
  }

  if (isClassLiteral(source, start, index, value, includesObjectKeys)) values.unshift(value);
  return { values, end: index };
};

const collectCallArguments = (
  source: string,
  mask: Uint8Array,
  openParenIndex: number,
  includesObjectKeys: boolean,
): LiteralReadResult => {
  let depth = 1;
  let index = openParenIndex + 1;
  while (index < source.length && depth > 0) {
    if (mask[index] === 1) {
      if (source[index] === "(") depth++;
      else if (source[index] === ")") depth--;
    }
    index++;
  }
  const end = index;
  return {
    values: collectLiterals(source, mask, openParenIndex + 1, end - 1, includesObjectKeys),
    end,
  };
};

const addGroup = (groups: Map<string, ClassListArgs>, values: string[]): boolean => {
  if (values.length === 0) return false;
  const key = values.join("\u0000");
  if (!groups.has(key)) groups.set(key, values);
  return true;
};

const getAttributeValues = (
  source: string,
  mask: Uint8Array,
  valueStart: number,
  isQuotedExpression: boolean,
  includesObjectKeys: boolean,
): string[] => {
  let start = valueStart;
  while (/\s/.test(source[start] ?? "")) start++;
  const character = source[start];
  if (character === '"' || character === "'" || character === "`") {
    const literal = readLiteral(source, mask, start, includesObjectKeys);
    if (!isQuotedExpression) return literal.values;
    const expression = source.slice(start + 1, literal.end - 1);
    return collectLiterals(
      expression,
      createSourceMask(expression),
      0,
      expression.length,
      includesObjectKeys,
    );
  }
  if (character !== "{") return [];
  const end = getClosingBrace(source, mask, start + 1);
  return collectLiterals(source, mask, start + 1, end, includesObjectKeys);
};

export const harvestClassGroups = (source: string, groups: Map<string, ClassListArgs>): boolean => {
  const mask = createSourceMask(source);
  let didFindClasses = false;

  CLASS_CALL_REGEX.lastIndex = 0;
  let scannedUntil = -1;
  let callMatch: RegExpExecArray | null;
  while ((callMatch = CLASS_CALL_REGEX.exec(source))) {
    if (mask[callMatch.index] === 0) continue;
    const openParenIndex = callMatch.index + callMatch[0].length - 1;
    if (openParenIndex < scannedUntil) continue;
    const result = collectCallArguments(
      source,
      mask,
      openParenIndex,
      OBJECT_CLASS_HELPERS.has(callMatch[1]!),
    );
    if (addGroup(groups, result.values)) didFindClasses = true;
    scannedUntil = result.end;
  }

  CLASS_ATTRIBUTE_REGEX.lastIndex = 0;
  let attributeMatch: RegExpExecArray | null;
  while ((attributeMatch = CLASS_ATTRIBUTE_REGEX.exec(source))) {
    if (mask[attributeMatch.index] === 0) continue;
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
    const values = getAttributeValues(
      source,
      mask,
      CLASS_ATTRIBUTE_REGEX.lastIndex,
      isQuotedExpression,
      includesObjectKeys,
    );
    if (addGroup(groups, values)) didFindClasses = true;
  }

  CLASS_DIRECTIVE_REGEX.lastIndex = 0;
  let directiveMatch: RegExpExecArray | null;
  while ((directiveMatch = CLASS_DIRECTIVE_REGEX.exec(source))) {
    if (mask[directiveMatch.index] === 1) {
      if (addGroup(groups, [directiveMatch[1] ?? directiveMatch[2]!])) didFindClasses = true;
    }
  }

  CLASS_NAME_ASSIGNMENT_REGEX.lastIndex = 0;
  let assignmentMatch: RegExpExecArray | null;
  while ((assignmentMatch = CLASS_NAME_ASSIGNMENT_REGEX.exec(source))) {
    if (mask[assignmentMatch.index] === 0) continue;
    const values = getAttributeValues(
      source,
      mask,
      CLASS_NAME_ASSIGNMENT_REGEX.lastIndex,
      false,
      false,
    );
    if (addGroup(groups, values)) didFindClasses = true;
  }

  CLASS_LIST_CALL_REGEX.lastIndex = 0;
  let classListMatch: RegExpExecArray | null;
  while ((classListMatch = CLASS_LIST_CALL_REGEX.exec(source))) {
    if (mask[classListMatch.index] === 0) continue;
    const openParenIndex = classListMatch.index + classListMatch[0].length - 1;
    const values = collectCallArguments(source, mask, openParenIndex, false).values;
    if (addGroup(groups, values)) didFindClasses = true;
  }

  CLASS_TEMPLATE_REGEX.lastIndex = 0;
  let templateMatch: RegExpExecArray | null;
  while ((templateMatch = CLASS_TEMPLATE_REGEX.exec(source))) {
    if (mask[templateMatch.index] === 0) continue;
    const values = readLiteral(source, mask, CLASS_TEMPLATE_REGEX.lastIndex - 1).values;
    if (addGroup(groups, values)) didFindClasses = true;
  }

  return didFindClasses;
};
