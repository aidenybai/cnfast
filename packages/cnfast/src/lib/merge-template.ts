import { type ClassValue, resolveClassValue } from "../clsx.js";
import { twMerge } from "./tw-merge.js";

/**
 * Max distinct interpolation tuples remembered per call site. Real tagged-template sites cycle
 * through a tiny set of dynamic values (a boolean toggling one class, a small variant union), so
 * this stays small; the bound only guards a site that interpolates high-cardinality values (e.g. a
 * live color) from growing its per-site list without limit.
 */
const TEMPLATE_SITE_CACHE = 8;

interface TemplateEntry {
  values: ClassValue[];
  result: string;
}

// Per-call-site cache keyed on the template's strings array. A tagged template reuses the SAME
// frozen strings array object on every evaluation (spec-guaranteed), so its identity is a stable,
// allocation-free handle for the static part of the class list — something a plain string key can
// never be (strings are illegal WeakMap keys, and value-keying just re-hashes). On a hit we skip
// building and hashing the whole joined string, which is the dominant cost the profiler shows.
const templateCache = new WeakMap<TemplateStringsArray, TemplateEntry[]>();

export const mergeTemplate = (strings: TemplateStringsArray, values: ClassValue[]): string => {
  const valueCount = values.length;

  // Only cache when every interpolation is a string or falsy: those are immutable, so an identity
  // match guarantees identical output. An object/array interpolation could be mutated between calls
  // while keeping the same reference, so such calls always recompute and are never cached.
  let isCacheable = true;
  for (let index = 0; index < valueCount; index++) {
    const value = values[index];
    if (value && typeof value !== "string") {
      isCacheable = false;
      break;
    }
  }

  if (isCacheable) {
    const entries = templateCache.get(strings);
    if (entries !== undefined) {
      for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        const entry = entries[entryIndex]!;
        const entryValues = entry.values;
        let isMatch = true;
        for (let index = 0; index < valueCount; index++) {
          if (entryValues[index] !== values[index]) {
            isMatch = false;
            break;
          }
        }
        if (isMatch) return entry.result;
      }
    }
  }

  // Interleave the literal spans with the resolved interpolations exactly as written. Spacing is the
  // author's responsibility (`cn` does not inject spaces between a span and its value), matching how
  // template literals concatenate; the merge engine normalizes the resulting whitespace.
  let joined = strings[0]!;
  for (let index = 0; index < valueCount; index++) {
    const value = values[index];
    if (value) joined += typeof value === "string" ? value : resolveClassValue(value);
    joined += strings[index + 1]!;
  }

  const result = twMerge.mergeString(joined);

  if (isCacheable) {
    let entries = templateCache.get(strings);
    if (entries === undefined) {
      entries = [];
      templateCache.set(strings, entries);
    }
    if (entries.length >= TEMPLATE_SITE_CACHE) entries.shift();
    entries.push({ values, result });
  }

  return result;
};
