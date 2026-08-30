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

// Single factory so every parse result shares one object shape (identical key order).
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

// Shared result for the modifier-less case (most tokens reaching this parser carry an arbitrary
// value or important marker but no variant). Frozen so an accidental consumer mutation throws
// instead of corrupting every later parse; no caller mutates parse results.
const EMPTY_MODIFIERS: string[] = Object.freeze([]) as unknown as string[];

/**
 * Parse a class name into modifiers, base name, important flag, and postfix-modifier position.
 *
 * Inspired by `splitAtTopLevelOnly` used in Tailwind CSS
 * @see https://github.com/tailwindlabs/tailwindcss/blob/v3.2.2/src/util/splitAtTopLevelOnly.js
 */
export const parseClassName = (className: string): ParsedClassName => {
  // Materialized lazily: allocating `[]` up front costs an array on every parse even though most
  // tokens have no modifiers at all.
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

  // The length guard keeps `charCodeAt` in bounds for empty base names (e.g. the token `:`):
  // an out-of-bounds `charCodeAt(-1)` returns NaN and stays correct, but forces V8 through the
  // slow path and was a recorded recurring "out of bounds" deopt of this function.
  const baseLength = baseClassNameWithImportantModifier.length;
  if (baseLength !== 0) {
    if (baseClassNameWithImportantModifier.charCodeAt(baseLength - 1) === CHAR_EXCLAMATION) {
      baseClassName = baseClassNameWithImportantModifier.slice(0, -1);
      hasImportantModifier = true;
    } else if (
      /**
       * In Tailwind CSS v3 the important modifier was at the start of the base class name. This is still supported for legacy reasons.
       * @see https://github.com/dcastil/tailwind-merge/issues/513#issuecomment-2614029864
       */
      baseClassNameWithImportantModifier.charCodeAt(0) === CHAR_EXCLAMATION
    ) {
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
