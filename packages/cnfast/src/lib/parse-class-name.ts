import {
  CHAR_CLOSE_BRACKET,
  CHAR_CLOSE_PAREN,
  CHAR_COLON,
  CHAR_EXCLAMATION,
  CHAR_OPEN_BRACKET,
  CHAR_OPEN_PAREN,
  CHAR_SLASH,
} from "./char-codes";
import { ParsedClassName } from "./types";

export const IMPORTANT_MODIFIER = "!";

// One factory preserves a monomorphic result shape.
const createResultObject = (
  modifiers: string[],
  hasImportantModifier: boolean,
  baseClassName: string,
  maybePostfixModifierPosition?: number,
): ParsedClassName => ({
  modifiers,
  hasImportantModifier,
  baseClassName,
  maybePostfixModifierPosition,
  isExternal: undefined,
});

const EMPTY_MODIFIERS: string[] = [];
Object.freeze(EMPTY_MODIFIERS);

export const parseClassName = (className: string): ParsedClassName => {
  let modifiers: string[] | null = null;

  let bracketDepth = 0;
  let parenDepth = 0;
  let modifierStart = 0;
  let postfixModifierPosition: number | undefined;

  const length = className.length;
  for (let index = 0; index < length; index++) {
    const charCode = className.charCodeAt(index);

    if (bracketDepth === 0 && parenDepth === 0) {
      if (charCode === CHAR_COLON) {
        (modifiers ??= []).push(className.slice(modifierStart, index));
        modifierStart = index + 1;
        continue;
      }

      if (charCode === CHAR_SLASH) {
        postfixModifierPosition = index;
        continue;
      }
    }

    if (charCode === CHAR_OPEN_BRACKET) bracketDepth++;
    else if (charCode === CHAR_CLOSE_BRACKET) bracketDepth--;
    else if (charCode === CHAR_OPEN_PAREN) parenDepth++;
    else if (charCode === CHAR_CLOSE_PAREN) parenDepth--;
  }

  const baseClassNameWithImportantModifier =
    modifiers === null ? className : className.slice(modifierStart);

  let baseClassName = baseClassNameWithImportantModifier;
  let hasImportantModifier = false;

  // V8 deoptimizes this function when an empty base name reaches `charCodeAt(-1)`.
  const baseLength = baseClassNameWithImportantModifier.length;
  if (baseLength !== 0) {
    if (baseClassNameWithImportantModifier.charCodeAt(baseLength - 1) === CHAR_EXCLAMATION) {
      baseClassName = baseClassNameWithImportantModifier.slice(0, -1);
      hasImportantModifier = true;
    } else if (baseClassNameWithImportantModifier.charCodeAt(0) === CHAR_EXCLAMATION) {
      // Tailwind CSS v3 placed the important modifier first, so legacy inputs still need support.
      baseClassName = baseClassNameWithImportantModifier.slice(1);
      hasImportantModifier = true;
    }
  }

  const maybePostfixModifierPosition =
    postfixModifierPosition && postfixModifierPosition > modifierStart
      ? postfixModifierPosition - modifierStart
      : undefined;

  return createResultObject(
    modifiers === null ? EMPTY_MODIFIERS : modifiers,
    hasImportantModifier,
    baseClassName,
    maybePostfixModifierPosition,
  );
};
