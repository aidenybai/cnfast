export type ClassListArgs = (string | false | null)[];

const CLASS_CALL_REGEX = /\b(?:cn|clsx|cx|cva|twMerge|twJoin|classNames|classnames)\s*\(/g;
const CLASSNAME_ATTR_REGEX = /\bclassName\s*=\s*(["'])((?:\\.|(?!\1).)*)\1/g;

// Requiring Tailwind punctuation filters prose and URLs from harvested string arguments.
const CLASS_TOKEN_REGEX = /^[\w[\](){}!:/.,#%&+*~<>=@$?-]+$/;

const looksLikeClassList = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const tokens = trimmed.split(/\s+/);
  for (let index = 0; index < tokens.length; index++) {
    if (!CLASS_TOKEN_REGEX.test(tokens[index]!)) return false;
  }
  return true;
};

const readStringLiteral = (source: string, start: number): { value: string; end: number } => {
  const quote = source[start]!;
  let value = "";
  let index = start + 1;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "\\") {
      value += source[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (char === quote) return { value, end: index + 1 };
    if (quote === "`" && char === "$" && source[index + 1] === "{") {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source[index] === "{") depth++;
        else if (source[index] === "}") depth--;
        index++;
      }
      value += " ";
      continue;
    }
    value += char;
    index++;
  }
  return { value, end: index };
};

const collectCallArgs = (source: string, openParenIndex: number): ClassListArgs => {
  const args: ClassListArgs = [];
  let depth = 1;
  let index = openParenIndex + 1;
  while (index < source.length && depth > 0) {
    const char = source[index]!;
    if (char === "(") {
      depth++;
      index++;
    } else if (char === ")") {
      depth--;
      index++;
    } else if (char === '"' || char === "'" || char === "`") {
      const literal = readStringLiteral(source, index);
      if (looksLikeClassList(literal.value)) args.push(literal.value);
      index = literal.end;
    } else {
      index++;
    }
  }
  return args;
};

export const harvestClassGroups = (source: string, into: Map<string, ClassListArgs>): void => {
  CLASS_CALL_REGEX.lastIndex = 0;
  let scannedUntil = -1;
  let callMatch: RegExpExecArray | null;
  while ((callMatch = CLASS_CALL_REGEX.exec(source))) {
    const openParenIndex = callMatch.index + callMatch[0].length - 1;
    if (openParenIndex < scannedUntil) continue;
    const args = collectCallArgs(source, openParenIndex);
    if (args.length === 0) continue;
    const key = args.join("\u0000");
    if (!into.has(key)) into.set(key, args);
    scannedUntil = openParenIndex;
  }

  CLASSNAME_ATTR_REGEX.lastIndex = 0;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = CLASSNAME_ATTR_REGEX.exec(source))) {
    const value = attrMatch[2]!;
    if (!looksLikeClassList(value)) continue;
    if (!into.has(value)) into.set(value, [value]);
  }
};
