import { describe, expect, it } from "vitest";
import { cva as referenceCva } from "class-variance-authority";
import { cva } from "./src/index.js";

type AnyProps = Record<string, unknown>;

interface AnyPropsCva {
  (props?: AnyProps): string;
}

interface InstancePair {
  ported: AnyPropsCva;
  reference: AnyPropsCva;
}

const createPair = (base: unknown, config: unknown): InstancePair => ({
  ported: cva(base as never, config as never) as AnyPropsCva,
  reference: referenceCva(base as never, config as never) as AnyPropsCva,
});

const expectSameAcrossRounds = (pair: InstancePair, propRolls: (AnyProps | undefined)[]): void => {
  for (let round = 0; round < 3; round++) {
    for (const props of propRolls) {
      expect(pair.ported(props)).toBe(pair.reference(props));
    }
  }
};

describe("cva combination table: interned results stay byte-identical to the reference", () => {
  it("resolves every falsy prop kind through the same default fall-through", () => {
    const pair = createPair("button", {
      variants: {
        tone: { primary: "tone-primary", false: "tone-false", 0: "tone-zero", "": "tone-empty" },
      },
      defaultVariants: { tone: "primary" },
    });
    expectSameAcrossRounds(pair, [
      undefined,
      {},
      { tone: "primary" },
      { tone: false },
      { tone: 0 },
      { tone: -0 },
      { tone: "false" },
      { tone: "0" },
      { tone: "" },
      { tone: Number.NaN },
      { tone: null },
      { tone: undefined },
      { tone: true },
      { tone: "bogus" },
    ]);
  });

  it("shares a slot between a raw value and the key string it coerces to", () => {
    const pair = createPair(null, {
      variants: { m: { 0: "m-0", 1: "m-1", "-1": "m-neg", undefined: "m-undefined" } },
    });
    expectSameAcrossRounds(pair, [
      { m: 1 },
      { m: "1" },
      { m: -1 },
      { m: "-1" },
      { m: 0 },
      { m: "0" },
      { m: 1n },
      { m: 0n },
      { m: undefined },
      { m: "undefined" },
      {},
    ]);
  });

  it("keeps null suppression distinct from the default", () => {
    const pair = createPair("card", {
      variants: {
        size: { small: "size-small", large: "size-large" },
        tone: { light: "tone-light", dark: "tone-dark" },
      },
      defaultVariants: { size: "small", tone: "dark" },
    });
    expectSameAcrossRounds(pair, [
      { size: null },
      { size: null, tone: null },
      { size: null, tone: "light" },
      { size: undefined, tone: null },
      { size: "large", tone: null },
      {},
    ]);
  });

  it("falls back for values that only the raw lookup can reach", () => {
    const variantObject = Object.create({ inherited: "from-prototype" }) as Record<string, string>;
    variantObject.own = "own-value";
    const pair = createPair("base", { variants: { kind: variantObject } });
    expectSameAcrossRounds(pair, [
      { kind: "own" },
      { kind: "inherited" },
      { kind: "toString" },
      { kind: "unknown" },
      { kind: Symbol.iterator as unknown as string },
      { kind: ["own"] },
      { kind: { nested: true } },
      {},
    ]);
  });

  it("routes a default the table cannot key through the reference chain", () => {
    const objectDefault = { toString: () => "small" };
    const objectDefaultPair = createPair("chip", {
      variants: { size: { small: "size-small", large: "size-large" } },
      defaultVariants: { size: objectDefault },
    });
    expectSameAcrossRounds(objectDefaultPair, [
      {},
      { size: "" },
      { size: "large" },
      { size: null },
    ]);

    const symbolDefaultPair = createPair("chip", {
      variants: { size: { small: "size-small" } },
      defaultVariants: { size: Symbol("size") },
    });
    expectSameAcrossRounds(symbolDefaultPair, [{}, { size: "small" }, { size: Number.NaN }]);
  });

  it("keeps compound configs on the raw-value matching path", () => {
    const pair = createPair("button", {
      variants: {
        disabled: { true: "is-disabled", false: "is-enabled" },
        m: { 0: "m-0", 1: "m-1" },
      },
      compoundVariants: [
        { disabled: false, class: "compound-boolean-false" },
        { disabled: "false", class: "compound-string-false" },
        { m: 0, class: "compound-number-zero" },
        { m: "0", class: "compound-string-zero" },
      ],
      defaultVariants: { disabled: false, m: 0 },
    });
    expectSameAcrossRounds(pair, [
      {},
      { disabled: false },
      { disabled: "false" },
      { disabled: true },
      { disabled: null },
      { m: 0 },
      { m: "0" },
      { m: 1 },
      { disabled: "false", m: "0" },
    ]);
  });

  it("interleaves tabled calls with class-carrying and object-class calls", () => {
    const pair = createPair("button", {
      variants: {
        variant: { primary: "variant-primary", ghost: "variant-ghost" },
        size: { sm: "size-sm", lg: "size-lg" },
      },
      defaultVariants: { variant: "primary", size: "sm" },
    });
    const toggles: Record<string, boolean> = { underline: true };
    for (let round = 0; round < 3; round++) {
      expectSameAcrossRounds(pair, [
        { variant: "ghost" },
        { variant: "ghost", className: "ml-2" },
        { variant: "ghost", className: toggles },
        { variant: "ghost", class: ["px-2", { hidden: round % 2 === 0 }] },
        { variant: "ghost" },
        { variant: "primary", size: "lg", class: "", className: "" },
      ]);
      toggles.underline = !toggles.underline;
    }
  });

  it("returns the same string instance for a repeated tabled combination", () => {
    const ported = cva("button", {
      variants: { size: { sm: "size-sm", lg: "size-lg" } },
      defaultVariants: { size: "sm" },
    } as never) as AnyPropsCva;
    const first = ported({ size: "lg" });
    expect(ported({ size: "lg" })).toBe(first);
    expect(ported({ size: "lg", extra: "ignored" })).toBe(first);
  });

  it("keeps interned results past the memo row capacity", () => {
    const values = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
    const valueMap: Record<string, string> = {};
    for (const value of values) valueMap[value] = `size-${value}`;
    const ported = cva("button", { variants: { size: valueMap } } as never) as AnyPropsCva;
    const first = ported({ size: "a" });
    for (const value of values) ported({ size: value });
    expect(ported({ size: "a" })).toBe(first);
  });

  it("matches a vacuous compound entry, which keeps the config off the table", () => {
    const pair = createPair("card", { variants: {}, compoundVariants: [{ class: "vacuous" }] });
    expectSameAcrossRounds(pair, [{}, { className: "ml-2" }, { class: "px-2" }, undefined]);
  });

  it("tables a variants-only config with no declared variant keys", () => {
    const pair = createPair("card", { variants: {} });
    expectSameAcrossRounds(pair, [{}, { className: "ml-2" }, { class: "px-2" }, undefined]);
  });

  it("stays correct when the combination product exceeds the table cap", () => {
    const variants: Record<string, Record<string, string>> = {};
    for (let index = 0; index < 6; index++) {
      const valueMap: Record<string, string> = {};
      for (let valueIndex = 0; valueIndex < 6; valueIndex++) {
        valueMap[`v${valueIndex}`] = `variant-${index}-${valueIndex}`;
      }
      variants[`slot${index}`] = valueMap;
    }
    const pair = createPair("wide", { variants });
    expectSameAcrossRounds(pair, [
      {},
      { slot0: "v1" },
      { slot0: "v1", slot5: "v5" },
      { slot3: null, slot4: "v0" },
    ]);
  });
});
