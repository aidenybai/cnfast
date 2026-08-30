import {
  CHAR_CARRIAGE_RETURN,
  CHAR_CLOSE_BRACKET,
  CHAR_CLOSE_PAREN,
  CHAR_COLON,
  CHAR_DASH,
  CHAR_LINE_FEED,
  CHAR_LINE_SEPARATOR,
  CHAR_LOWER_A,
  CHAR_LOWER_N,
  CHAR_LOWER_S,
  CHAR_LOWER_Z,
  CHAR_NINE,
  CHAR_OPEN_BRACKET,
  CHAR_OPEN_PAREN,
  CHAR_PARAGRAPH_SEPARATOR,
  CHAR_SLASH,
  CHAR_UNDERSCORE,
  CHAR_UPPER_A,
  CHAR_UPPER_Z,
  CHAR_ZERO,
} from "./char-codes";

const fractionRegex = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/;
const tshirtUnitRegex = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/;
const lengthUnitRegex =
  /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/;
const colorFunctionRegex = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/;
// Shadow always begins with x and y offset separated by underscore optionally prepended by inset
const shadowRegex = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/;
const imageRegex =
  /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/;

// Module-scope bindings load faster than repeated global-object property lookups on the
// per-token validator path.
const toNumber = Number;
const numberIsNaN = Number.isNaN;
const numberIsInteger = Number.isInteger;

const isWordCharCode = (charCode: number): boolean =>
  (charCode >= CHAR_LOWER_A && charCode <= CHAR_LOWER_Z) ||
  (charCode >= CHAR_UPPER_A && charCode <= CHAR_UPPER_Z) ||
  (charCode >= CHAR_ZERO && charCode <= CHAR_NINE) ||
  charCode === CHAR_UNDERSCORE;

/**
 * Scan an arbitrary token of the form `<open>value<close>` or `<open>label:value<close>`, where
 * the label is a word character followed by any run of word characters and dashes (`[url:...]`,
 * `(--my-var:...)`).
 *
 * Returns -1 for no match, 0 for a match without a label, or the index of the label's `:`.
 *
 * A charCodeAt scan instead of a regex because `RegExp.exec` allocates a match array plus two
 * capture substrings per call, and indexing that array was the one hot site that kept
 * re-deoptimizing at the same offset. Two subtleties keep this byte-compatible with
 * tailwind-merge's regex semantics:
 * - An inner line terminator (LF, CR, LS, PS) rejects the whole match. Tokens split from a class
 *   list can't contain LF/CR, but validators are public config surface and get called directly.
 * - A label exists only when the maximal word/dash run from index 1 is immediately followed by
 *   `:` with at least one value character before the closer, so `[foo:]` parses as the unlabeled
 *   value `foo:`.
 */
const scanArbitrary = (value: string, openCharCode: number, closeCharCode: number): number => {
  const length = value.length;
  if (
    length < 3 ||
    value.charCodeAt(0) !== openCharCode ||
    value.charCodeAt(length - 1) !== closeCharCode
  ) {
    return -1;
  }

  let colonIndex = 0;
  if (isWordCharCode(value.charCodeAt(1))) {
    let runEnd = 2;
    while (runEnd < length - 1) {
      const charCode = value.charCodeAt(runEnd);
      if (isWordCharCode(charCode) || charCode === CHAR_DASH) runEnd++;
      else break;
    }
    if (runEnd < length - 2 && value.charCodeAt(runEnd) === CHAR_COLON) {
      colonIndex = runEnd;
    }
  }

  for (let index = 1; index < length - 1; index++) {
    const charCode = value.charCodeAt(index);
    if (
      charCode === CHAR_LINE_FEED ||
      charCode === CHAR_CARRIAGE_RETURN ||
      charCode === CHAR_LINE_SEPARATOR ||
      charCode === CHAR_PARAGRAPH_SEPARATOR
    ) {
      return -1;
    }
  }

  return colonIndex;
};

// One-entry memos, keyed by token content. A trie node's validator chain probes the same
// `classRest` string against up to ~17 arbitrary-value/-variable validators; memoizing the parse
// collapses those to one scan plus (for a match) at most two slices per token. The label/value
// callbacks never re-enter these parsers, and strings are immutable, so the memo cannot go stale
// mid-chain. A label is never the empty string (`\w[\w-]*` needs one char), so `colon > 0` alone
// distinguishes labeled matches.
let lastBracketValue: string | null = null;
let bracketColonIndex = -1;
let bracketLabel = "";
let bracketInnerValue = "";

const parseBracketToken = (value: string): void => {
  if (value === lastBracketValue) return;
  lastBracketValue = value;
  const colonIndex = scanArbitrary(value, CHAR_OPEN_BRACKET, CHAR_CLOSE_BRACKET);
  bracketColonIndex = colonIndex;
  if (colonIndex > 0) {
    bracketLabel = value.slice(1, colonIndex);
    bracketInnerValue = value.slice(colonIndex + 1, value.length - 1);
  } else if (colonIndex === 0) {
    bracketInnerValue = value.slice(1, -1);
  }
};

let lastParenValue: string | null = null;
let parenColonIndex = -1;
let parenLabel = "";

const parseParenToken = (value: string): void => {
  if (value === lastParenValue) return;
  lastParenValue = value;
  const colonIndex = scanArbitrary(value, CHAR_OPEN_PAREN, CHAR_CLOSE_PAREN);
  parenColonIndex = colonIndex;
  if (colonIndex > 0) {
    parenLabel = value.slice(1, colonIndex);
  }
};

export const isFraction = (value: string) => fractionRegex.test(value);

export const isNumber = (value: string) => Boolean(value) && !numberIsNaN(toNumber(value));

export const isInteger = (value: string) => Boolean(value) && numberIsInteger(toNumber(value));

export const isPercent = (value: string) => value.endsWith("%") && isNumber(value.slice(0, -1));

export const isTshirtSize = (value: string) => tshirtUnitRegex.test(value);

export const isAny = () => true;

const isLengthOnly = (value: string) =>
  // Color functions contain percentages (`hsl(0 0% 0%)`) that `lengthUnitRegex` would otherwise
  // classify as lengths; a lookbehind in the regex isn't supported widely enough.
  lengthUnitRegex.test(value) && !colorFunctionRegex.test(value);

const isNever = () => false;

const isShadow = (value: string) => shadowRegex.test(value);

const isImage = (value: string) => imageRegex.test(value);

export const isAnyNonArbitrary = (value: string) =>
  !isArbitraryValue(value) && !isArbitraryVariable(value);

// `charCodeAt` + length compares instead of one-char string indexing: `value[10]` materializes a
// single-char string and its map check was a recorded "wrong map" deopt source.
export const isNamedContainerQuery = (value: string) => {
  const length = value.length;
  return (
    value.startsWith("@container") &&
    ((length > 11 && value.charCodeAt(10) === CHAR_SLASH) ||
      (length > 16 && value.charCodeAt(11) === CHAR_LOWER_S && value.startsWith("-size/", 10)) ||
      (length > 18 && value.charCodeAt(11) === CHAR_LOWER_N && value.startsWith("-normal/", 10)))
  );
};

export const isArbitrarySize = (value: string) => getIsArbitraryValue(value, isLabelSize, isNever);

export const isArbitraryValue = (value: string) => {
  parseBracketToken(value);
  return bracketColonIndex >= 0;
};

export const isArbitraryLength = (value: string) =>
  getIsArbitraryValue(value, isLabelLength, isLengthOnly);

export const isArbitraryNumber = (value: string) =>
  getIsArbitraryValue(value, isLabelNumber, isNumber);

export const isArbitraryWeight = (value: string) =>
  getIsArbitraryValue(value, isLabelWeight, isAny);

export const isArbitraryFamilyName = (value: string) =>
  getIsArbitraryValue(value, isLabelFamilyName, isNever);

export const isArbitraryPosition = (value: string) =>
  getIsArbitraryValue(value, isLabelPosition, isNever);

export const isArbitraryImage = (value: string) =>
  getIsArbitraryValue(value, isLabelImage, isImage);

export const isArbitraryShadow = (value: string) =>
  getIsArbitraryValue(value, isLabelShadow, isShadow);

export const isArbitraryVariable = (value: string) => {
  parseParenToken(value);
  return parenColonIndex >= 0;
};

export const isArbitraryVariableLength = (value: string) =>
  getIsArbitraryVariable(value, isLabelLength);

export const isArbitraryVariableFamilyName = (value: string) =>
  getIsArbitraryVariable(value, isLabelFamilyName);

export const isArbitraryVariablePosition = (value: string) =>
  getIsArbitraryVariable(value, isLabelPosition);

export const isArbitraryVariableSize = (value: string) =>
  getIsArbitraryVariable(value, isLabelSize);

export const isArbitraryVariableImage = (value: string) =>
  getIsArbitraryVariable(value, isLabelImage);

export const isArbitraryVariableShadow = (value: string) =>
  getIsArbitraryVariable(value, isLabelShadow, true);

export const isArbitraryVariableWeight = (value: string) =>
  getIsArbitraryVariable(value, isLabelWeight, true);

const getIsArbitraryValue = (
  value: string,
  testLabel: (label: string) => boolean,
  testValue: (value: string) => boolean,
) => {
  parseBracketToken(value);

  if (bracketColonIndex < 0) {
    return false;
  }
  if (bracketColonIndex > 0) {
    return testLabel(bracketLabel);
  }
  return testValue(bracketInnerValue);
};

const getIsArbitraryVariable = (
  value: string,
  testLabel: (label: string) => boolean,
  shouldMatchNoLabel = false,
) => {
  parseParenToken(value);

  if (parenColonIndex < 0) {
    return false;
  }
  if (parenColonIndex > 0) {
    return testLabel(parenLabel);
  }
  return shouldMatchNoLabel;
};

const isLabelPosition = (label: string) => label === "position" || label === "percentage";

const isLabelImage = (label: string) => label === "image" || label === "url";

const isLabelSize = (label: string) =>
  label === "length" || label === "size" || label === "bg-size";

const isLabelLength = (label: string) => label === "length";

const isLabelNumber = (label: string) => label === "number";

const isLabelFamilyName = (label: string) => label === "family-name";

const isLabelWeight = (label: string) => label === "number" || label === "weight";

const isLabelShadow = (label: string) => label === "shadow";
