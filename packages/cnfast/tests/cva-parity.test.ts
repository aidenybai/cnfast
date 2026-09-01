import { describe, expect, it } from "vitest";
import { cva as referenceCva } from "class-variance-authority";
import { cva } from "./src/index.js";
import { createSeededRandom, type SeededRandom } from "./utils/create-seeded-random";

type AnyProps = Record<string, unknown>;

interface CvaInstancePair {
  ported: (props?: AnyProps) => string;
  reference: (props?: AnyProps) => string;
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
  const roll = random.getNext();
  if (roll < 0.45 || depth > 2) return pickFrom(random, CLASS_TOKEN_POOL);
  if (roll < 0.55) return Math.floor(random.getNext() * 3);
  if (roll < 0.65) return null;
  if (roll < 0.8) {
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
  const roll = random.getNext();
  if (roll < 0.4) return pickFrom(random, valueKeys);
  if (roll < 0.5) return random.getNext() < 0.5;
  if (roll < 0.58) return 0;
  if (roll < 0.64) return Math.floor(random.getNext() * 3) - 1;
  if (roll < 0.7) return null;
  if (roll < 0.76) return undefined;
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
  const roll = random.getNext();
  if (roll < 0.5) return pickFrom(random, valueKeys);
  if (roll < 0.62) return random.getNext() < 0.5;
  if (roll < 0.72) return 0;
  if (roll < 0.8) return "";
  if (roll < 0.88) return null;
  return "bogus-default";
};

const generateInstancePair = (random: SeededRandom, configIndex: number): CvaInstancePair => {
  const base = (() => {
    const roll = random.getNext();
    if (roll < 0.3) return undefined;
    if (roll < 0.4) return null;
    if (roll < 0.5) return ["base", ["nested-base", { "base-toggle": true }]];
    return pickFrom(random, CLASS_TOKEN_POOL);
  })();

  const shapeRoll = random.getNext();
  const variantNames: string[] = [];
  const valueKeys: string[] = ["primary"];
  let config: AnyProps | undefined;

  if (shapeRoll < 0.08) {
    config =
      random.getNext() < 0.5
        ? undefined
        : { compoundVariants: [{ class: "ignored-without-variants" }] };
  } else {
    const variants: AnyProps = {};
    if (shapeRoll >= 0.16) {
      const variantCount = 1 + Math.floor(random.getNext() * 5);
      for (let index = 0; index < variantCount; index++) {
        const variantName = pickFrom(random, VARIANT_NAME_POOL);
        if (variants[variantName] !== undefined) continue;
        variantNames.push(variantName);
        const valueMap: AnyProps = {};
        const valueCount = 1 + Math.floor(random.getNext() * 4);
        for (let valueIndex = 0; valueIndex < valueCount; valueIndex++) {
          const valueKey = pickFrom(random, VALUE_KEY_POOL);
          if (!valueKeys.includes(valueKey)) valueKeys.push(valueKey);
          valueMap[valueKey] = rollClassValue(random, 0);
        }
        variants[variantName] = valueMap;
      }
    }

    const defaultVariants: AnyProps = {};
    for (const variantName of variantNames) {
      if (random.getNext() < 0.5) {
        defaultVariants[variantName] = rollDefaultValue(random, valueKeys);
      }
    }

    const compoundVariants: AnyProps[] = [];
    const compoundCount = random.getNext() < 0.5 ? 0 : Math.floor(random.getNext() * 6);
    for (let index = 0; index < compoundCount; index++) {
      const entry: AnyProps = {};
      const selectorCount = Math.floor(random.getNext() * 3);
      for (let selectorIndex = 0; selectorIndex < selectorCount; selectorIndex++) {
        const selectorKey =
          random.getNext() < 0.8 && variantNames.length > 0
            ? pickFrom(random, variantNames)
            : pickFrom(random, ["undeclared", "extra", "tone"]);
        entry[selectorKey] = rollSelectorValue(random, valueKeys);
      }
      const classShapeRoll = random.getNext();
      if (classShapeRoll < 0.45) entry.class = rollClassValue(random, 0);
      else if (classShapeRoll < 0.9) entry.className = rollClassValue(random, 0);
      else {
        entry.class = rollClassValue(random, 0);
        entry.className = rollClassValue(random, 0);
      }
      compoundVariants.push(entry);
    }

    config = { variants };
    if (random.getNext() >= 0.2) config.defaultVariants = defaultVariants;
    if (random.getNext() >= 0.2) config.compoundVariants = compoundVariants;
  }

  if (configIndex % 7 === 0 && config?.variants) {
    (config.variants as AnyProps)["undefined"] = { undefined: "matched-undefined-key" };
    if (!variantNames.includes("undefined")) variantNames.push("undefined");
  }

  return {
    ported: cva(base, config as never) as (props?: AnyProps) => string,
    reference: referenceCva(base, config as never) as (props?: AnyProps) => string,
    variantNames,
    valueKeys,
  };
};

const rollPropValue = (random: SeededRandom, valueKeys: string[]): unknown => {
  const roll = random.getNext();
  if (roll < 0.3) return pickFrom(random, valueKeys);
  if (roll < 0.38) return null;
  if (roll < 0.46) return undefined;
  if (roll < 0.52) return random.getNext() < 0.5;
  if (roll < 0.58) return 0;
  if (roll < 0.61) return -0;
  if (roll < 0.64) return "";
  if (roll < 0.67) return Number.NaN;
  if (roll < 0.73) return Math.floor(random.getNext() * 4) - 1;
  if (roll < 0.79) return "bogus";
  if (roll < 0.85) return pickFrom(random, ["toString", "constructor", "hasOwnProperty"]);
  if (roll < 0.93) return [pickFrom(random, valueKeys)];
  return { nested: true };
};

const rollProps = (random: SeededRandom, pair: CvaInstancePair): AnyProps | undefined => {
  const shapeRoll = random.getNext();
  if (shapeRoll < 0.08) return undefined;
  const props: AnyProps = {};
  for (const variantName of pair.variantNames) {
    if (random.getNext() < 0.35) continue;
    props[variantName] = rollPropValue(random, pair.valueKeys);
  }
  if (random.getNext() < 0.15) props["aCheekyExtraProp"] = rollPropValue(random, pair.valueKeys);
  if (random.getNext() < 0.1) props["undeclared"] = rollPropValue(random, pair.valueKeys);
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
    const pairs: CvaInstancePair[] = [];
    for (let configIndex = 0; configIndex < FUZZ_CONFIG_COUNT; configIndex++) {
      pairs.push(generateInstancePair(random, configIndex));
    }

    const mismatches: ParityMismatch[] = [];
    for (let call = 0; call < FUZZ_CALL_COUNT; call++) {
      const configIndex = Math.floor(random.getNext() * pairs.length);
      const pair = pairs[configIndex]!;
      const props = rollProps(random, pair);
      const actualOutput = pair.ported(props);
      const referenceOutput = pair.reference(props);
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
      const pair = generateInstancePair(random, configIndex);
      const props = rollProps(random, pair);
      const firstOutput = pair.ported(props);
      expect(pair.ported(props)).toBe(firstOutput);
      expect(pair.ported(props)).toBe(firstOutput);
      expect(firstOutput).toBe(pair.reference(props));
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
    const firstPorted = cva("button", config as never);
    const secondPorted = cva("button", config as never);
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
      expect(firstPorted(props as never)).toBe(reference(props as never));
      expect(secondPorted(props as never)).toBe(reference(props as never));
      expect(firstPorted(props as never)).toBe(reference(props as never));
    }
  });
});
