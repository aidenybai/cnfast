// Parity assumes configs are immutable after the first call and props are plain objects.
// Mutated configs and inherited or non-enumerable props can differ from upstream; none
// appeared in the 58-repository corpus.
import { type ClassValue, clsx, resolveClassValue } from "./clsx.js";
import { CVA_MEMO_ROW_COUNT, CVA_MEMO_VALUE_SLOTS_PER_ROW } from "./lib/constants.js";
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

interface RuntimeCvaProps {
  [propName: string]: unknown;
  class?: ClassValue;
  className?: ClassValue;
}

interface RuntimeCvaConfig {
  variants?: Record<string, Record<string, ClassValue>>;
  defaultVariants?: Record<string, unknown>;
  compoundVariants?: RuntimeCvaProps[];
}

interface CompiledCompoundVariant {
  selectorKeys: string[];
  selectorValues: unknown[];
  selectorArrays: (unknown[] | null)[];
  classNameFragment: string;
}

interface CompiledCvaConfig {
  baseFragment: string;
  variantNames: string[];
  variantClassNamesByKey: Record<string, string | undefined>[];
  variantDefinitions: Record<string, ClassValue>[];
  defaultVariantKeys: unknown[];
  compiledCompoundVariants: CompiledCompoundVariant[];
  compoundDefaultValues: Record<string, unknown>;
  memoPropNames: string[];
  defaultClassName: string | null;
  memoValueCountPerRow: number;
  memoCandidateValues: unknown[];
  memoizedValues: unknown[];
  memoRowValidity: boolean[];
  memoizedResults: string[];
  nextMemoRowIndex: number;
}

const normalizeVariantKey = (value: unknown): unknown =>
  typeof value === "boolean" ? (value ? "true" : "false") : value === 0 ? "0" : value;

const compileCompoundVariant = (compoundVariant: RuntimeCvaProps): CompiledCompoundVariant => {
  const selectorKeys: string[] = [];
  const selectorValues: unknown[] = [];
  const selectorArrays: (unknown[] | null)[] = [];
  for (const selectorKey of Object.keys(compoundVariant)) {
    if (selectorKey === "class" || selectorKey === "className") continue;
    const selectorValue = compoundVariant[selectorKey];
    selectorKeys.push(selectorKey);
    selectorValues.push(selectorValue);
    selectorArrays.push(Array.isArray(selectorValue) ? selectorValue : null);
  }
  const classFragment = resolveClassValue(compoundVariant.class);
  const classNameFragment = resolveClassValue(compoundVariant.className);
  const combinedClassNameFragment =
    classFragment && classNameFragment
      ? classFragment + " " + classNameFragment
      : classFragment || classNameFragment;
  return {
    selectorKeys,
    selectorValues,
    selectorArrays,
    classNameFragment: combinedClassNameFragment,
  };
};

// Upstream re-reads configs per call, but the corpus had no post-creation mutation.
// Flattening static class values once keeps the call path allocation-free.
const compileCvaConfig = (
  base: ClassValue,
  config: RuntimeCvaConfig | null | undefined,
): CompiledCvaConfig => {
  const baseFragment = resolveClassValue(base);
  const variants = config?.variants;
  const variantNames = variants == null ? [] : Object.keys(variants);
  const variantClassNamesByKey: Record<string, string | undefined>[] = [];
  const variantDefinitions: Record<string, ClassValue>[] = [];
  const defaultVariantKeys: unknown[] = [];
  const defaultVariants = config?.defaultVariants;
  for (const variantName of variantNames) {
    const variantDefinition = variants![variantName]!;
    const classNamesByKey: Record<string, string | undefined> = Object.create(null);
    for (const valueKey of Object.keys(variantDefinition)) {
      classNamesByKey[valueKey] = resolveClassValue(variantDefinition[valueKey]);
    }
    variantClassNamesByKey.push(classNamesByKey);
    variantDefinitions.push(variantDefinition);
    defaultVariantKeys.push(normalizeVariantKey(defaultVariants?.[variantName]));
  }

  // Upstream ignores compound variants when the variants field is absent.
  const compiledCompoundVariants: CompiledCompoundVariant[] = [];
  if (variants != null && config?.compoundVariants) {
    for (const compoundVariant of config.compoundVariants) {
      compiledCompoundVariants.push(compileCompoundVariant(compoundVariant));
    }
  }

  // A spread object (not Object.create(null)) on purpose: upstream matches
  // compounds against `{...defaultVariants, ...props}[key]`, so a selector key
  // like "toString" must resolve through Object.prototype, not to undefined.
  const compoundDefaultValues: Record<string, unknown> = { ...defaultVariants };

  const memoPropNames: string[] = [];
  const seenMemoPropNames: Record<string, boolean> = Object.create(null);
  for (const variantName of variantNames) {
    seenMemoPropNames[variantName] = true;
    memoPropNames.push(variantName);
  }
  for (const compiledCompoundVariant of compiledCompoundVariants) {
    for (const selectorKey of compiledCompoundVariant.selectorKeys) {
      if (seenMemoPropNames[selectorKey]) continue;
      seenMemoPropNames[selectorKey] = true;
      memoPropNames.push(selectorKey);
    }
  }

  const memoValueCountPerRow = memoPropNames.length + 2;
  const isMemoizable = memoValueCountPerRow <= CVA_MEMO_VALUE_SLOTS_PER_ROW;
  return {
    baseFragment,
    variantNames,
    variantClassNamesByKey,
    variantDefinitions,
    defaultVariantKeys,
    compiledCompoundVariants,
    compoundDefaultValues,
    memoPropNames,
    defaultClassName: null,
    memoValueCountPerRow: isMemoizable ? memoValueCountPerRow : 0,
    memoCandidateValues: isMemoizable
      ? createFilledArray<unknown>(memoValueCountPerRow, undefined)
      : [],
    memoizedValues: isMemoizable
      ? createFilledArray<unknown>(CVA_MEMO_ROW_COUNT * memoValueCountPerRow, undefined)
      : [],
    memoRowValidity: isMemoizable ? createFilledArray(CVA_MEMO_ROW_COUNT, false) : [],
    memoizedResults: isMemoizable ? createFilledArray(CVA_MEMO_ROW_COUNT, "") : [],
    nextMemoRowIndex: 0,
  };
};

const hasOwnPropertyCheck = Object.prototype.hasOwnProperty;

const resolveVariantClassName = (
  compiledConfig: CompiledCvaConfig,
  props: RuntimeCvaProps | undefined,
): string => {
  let className = compiledConfig.baseFragment;

  const variantNames = compiledConfig.variantNames;
  for (let variantIndex = 0; variantIndex < variantNames.length; variantIndex++) {
    const propValue = props === undefined ? undefined : props[variantNames[variantIndex]!];
    if (propValue === null) continue;
    const normalizedVariantKey = normalizeVariantKey(propValue);
    // `|| default` mirrors upstream falsyToString fall-through: "" and NaN
    // fall back to the default key, while "false"/"0" (already normalized
    // from false/0) stay and select their own keys.
    const variantKey = normalizedVariantKey || compiledConfig.defaultVariantKeys[variantIndex];
    // Own keys were pre-flattened into the table (resolveClassValue never
    // yields undefined, so undefined always means "not an own key"); the miss
    // falls back to a raw property read on the original variant object,
    // preserving upstream's prototype-chain and ToPropertyKey semantics.
    let variantClassName =
      compiledConfig.variantClassNamesByKey[variantIndex]![variantKey as string];
    if (variantClassName === undefined) {
      variantClassName = resolveClassValue(
        compiledConfig.variantDefinitions[variantIndex]![variantKey as string],
      );
    }
    if (variantClassName) {
      if (className) className += " ";
      className += variantClassName;
    }
  }

  const compiledCompoundVariants = compiledConfig.compiledCompoundVariants;
  for (let compoundIndex = 0; compoundIndex < compiledCompoundVariants.length; compoundIndex++) {
    const compiledCompoundVariant = compiledCompoundVariants[compoundIndex]!;
    const selectorKeys = compiledCompoundVariant.selectorKeys;
    let doesCompoundVariantMatch = true;
    for (let selectorIndex = 0; selectorIndex < selectorKeys.length; selectorIndex++) {
      const selectorKey = selectorKeys[selectorIndex]!;
      // An own prop with a non-undefined value (null included) overrides the
      // default, exactly like upstream's {...defaults, ...propsWithoutUndefined}.
      const selectedValue =
        props !== undefined &&
        hasOwnPropertyCheck.call(props, selectorKey) &&
        props[selectorKey] !== undefined
          ? props[selectorKey]
          : compiledConfig.compoundDefaultValues[selectorKey];
      const selectorArray = compiledCompoundVariant.selectorArrays[selectorIndex];
      const doesSelectorMatch =
        selectorArray !== null
          ? selectorArray.includes(selectedValue)
          : selectedValue === compiledCompoundVariant.selectorValues[selectorIndex];
      if (!doesSelectorMatch) {
        doesCompoundVariantMatch = false;
        break;
      }
    }
    if (doesCompoundVariantMatch && compiledCompoundVariant.classNameFragment) {
      if (className) className += " ";
      className += compiledCompoundVariant.classNameFragment;
    }
  }

  if (props !== undefined) {
    const additionalClass = resolveClassValue(props.class);
    if (additionalClass) {
      if (className) className += " ";
      className += additionalClass;
    }
    const additionalClassName = resolveClassValue(props.className);
    if (additionalClassName) {
      if (className) className += " ";
      className += additionalClassName;
    }
  }

  return className;
};

// Memoize only primitive prop vectors because object and array class values can mutate.
// Invalidate a row before filling it so an aborted store cannot expose partial data.
// Stable string identity also preserves wrapping cn() cache hits.
const resolveThroughMemo = (
  compiledConfig: CompiledCvaConfig,
  propRecord: RuntimeCvaProps,
): string => {
  const memoValueCountPerRow = compiledConfig.memoValueCountPerRow;
  const memoPropNames = compiledConfig.memoPropNames;
  const memoPropCount = memoPropNames.length;
  const memoCandidateValues = compiledConfig.memoCandidateValues;
  for (let memoPropIndex = 0; memoPropIndex < memoPropCount; memoPropIndex++) {
    memoCandidateValues[memoPropIndex] = propRecord[memoPropNames[memoPropIndex]!];
  }
  memoCandidateValues[memoPropCount] = propRecord.class;
  memoCandidateValues[memoPropCount + 1] = propRecord.className;

  const memoizedValues = compiledConfig.memoizedValues;
  const memoRowValidity = compiledConfig.memoRowValidity;
  for (let rowIndex = 0; rowIndex < CVA_MEMO_ROW_COUNT; rowIndex++) {
    if (!memoRowValidity[rowIndex]) continue;
    const rowStartIndex = rowIndex * memoValueCountPerRow;
    let memoValueIndex = 0;
    while (
      memoValueIndex < memoValueCountPerRow &&
      memoCandidateValues[memoValueIndex] === memoizedValues[rowStartIndex + memoValueIndex]
    ) {
      memoValueIndex++;
    }
    if (memoValueIndex === memoValueCountPerRow) return compiledConfig.memoizedResults[rowIndex]!;
  }

  const resolvedClassName = resolveVariantClassName(compiledConfig, propRecord);
  const nextMemoRowIndex = compiledConfig.nextMemoRowIndex;
  memoRowValidity[nextMemoRowIndex] = false;
  const rowStartIndex = nextMemoRowIndex * memoValueCountPerRow;
  let memoValueIndex = 0;
  for (; memoValueIndex < memoValueCountPerRow; memoValueIndex++) {
    const memoValue = memoCandidateValues[memoValueIndex];
    if (memoValue !== null && (typeof memoValue === "object" || typeof memoValue === "function"))
      break;
    memoizedValues[rowStartIndex + memoValueIndex] = memoValue;
  }
  if (memoValueIndex === memoValueCountPerRow) {
    compiledConfig.nextMemoRowIndex =
      nextMemoRowIndex + 1 === CVA_MEMO_ROW_COUNT ? 0 : nextMemoRowIndex + 1;
    memoRowValidity[nextMemoRowIndex] = true;
    compiledConfig.memoizedResults[nextMemoRowIndex] = resolvedClassName;
  }
  return resolvedClassName;
};

export const cva = <T>(base?: ClassValue, config?: CvaConfig<T>) => {
  let compiledConfig: CompiledCvaConfig | null = null;

  return (props?: CvaProps<T>): string => {
    if (compiledConfig === null) {
      compiledConfig = compileCvaConfig(base, config as RuntimeCvaConfig | null | undefined);
    }
    if (props == null) {
      let defaultClassName = compiledConfig.defaultClassName;
      if (defaultClassName === null) {
        defaultClassName = resolveVariantClassName(compiledConfig, undefined);
        compiledConfig.defaultClassName = defaultClassName;
      }
      return defaultClassName;
    }
    const propRecord = props as RuntimeCvaProps;
    if (compiledConfig.memoValueCountPerRow === 0) {
      return resolveVariantClassName(compiledConfig, propRecord);
    }
    return resolveThroughMemo(compiledConfig, propRecord);
  };
};
