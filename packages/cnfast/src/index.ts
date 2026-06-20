import { type ClassValue, resolveClassValue } from "./clsx.js";
import { mergeTemplate } from "./lib/merge-template.js";
import { twMerge } from "./lib/tw-merge.js";

export interface ClassNameFunction {
  /** Tagged-template form: ``cn`px-2 ${active && "bg-blue-500"}` `` — identity-cached per call site. */
  (strings: TemplateStringsArray, ...values: ClassValue[]): string;
  /** Standard variadic form: `cn("px-2", active && "bg-blue-500")`. */
  (...inputs: ClassValue[]): string;
}

// Implemented as a `function` reading `arguments` (not an arrow with a rest param) on purpose: a
// rest param forces V8 to allocate an array on every call, whereas `arguments` accessed only via
// `.length`/index never escapes here, so V8 elides it. The single-argument branch is the common
// call shape (`cn("...")`, and every cache-miss merge), and skips the join loop entirely.
// `twMerge.mergeString` self-patches from the lazy initializer to the direct merge after warmup.
/* eslint-disable prefer-rest-params -- a rest param would defeat the allocation-elision this relies on */
export const cn: ClassNameFunction = function (): string {
  const first = arguments[0];

  // Tagged-template call (``cn`...` ``): the first arg is a frozen `TemplateStringsArray`, uniquely
  // identified by its `.raw` array. No string/array/object class value carries `.raw`, so every
  // standard `cn(...)` shape below is unaffected. Reading `arguments` only by index here keeps V8's
  // arguments-elision intact; the interpolations are copied into a fresh array so the `arguments`
  // object itself never escapes into `mergeTemplate`.
  if (
    first !== null &&
    typeof first === "object" &&
    (first as TemplateStringsArray).raw !== undefined
  ) {
    const length = arguments.length;
    const values: ClassValue[] = [];
    for (let index = 1; index < length; index++) values.push(arguments[index]);
    return mergeTemplate(first as TemplateStringsArray, values);
  }

  const length = arguments.length;

  if (length === 1) {
    return typeof first === "string"
      ? twMerge.mergeString(first)
      : twMerge.mergeString(resolveClassValue(first));
  }

  let result = "";
  for (let index = 0; index < length; index++) {
    const item = arguments[index];
    if (!item) continue;
    const resolved = typeof item === "string" ? item : resolveClassValue(item);
    if (resolved) {
      if (result) result += " ";
      result += resolved;
    }
  }

  return twMerge.mergeString(result);
};
/* eslint-enable prefer-rest-params */

export default cn;

export { clsx, type ClassValue, type ClassDictionary } from "./clsx.js";
export { twJoin, type ClassNameValue } from "./lib/tw-join.js";
export { twMerge } from "./lib/tw-merge.js";
