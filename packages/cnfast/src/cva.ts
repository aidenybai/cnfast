// Byte parity with class-variance-authority 0.7.1 holds for configs treated as frozen
// after the first call and for plain-object props: own enumerable properties only.
// Configs mutated between calls, inherited enumerable prop keys, and non-enumerable own
// props can diverge from upstream (the memo reads props by key, so it cannot tell an
// inherited value from an own one). None of these shapes occur in real usage; the
// 58-repo corpus study found zero.
import { type ClassValue, clsx, resolveClassValue } from "./clsx.js";
import { CVA_MEMO_MAX_VALUE_SLOTS, CVA_MEMO_ROWS } from "./lib/constants.js";
import { createFilledArray } from "./utils/create-filled-array.js";

export type ClassPropKey = "class" | "className";

export type ClassProp =
  | { class: ClassValue; className?: never }
  | { class?: never; className: ClassValue }
  | { class?: never; className?: never };

export type OmitUndefined<T> = T extends undefined ? never : T;

export type StringToBoolean<T> = T extends "true" | "false" ? boolean : T;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional class-variance-authority type parity
export type VariantProps<Component extends (...args: any) => any> = Omit<
  OmitUndefined<Parameters<Component>[0]>,
  ClassPropKey
>;

export type CxOptions = Parameters<typeof clsx>;
export type CxReturn = ReturnType<typeof clsx>;

export type VariantSchema = Record<string, Record<string, ClassValue>>;

type SchemaVariants<T extends VariantSchema> = {
  [Variant in keyof T]?: StringToBoolean<keyof T[Variant]> | null | undefined;
};

type SchemaVariantsMulti<T extends VariantSchema> = {
  [Variant in keyof T]?:
    | StringToBoolean<keyof T[Variant]>
    | StringToBoolean<keyof T[Variant]>[]
    | undefined;
};

export type CvaConfig<T> = T extends VariantSchema
  ? {
      variants?: T;
      defaultVariants?: SchemaVariants<T>;
      compoundVariants?: (T extends VariantSchema
        ? (SchemaVariants<T> | SchemaVariantsMulti<T>) & ClassProp
        : ClassProp)[];
    }
  : never;

export type CvaProps<T> = T extends VariantSchema ? SchemaVariants<T> & ClassProp : ClassProp;

interface RawVariantConfig {
  variants?: Record<string, Record<string, ClassValue>>;
  defaultVariants?: Record<string, unknown>;
  compoundVariants?: Record<string, unknown>[];
}

interface CompiledCompoundRow {
  selectorKeys: string[];
  selectorValues: unknown[];
  selectorArrays: (unknown[] | null)[];
  fragment: string;
}

interface CompiledVariantConfig {
  baseFragment: string;
  variantNames: string[];
  fragmentTables: Record<string, string | undefined>[];
  rawVariantObjects: Record<string, ClassValue>[];
  defaultKeys: unknown[];
  compoundRows: CompiledCompoundRow[];
  defaultsForCompounds: Record<string, unknown>;
  relevantKeys: string[];
  defaultClassName: string | null;
  memoKind: number;
  memoKey0: string;
  memoKey1: string;
  memoWidth: number;
  scratchValues: unknown[];
  rowValues: unknown[];
  rowResults: string[];
  filledRows: number;
  victimRow: number;
}

const normalizeVariantKey = (value: unknown): unknown =>
  typeof value === "boolean" ? (value ? "true" : "false") : value === 0 ? "0" : value;

const compileCompoundRow = (entry: Record<string, unknown>): CompiledCompoundRow => {
  const selectorKeys: string[] = [];
  const selectorValues: unknown[] = [];
  const selectorArrays: (unknown[] | null)[] = [];
  for (const entryKey of Object.keys(entry)) {
    if (entryKey === "class" || entryKey === "className") continue;
    const selectorValue = entry[entryKey];
    selectorKeys.push(entryKey);
    selectorValues.push(selectorValue);
    selectorArrays.push(Array.isArray(selectorValue) ? selectorValue : null);
  }
  const classFragment = resolveClassValue(entry.class as ClassValue);
  const classNameFragment = resolveClassValue(entry.className as ClassValue);
  const fragment =
    classFragment && classNameFragment
      ? classFragment + " " + classNameFragment
      : classFragment || classNameFragment;
  return { selectorKeys, selectorValues, selectorArrays, fragment };
};

// The config is treated as frozen from the first call onward: upstream re-reads
// it live per call, but the 58-repo corpus showed zero post-creation mutation,
// so every static piece (base, variant values, compound classes, defaults) is
// flattened to its final string fragment here, once.
const compileVariantConfig = (
  base: ClassValue,
  config: RawVariantConfig | null | undefined,
): CompiledVariantConfig => {
  const baseFragment = resolveClassValue(base);
  const variants = config?.variants;
  const variantNames = variants == null ? [] : Object.keys(variants);
  const fragmentTables: Record<string, string | undefined>[] = [];
  const rawVariantObjects: Record<string, ClassValue>[] = [];
  const defaultKeys: unknown[] = [];
  const defaultVariants = config?.defaultVariants;
  for (const variantName of variantNames) {
    const variantObject = variants![variantName]!;
    const fragmentTable: Record<string, string | undefined> = Object.create(null);
    for (const valueKey of Object.keys(variantObject)) {
      fragmentTable[valueKey] = resolveClassValue(variantObject[valueKey]);
    }
    fragmentTables.push(fragmentTable);
    rawVariantObjects.push(variantObject);
    defaultKeys.push(normalizeVariantKey(defaultVariants?.[variantName]));
  }

  // The no-variants config ignores compoundVariants entirely (upstream
  // early-exits to cx(base, class, className) before reading them).
  const compoundRows: CompiledCompoundRow[] = [];
  if (variants != null && config?.compoundVariants) {
    for (const entry of config.compoundVariants) compoundRows.push(compileCompoundRow(entry));
  }

  // A spread object (not Object.create(null)) on purpose: upstream matches
  // compounds against `{...defaultVariants, ...props}[key]`, so a selector key
  // like "toString" must resolve through Object.prototype, not to undefined.
  const defaultsForCompounds: Record<string, unknown> = { ...defaultVariants };

  const relevantKeys: string[] = [];
  const seenRelevantKeys: Record<string, boolean> = Object.create(null);
  for (const variantName of variantNames) {
    seenRelevantKeys[variantName] = true;
    relevantKeys.push(variantName);
  }
  for (const compoundRow of compoundRows) {
    for (const selectorKey of compoundRow.selectorKeys) {
      if (seenRelevantKeys[selectorKey]) continue;
      seenRelevantKeys[selectorKey] = true;
      relevantKeys.push(selectorKey);
    }
  }

  // The fast memo lane pads 0/1-key configs to the fixed four-slot layout
  // [key0, key1, class, className] (a missing key slot duplicates its
  // neighbor's read, which compares equal by construction), so one unrolled
  // scan with the values held in locals serves the 85% of real configs that
  // declare at most two relevant keys.
  const relevantKeyCount = relevantKeys.length;
  const naturalWidth = relevantKeyCount + 2;
  const isMemoizable = naturalWidth <= CVA_MEMO_MAX_VALUE_SLOTS;
  const isFastLane = isMemoizable && relevantKeyCount <= 2;
  const width = isFastLane ? 4 : naturalWidth;
  return {
    baseFragment,
    variantNames,
    fragmentTables,
    rawVariantObjects,
    defaultKeys,
    compoundRows,
    defaultsForCompounds,
    relevantKeys,
    defaultClassName: null,
    memoKind: isFastLane ? 1 : isMemoizable ? 2 : 0,
    memoKey0: relevantKeys[0] ?? "class",
    memoKey1: relevantKeys[1] ?? relevantKeys[0] ?? "class",
    memoWidth: isMemoizable ? width : 0,
    scratchValues: isMemoizable ? createFilledArray<unknown>(width, undefined) : [],
    rowValues: isMemoizable ? createFilledArray<unknown>(CVA_MEMO_ROWS * width, undefined) : [],
    rowResults: isMemoizable ? createFilledArray(CVA_MEMO_ROWS, "") : [],
    filledRows: 0,
    victimRow: 0,
  };
};

const hasOwnPropertyCheck = Object.prototype.hasOwnProperty;

const resolveVariantClassName = (
  compiled: CompiledVariantConfig,
  props: Record<string, unknown> | undefined,
): string => {
  let result = compiled.baseFragment;

  const variantNames = compiled.variantNames;
  for (let index = 0; index < variantNames.length; index++) {
    const propValue = props === undefined ? undefined : props[variantNames[index]!];
    if (propValue === null) continue;
    const normalized = normalizeVariantKey(propValue);
    // `|| default` mirrors upstream falsyToString fall-through: "" and NaN
    // fall back to the default key, while "false"/"0" (already normalized
    // from false/0) stay and select their own keys.
    const variantKey = normalized || compiled.defaultKeys[index];
    // Own keys were pre-flattened into the table (resolveClassValue never
    // yields undefined, so undefined always means "not an own key"); the miss
    // falls back to a raw property read on the original variant object,
    // preserving upstream's prototype-chain and ToPropertyKey semantics.
    let fragment = compiled.fragmentTables[index]![variantKey as string];
    if (fragment === undefined) {
      fragment = resolveClassValue(compiled.rawVariantObjects[index]![variantKey as string]);
    }
    if (fragment) {
      if (result) result += " ";
      result += fragment;
    }
  }

  const compoundRows = compiled.compoundRows;
  for (let rowIndex = 0; rowIndex < compoundRows.length; rowIndex++) {
    const compoundRow = compoundRows[rowIndex]!;
    const selectorKeys = compoundRow.selectorKeys;
    let isMatch = true;
    for (let keyIndex = 0; keyIndex < selectorKeys.length; keyIndex++) {
      const selectorKey = selectorKeys[keyIndex]!;
      // An own prop with a non-undefined value (null included) overrides the
      // default, exactly like upstream's {...defaults, ...propsWithoutUndefined}.
      const effectiveValue =
        props !== undefined &&
        hasOwnPropertyCheck.call(props, selectorKey) &&
        props[selectorKey] !== undefined
          ? props[selectorKey]
          : compiled.defaultsForCompounds[selectorKey];
      const selectorArray = compoundRow.selectorArrays[keyIndex];
      const didKeyMatch =
        selectorArray !== null
          ? selectorArray.includes(effectiveValue)
          : effectiveValue === compoundRow.selectorValues[keyIndex];
      if (!didKeyMatch) {
        isMatch = false;
        break;
      }
    }
    if (isMatch && compoundRow.fragment) {
      if (result) result += " ";
      result += compoundRow.fragment;
    }
  }

  if (props !== undefined) {
    const adhocClass = resolveClassValue(props.class as ClassValue);
    if (adhocClass) {
      if (result) result += " ";
      result += adhocClass;
    }
    const adhocClassName = resolveClassValue(props.className as ClassValue);
    if (adhocClassName) {
      if (result) result += " ";
      result += adhocClassName;
    }
  }

  return result;
};

// Per-instance memo in the createCallSiteCn mold: only primitives are stored
// (=== on primitives guarantees a byte-identical result, while a truthy
// object/array can mutate between calls without changing identity), and every
// value is vetted for primitiveness BEFORE the first row write, so a row moves
// atomically from its old entry to the new one (the store loop itself runs no
// user code) and a half-written row can never be served. That atomicity is
// what lets filledRows bound the scan in place of per-row validity flags:
// every row below it holds a complete entry. The key is the resolved
// relevant-prop vector (declared variants plus compound selector keys) plus
// the class/className slots, so a memo hit returns the SAME string instance
// per combination — which keeps a wrapping cn() on its whole-string cache
// hits.
const resolveMemoMiss = (
  compiled: CompiledVariantConfig,
  propRecord: Record<string, unknown>,
): string => {
  const memoWidth = compiled.memoWidth;
  const scratchValues = compiled.scratchValues;
  const resolvedClassName = resolveVariantClassName(compiled, propRecord);
  let slot = 0;
  for (; slot < memoWidth; slot++) {
    const value = scratchValues[slot];
    if (value !== null && (typeof value === "object" || typeof value === "function")) break;
  }
  if (slot === memoWidth) {
    const rowValues = compiled.rowValues;
    const victim = compiled.victimRow;
    const storeBase = victim * memoWidth;
    for (slot = 0; slot < memoWidth; slot++) rowValues[storeBase + slot] = scratchValues[slot];
    compiled.rowResults[victim] = resolvedClassName;
    if (victim === compiled.filledRows) compiled.filledRows = victim + 1;
    compiled.victimRow = victim + 1 === CVA_MEMO_ROWS ? 0 : victim + 1;
  }
  return resolvedClassName;
};

// The four-slot lane: reads land in locals and the unrolled compare touches no
// scratch storage on a hit, which cuts the hit cost roughly in half on both
// engines; the scratch vector is filled only when the scan falls through to
// the outlined miss/store tail.
const resolveThroughFastMemo = (
  compiled: CompiledVariantConfig,
  propRecord: Record<string, unknown>,
): string => {
  const value0 = propRecord[compiled.memoKey0];
  const value1 = propRecord[compiled.memoKey1];
  const adhocClass = propRecord.class;
  const adhocClassName = propRecord.className;
  const rowValues = compiled.rowValues;
  const rowLimit = compiled.filledRows;
  for (let row = 0; row < rowLimit; row++) {
    const rowBase = row * 4;
    if (
      value0 === rowValues[rowBase] &&
      value1 === rowValues[rowBase + 1] &&
      adhocClass === rowValues[rowBase + 2] &&
      adhocClassName === rowValues[rowBase + 3]
    ) {
      return compiled.rowResults[row]!;
    }
  }
  const scratchValues = compiled.scratchValues;
  scratchValues[0] = value0;
  scratchValues[1] = value1;
  scratchValues[2] = adhocClass;
  scratchValues[3] = adhocClassName;
  return resolveMemoMiss(compiled, propRecord);
};

const resolveThroughMemo = (
  compiled: CompiledVariantConfig,
  propRecord: Record<string, unknown>,
): string => {
  const memoWidth = compiled.memoWidth;
  const relevantKeys = compiled.relevantKeys;
  const relevantKeyCount = relevantKeys.length;
  const scratchValues = compiled.scratchValues;
  for (let index = 0; index < relevantKeyCount; index++) {
    scratchValues[index] = propRecord[relevantKeys[index]!];
  }
  scratchValues[relevantKeyCount] = propRecord.class;
  scratchValues[relevantKeyCount + 1] = propRecord.className;

  const rowValues = compiled.rowValues;
  const rowLimit = compiled.filledRows;
  for (let row = 0; row < rowLimit; row++) {
    const rowBase = row * memoWidth;
    let slot = 0;
    while (slot < memoWidth && scratchValues[slot] === rowValues[rowBase + slot]) slot++;
    if (slot === memoWidth) return compiled.rowResults[row]!;
  }

  return resolveMemoMiss(compiled, propRecord);
};

export const cva = <T>(base?: ClassValue, config?: CvaConfig<T>) => {
  let compiled: CompiledVariantConfig | null = null;

  return (props?: CvaProps<T>): string => {
    if (compiled === null) {
      compiled = compileVariantConfig(base, config as RawVariantConfig | null | undefined);
    }
    if (props == null) {
      let defaultClassName = compiled.defaultClassName;
      if (defaultClassName === null) {
        defaultClassName = resolveVariantClassName(compiled, undefined);
        compiled.defaultClassName = defaultClassName;
      }
      return defaultClassName;
    }
    const propRecord = props as Record<string, unknown>;
    const memoKind = compiled.memoKind;
    if (memoKind === 1) return resolveThroughFastMemo(compiled, propRecord);
    if (memoKind === 2) return resolveThroughMemo(compiled, propRecord);
    return resolveVariantClassName(compiled, propRecord);
  };
};
