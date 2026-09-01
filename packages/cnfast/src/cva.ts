// Byte parity with class-variance-authority 0.7.1 holds for configs treated as frozen
// after the first call and for plain-object props: own enumerable properties only.
// Configs mutated between calls, inherited enumerable prop keys, and non-enumerable own
// props can diverge from upstream (the cached paths read props by key, so they cannot
// tell an inherited value from an own one). None of these shapes occur in real usage; the
// 58-repo corpus study found zero.
import { type ClassValue, clsx, resolveClassValue } from "./clsx.js";
import { CVA_MEMO_MAX_VALUE_SLOTS, CVA_MEMO_ROWS, CVA_TABLE_MAX_SLOTS } from "./lib/constants.js";
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

interface CombinationTable {
  slotCount: number;
  stateIndexes: Record<string, number>[];
  stateCounts: number[];
  defaultStates: number[];
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
  memoWidth: number;
  scratchValues: unknown[];
  rowValues: unknown[];
  rowValidFlags: boolean[];
  rowResults: string[];
  victimRow: number;
  // The table pieces are held flat rather than behind the CombinationTable
  // object: the extra pointer chase per call measured 1.5% on V8.
  tableSlotCount: number;
  tableStateIndexes: Record<string, number>[];
  tableStateCounts: number[];
  tableDefaultStates: number[];
  tableResults: (string | null)[];
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

// Without compounds (95% of real configs) the output of a class-less call is a
// pure function of each variant's RESOLVED lookup key, so the whole answer space
// is enumerable: per variant, one state per declared value key (already the
// ToPropertyKey strings via Object.keys), one for the resolved default, and
// state 0 for a null prop (which suppresses both the key and the default).
// Combinations are addressed by the fused state slot and interned there
// permanently, filled lazily so creation stays free.
const compileCombinationTable = (
  variantNames: string[],
  fragmentTables: Record<string, string | undefined>[],
  defaultKeys: unknown[],
): CombinationTable | null => {
  const stateIndexes: Record<string, number>[] = [];
  const stateCounts: number[] = [];
  const defaultStates: number[] = [];
  let slotCount = 1;
  for (let index = 0; index < variantNames.length; index++) {
    const defaultKey = defaultKeys[index];
    // Coercing an object or symbol default to its lookup key here would move an
    // observable step (a custom toString, or a symbol that is not a string key
    // at all) off the call that actually falls back to it.
    if (defaultKey !== null && (typeof defaultKey === "object" || typeof defaultKey === "symbol")) {
      return null;
    }
    const stateIndex: Record<string, number> = Object.create(null);
    let stateCount = 1;
    for (const valueKey of Object.keys(fragmentTables[index]!)) stateIndex[valueKey] = stateCount++;
    const defaultKeyString = String(defaultKey);
    if (stateIndex[defaultKeyString] === undefined) stateIndex[defaultKeyString] = stateCount++;
    stateIndexes.push(stateIndex);
    stateCounts.push(stateCount);
    defaultStates.push(stateIndex[defaultKeyString]!);
    slotCount *= stateCount;
    if (slotCount > CVA_TABLE_MAX_SLOTS) return null;
  }
  return { slotCount, stateIndexes, stateCounts, defaultStates };
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

  const width = relevantKeys.length + 2;
  const isMemoizable = width <= CVA_MEMO_MAX_VALUE_SLOTS;
  const combinationTable =
    compoundRows.length === 0 && isMemoizable
      ? compileCombinationTable(variantNames, fragmentTables, defaultKeys)
      : null;

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
    memoWidth: isMemoizable ? width : 0,
    scratchValues: isMemoizable ? createFilledArray<unknown>(width, undefined) : [],
    rowValues: isMemoizable ? createFilledArray<unknown>(CVA_MEMO_ROWS * width, undefined) : [],
    rowValidFlags: isMemoizable ? createFilledArray(CVA_MEMO_ROWS, false) : [],
    rowResults: isMemoizable ? createFilledArray(CVA_MEMO_ROWS, "") : [],
    victimRow: 0,
    tableSlotCount: combinationTable === null ? 0 : combinationTable.slotCount,
    tableStateIndexes: combinationTable === null ? [] : combinationTable.stateIndexes,
    tableStateCounts: combinationTable === null ? [] : combinationTable.stateCounts,
    tableDefaultStates: combinationTable === null ? [] : combinationTable.defaultStates,
    tableResults:
      combinationTable === null
        ? []
        : createFilledArray<string | null>(combinationTable.slotCount, null),
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
// object/array can mutate between calls without changing identity), the victim
// row is invalidated before the store loop so a mid-store bailout on an object
// value can never leave a half-written row serveable, and validity lives in
// rowValidFlags rather than in-band sentinel values. The key is the resolved
// relevant-prop vector (declared variants plus compound selector keys) plus the
// class/className slots, so a memo hit returns the SAME string instance per
// combination — which keeps a wrapping cn() on its whole-string cache hits.
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
  const rowValidFlags = compiled.rowValidFlags;
  for (let row = 0; row < CVA_MEMO_ROWS; row++) {
    if (!rowValidFlags[row]) continue;
    const rowBase = row * memoWidth;
    let slot = 0;
    while (slot < memoWidth && scratchValues[slot] === rowValues[rowBase + slot]) slot++;
    if (slot === memoWidth) return compiled.rowResults[row]!;
  }

  const resolvedClassName = resolveVariantClassName(compiled, propRecord);
  const victim = compiled.victimRow;
  rowValidFlags[victim] = false;
  const storeBase = victim * memoWidth;
  let slot = 0;
  for (; slot < memoWidth; slot++) {
    const value = scratchValues[slot];
    if (value !== null && (typeof value === "object" || typeof value === "function")) break;
    rowValues[storeBase + slot] = value;
  }
  if (slot === memoWidth) {
    compiled.victimRow = victim + 1 === CVA_MEMO_ROWS ? 0 : victim + 1;
    rowValidFlags[victim] = true;
    compiled.rowResults[victim] = resolvedClassName;
  }
  return resolvedClassName;
};

// The keyed reads coerce exactly like upstream's `variants[v][variantKey]`
// (ToPropertyKey on the normalized value), so two prop values share a slot
// precisely when upstream would read the same fragment; a value whose key was
// never enumerated (an unknown value, a symbol, or one reachable only through
// the variant object's prototype chain) has no slot and falls back to the memo,
// which keeps upstream's raw-lookup semantics.
const resolveThroughTable = (
  compiled: CompiledVariantConfig,
  propRecord: Record<string, unknown>,
): string => {
  const adhocClass = propRecord.class;
  const adhocClassName = propRecord.className;
  if (adhocClass !== undefined || adhocClassName !== undefined) {
    // Class values are unbounded, so they are never tabled. A non-null object
    // one cannot be memoized either: rows hold primitives only, so neither the
    // row scan nor the store could succeed.
    if (
      (typeof adhocClass === "object" && adhocClass !== null) ||
      (typeof adhocClassName === "object" && adhocClassName !== null)
    ) {
      return resolveVariantClassName(compiled, propRecord);
    }
    return resolveThroughMemo(compiled, propRecord);
  }

  const variantNames = compiled.variantNames;
  const stateIndexes = compiled.tableStateIndexes;
  const stateCounts = compiled.tableStateCounts;
  const defaultStates = compiled.tableDefaultStates;
  let slot = 0;
  for (let index = 0; index < variantNames.length; index++) {
    const propValue = propRecord[variantNames[index]!];
    let state = 0;
    if (propValue !== null) {
      const normalized = normalizeVariantKey(propValue);
      const resolvedState = normalized
        ? stateIndexes[index]![normalized as string]
        : defaultStates[index]!;
      if (resolvedState === undefined) return resolveThroughMemo(compiled, propRecord);
      state = resolvedState;
    }
    slot = slot * stateCounts[index]! + state;
  }
  const tabled = compiled.tableResults[slot]!;
  if (tabled !== null) return tabled;
  const resolvedClassName = resolveVariantClassName(compiled, propRecord);
  compiled.tableResults[slot] = resolvedClassName;
  return resolvedClassName;
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
    if (compiled.tableSlotCount !== 0) return resolveThroughTable(compiled, propRecord);
    if (compiled.memoWidth === 0) return resolveVariantClassName(compiled, propRecord);
    return resolveThroughMemo(compiled, propRecord);
  };
};
