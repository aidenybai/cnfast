import { describe, expect, it } from "vitest";
import { cva as referenceCva } from "class-variance-authority";
import { cva } from "./src/index.js";
import { createSeededRandom, type SeededRandom } from "./utils/create-seeded-random";

interface CvaRuntimeProps {
  [propName: string]: unknown;
}

interface CvaInstancePair {
  cnfast: (props?: CvaRuntimeProps) => string;
  reference: (props?: CvaRuntimeProps) => string;
  variantNames: string[];
  valueKeys: string[];
}

interface ParityMismatch {
  configIndex: number;
  props: string;
  actualOutput: string;
  referenceOutput: string;
}

const FUZZ_CONFIG_COUNT = 80;
const FUZZ_CALL_COUNT = 20_000;
const MAX_RECORDED_MISMATCH_COUNT = 10;

const VARIANT_NAME_POOL = ["intent", "size", "disabled", "tone", "m", "0", "12", "class", "ghost"];
const VALUE_KEY_POOL = [
  "primary",
  "secondary",
  "true",
  "false",
  "0",
  "-1",
  "1",
  "undefined",
  "null",
  "",
];
const CLASS_TOKEN_POOL = [
  "flex",
  "px-2 py-1",
  "bg-blue-500 text-white",
  "button--danger",
  "hover:bg-red-600",
  "  double  spaced ",
  "m-0",
  "",
];

const pickFrom = <T>(random: SeededRandom, pool: readonly T[]): T =>
  pool[Math.floor(random.getNext() * pool.length)]!;

const rollClassValue = (random: SeededRandom, depth: number): unknown => {
  const randomValue = random.getNext();
  if (randomValue < 0.45 || depth > 2) return pickFrom(random, CLASS_TOKEN_POOL);
  if (randomValue < 0.55) return Math.floor(random.getNext() * 3);
  if (randomValue < 0.65) return null;
  if (randomValue < 0.8) {
    return {
      [pickFrom(random, CLASS_TOKEN_POOL) || "empty-key"]: random.getNext() < 0.5,
      bat: null,
      baz: random.getNext() < 0.5,
    };
  }
  const arrayLength = 1 + Math.floor(random.getNext() * 3);
  const nestedArray: unknown[] = [];
  for (let index = 0; index < arrayLength; index++) {
    nestedArray.push(rollClassValue(random, depth + 1));
  }
  return nestedArray;
};

const rollSelectorValue = (random: SeededRandom, valueKeys: string[]): unknown => {
  const randomValue = random.getNext();
  if (randomValue < 0.4) return pickFrom(random, valueKeys);
  if (randomValue < 0.5) return random.getNext() < 0.5;
  if (randomValue < 0.58) return 0;
  if (randomValue < 0.64) return Math.floor(random.getNext() * 3) - 1;
  if (randomValue < 0.7) return null;
  if (randomValue < 0.76) return undefined;
  const arrayLength = 1 + Math.floor(random.getNext() * 3);
  const selectorArray: unknown[] = [];
  for (let index = 0; index < arrayLength; index++) {
    const elementRoll = random.getNext();
    if (elementRoll < 0.1) selectorArray.push(Number.NaN);
    else if (elementRoll < 0.25) selectorArray.push(random.getNext() < 0.5);
    else if (elementRoll < 0.35) selectorArray.push(0);
    else selectorArray.push(pickFrom(random, valueKeys));
  }
  return selectorArray;
};

const rollDefaultValue = (random: SeededRandom, valueKeys: string[]): unknown => {
  const randomValue = random.getNext();
  if (randomValue < 0.5) return pickFrom(random, valueKeys);
  if (randomValue < 0.62) return random.getNext() < 0.5;
  if (randomValue < 0.72) return 0;
  if (randomValue < 0.8) return "";
  if (randomValue < 0.88) return null;
  return "bogus-default";
};

const generateInstancePair = (random: SeededRandom, configIndex: number): CvaInstancePair => {
  const base = (() => {
    const randomValue = random.getNext();
    if (randomValue < 0.3) return undefined;
    if (randomValue < 0.4) return null;
    if (randomValue < 0.5) return ["base", ["nested-base", { "base-toggle": true }]];
    return pickFrom(random, CLASS_TOKEN_POOL);
  })();

  const shapeRoll = random.getNext();
  const variantNames: string[] = [];
  const valueKeys: string[] = ["primary"];
  let config: CvaRuntimeProps | undefined;

  if (shapeRoll < 0.08) {
    config =
      random.getNext() < 0.5
        ? undefined
        : { compoundVariants: [{ class: "ignored-without-variants" }] };
  } else {
    const variants: CvaRuntimeProps = {};
    if (shapeRoll >= 0.16) {
      const variantCount = 1 + Math.floor(random.getNext() * 5);
      for (let index = 0; index < variantCount; index++) {
        const variantName = pickFrom(random, VARIANT_NAME_POOL);
        if (variants[variantName] !== undefined) continue;
        variantNames.push(variantName);
        const valueMap: CvaRuntimeProps = {};
        const valueCount = 1 + Math.floor(random.getNext() * 4);
        for (let valueIndex = 0; valueIndex < valueCount; valueIndex++) {
          const valueKey = pickFrom(random, VALUE_KEY_POOL);
          if (!valueKeys.includes(valueKey)) valueKeys.push(valueKey);
          valueMap[valueKey] = rollClassValue(random, 0);
        }
        variants[variantName] = valueMap;
      }
    }

    const defaultVariants: CvaRuntimeProps = {};
    for (const variantName of variantNames) {
      if (random.getNext() < 0.5) {
        defaultVariants[variantName] = rollDefaultValue(random, valueKeys);
      }
    }

    const compoundVariants: CvaRuntimeProps[] = [];
    const compoundCount = random.getNext() < 0.5 ? 0 : Math.floor(random.getNext() * 6);
    for (let index = 0; index < compoundCount; index++) {
      const compoundVariant: CvaRuntimeProps = {};
      const selectorCount = Math.floor(random.getNext() * 3);
      for (let selectorIndex = 0; selectorIndex < selectorCount; selectorIndex++) {
        const selectorKey =
          random.getNext() < 0.8 && variantNames.length > 0
            ? pickFrom(random, variantNames)
            : pickFrom(random, ["undeclared", "extra", "tone"]);
        compoundVariant[selectorKey] = rollSelectorValue(random, valueKeys);
      }
      const classShapeRoll = random.getNext();
      if (classShapeRoll < 0.45) compoundVariant.class = rollClassValue(random, 0);
      else if (classShapeRoll < 0.9) compoundVariant.className = rollClassValue(random, 0);
      else {
        compoundVariant.class = rollClassValue(random, 0);
        compoundVariant.className = rollClassValue(random, 0);
      }
      compoundVariants.push(compoundVariant);
    }

    config = { variants };
    if (random.getNext() >= 0.2) config.defaultVariants = defaultVariants;
    if (random.getNext() >= 0.2) config.compoundVariants = compoundVariants;
  }

  if (configIndex % 7 === 0 && config?.variants) {
    (config.variants as CvaRuntimeProps)["undefined"] = { undefined: "matched-undefined-key" };
    if (!variantNames.includes("undefined")) variantNames.push("undefined");
  }

  return {
    cnfast: cva(base, config as never) as (props?: CvaRuntimeProps) => string,
    reference: referenceCva(base, config as never) as (props?: CvaRuntimeProps) => string,
    variantNames,
    valueKeys,
  };
};

const rollPropValue = (random: SeededRandom, valueKeys: string[]): unknown => {
  const randomValue = random.getNext();
  if (randomValue < 0.3) return pickFrom(random, valueKeys);
  if (randomValue < 0.38) return null;
  if (randomValue < 0.46) return undefined;
  if (randomValue < 0.52) return random.getNext() < 0.5;
  if (randomValue < 0.58) return 0;
  if (randomValue < 0.61) return -0;
  if (randomValue < 0.64) return "";
  if (randomValue < 0.67) return Number.NaN;
  if (randomValue < 0.73) return Math.floor(random.getNext() * 4) - 1;
  if (randomValue < 0.79) return "bogus";
  if (randomValue < 0.85) return pickFrom(random, ["toString", "constructor", "hasOwnProperty"]);
  if (randomValue < 0.93) return [pickFrom(random, valueKeys)];
  return { nested: true };
};

const rollProps = (
  random: SeededRandom,
  instancePair: CvaInstancePair,
): CvaRuntimeProps | undefined => {
  const shapeRoll = random.getNext();
  if (shapeRoll < 0.08) return undefined;
  const props: CvaRuntimeProps = {};
  for (const variantName of instancePair.variantNames) {
    if (random.getNext() < 0.35) continue;
    props[variantName] = rollPropValue(random, instancePair.valueKeys);
  }
  if (random.getNext() < 0.15)
    props["aCheekyExtraProp"] = rollPropValue(random, instancePair.valueKeys);
  if (random.getNext() < 0.1) props["undeclared"] = rollPropValue(random, instancePair.valueKeys);
  const classRoll = random.getNext();
  if (classRoll < 0.25) props.class = rollClassValue(random, 0);
  else if (classRoll < 0.5) props.className = rollClassValue(random, 0);
  else if (classRoll < 0.58) {
    props.class = rollClassValue(random, 0);
    props.className = rollClassValue(random, 0);
  }
  return props;
};

describe("cva differential fuzz vs class-variance-authority@0.7.1", () => {
  it("matches the reference byte-for-byte across seeded configs and prop rolls", () => {
    const random = createSeededRandom(0xc4a_0_7_1);
    const instancePairs: CvaInstancePair[] = [];
    for (let configIndex = 0; configIndex < FUZZ_CONFIG_COUNT; configIndex++) {
      instancePairs.push(generateInstancePair(random, configIndex));
    }

    const mismatches: ParityMismatch[] = [];
    for (let callIndex = 0; callIndex < FUZZ_CALL_COUNT; callIndex++) {
      const configIndex = Math.floor(random.getNext() * instancePairs.length);
      const instancePair = instancePairs[configIndex]!;
      const props = rollProps(random, instancePair);
      const actualOutput = instancePair.cnfast(props);
      const referenceOutput = instancePair.reference(props);
      if (actualOutput !== referenceOutput && mismatches.length < MAX_RECORDED_MISMATCH_COUNT) {
        mismatches.push({
          configIndex,
          props: JSON.stringify(props, (_key, value) =>
            value === undefined ? "«undefined»" : value,
          ),
          actualOutput,
          referenceOutput,
        });
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("returns byte-identical output on repeated identical calls", () => {
    const random = createSeededRandom(0xdead_beef);
    for (let configIndex = 0; configIndex < 8; configIndex++) {
      const instancePair = generateInstancePair(random, configIndex);
      const props = rollProps(random, instancePair);
      const firstOutput = instancePair.cnfast(props);
      expect(instancePair.cnfast(props)).toBe(firstOutput);
      expect(instancePair.cnfast(props)).toBe(firstOutput);
      expect(firstOutput).toBe(instancePair.reference(props));
    }
  });

  it("keeps independent state across instances of the same config", () => {
    const config = {
      variants: {
        intent: { primary: "button--primary", secondary: "button--secondary" },
        size: { small: "button--small", large: "button--large" },
      },
      defaultVariants: { intent: "primary" },
    };
    const firstCnfast = cva("button", config as never);
    const secondCnfast = cva("button", config as never);
    const reference = referenceCva("button", config as never);
    const propRolls = [
      undefined,
      {},
      { intent: "secondary" },
      { size: "small" },
      { intent: null },
      { intent: "secondary", size: "large", className: "adhoc" },
    ];
    for (const props of propRolls) {
      expect(firstCnfast(props as never)).toBe(reference(props as never));
      expect(secondCnfast(props as never)).toBe(reference(props as never));
      expect(firstCnfast(props as never)).toBe(reference(props as never));
    }
  });
});
