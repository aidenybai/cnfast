import { ParsedClassName } from "./types";

export const IMPORTANT_MODIFIER = "!";

const CHAR_MODIFIER_SEPARATOR = 58; // ":"
const CHAR_POSTFIX_SEPARATOR = 47; // "/"
const CHAR_OPEN_BRACKET = 91; // "["
const CHAR_CLOSE_BRACKET = 93; // "]"
const CHAR_OPEN_PAREN = 40; // "("
const CHAR_CLOSE_PAREN = 41; // ")"
const CHAR_IMPORTANT = 33; // "!"

// Pre-allocated result object shape for consistency
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

/**
 * Parse class name into parts.
 *
 * Inspired by `splitAtTopLevelOnly` used in Tailwind CSS
 * @see https://github.com/tailwindlabs/tailwindcss/blob/v3.2.2/src/util/splitAtTopLevelOnly.js
 */
export const parseClassName = (className: string): ParsedClassName => {
  const modifiers: string[] = [];

  let bracketDepth = 0;
  let parenDepth = 0;
  let modifierStart = 0;
  let postfixModifierPosition: number | undefined;

  const len = className.length;
  for (let index = 0; index < len; index++) {
    const charCode = className.charCodeAt(index);

    if (bracketDepth === 0 && parenDepth === 0) {
      if (charCode === CHAR_MODIFIER_SEPARATOR) {
        modifiers.push(className.slice(modifierStart, index));
        modifierStart = index + 1;
        continue;
      }

      if (charCode === CHAR_POSTFIX_SEPARATOR) {
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
    modifiers.length === 0 ? className : className.slice(modifierStart);

  let baseClassName = baseClassNameWithImportantModifier;
  let hasImportantModifier = false;

  const lastIndex = baseClassNameWithImportantModifier.length - 1;
  if (baseClassNameWithImportantModifier.charCodeAt(lastIndex) === CHAR_IMPORTANT) {
    baseClassName = baseClassNameWithImportantModifier.slice(0, -1);
    hasImportantModifier = true;
  } else if (
    /**
     * In Tailwind CSS v3 the important modifier was at the start of the base class name. This is still supported for legacy reasons.
     * @see https://github.com/dcastil/tailwind-merge/issues/513#issuecomment-2614029864
     */
    baseClassNameWithImportantModifier.charCodeAt(0) === CHAR_IMPORTANT
  ) {
    baseClassName = baseClassNameWithImportantModifier.slice(1);
    hasImportantModifier = true;
  }

  const maybePostfixModifierPosition =
    postfixModifierPosition && postfixModifierPosition > modifierStart
      ? postfixModifierPosition - modifierStart
      : undefined;

  return createResultObject(
    modifiers,
    hasImportantModifier,
    baseClassName,
    maybePostfixModifierPosition,
  );
};
