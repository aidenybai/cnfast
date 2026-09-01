import { describe, expect, it } from "vitest";
import { cva as referenceCva } from "class-variance-authority";
import { cva } from "./src/index.js";

interface CvaRuntimeProps {
  [propName: string]: unknown;
}

interface CvaRuntimeComponent {
  (props?: CvaRuntimeProps): string;
}

interface CvaInstancePair {
  cnfast: CvaRuntimeComponent;
  reference: CvaRuntimeComponent;
}

const createInstancePair = (base: unknown, config: unknown): CvaInstancePair => ({
  cnfast: cva(base as never, config as never) as CvaRuntimeComponent,
  reference: referenceCva(base as never, config as never) as CvaRuntimeComponent,
});

const expectParityAcrossPasses = (
  cvaPair: CvaInstancePair,
  propCases: (CvaRuntimeProps | undefined)[],
): void => {
  for (let passIndex = 0; passIndex < 3; passIndex++) {
    for (const props of propCases) {
      expect(cvaPair.cnfast(props)).toBe(cvaPair.reference(props));
    }
  }
};

describe("cva combination table: interned results stay byte-identical to the reference", () => {
  it("resolves every falsy prop kind through the same default fall-through", () => {
    const cvaPair = createInstancePair("button", {
      variants: {
        tone: { primary: "tone-primary", false: "tone-false", 0: "tone-zero", "": "tone-empty" },
      },
      defaultVariants: { tone: "primary" },
    });
    expectParityAcrossPasses(cvaPair, [
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
    const cvaPair = createInstancePair(null, {
      variants: { m: { 0: "m-0", 1: "m-1", "-1": "m-neg", undefined: "m-undefined" } },
    });
    expectParityAcrossPasses(cvaPair, [
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
    const cvaPair = createInstancePair("card", {
      variants: {
        size: { small: "size-small", large: "size-large" },
        tone: { light: "tone-light", dark: "tone-dark" },
      },
      defaultVariants: { size: "small", tone: "dark" },
    });
    expectParityAcrossPasses(cvaPair, [
      { size: null },
      { size: null, tone: null },
      { size: null, tone: "light" },
      { size: undefined, tone: null },
      { size: "large", tone: null },
      {},
    ]);
  });

  it("falls back for values that only the raw lookup can reach", () => {
    const variantDefinition: Record<string, string> = Object.create({
      inherited: "from-prototype",
    });
    variantDefinition.own = "own-value";
    const cvaPair = createInstancePair("base", { variants: { kind: variantDefinition } });
    expectParityAcrossPasses(cvaPair, [
      { kind: "own" },
      { kind: "inherited" },
      { kind: "toString" },
      { kind: "unknown" },
      { kind: Symbol.iterator },
      { kind: ["own"] },
      { kind: { nested: true } },
      {},
    ]);
  });

  it("coerces an object variant prop exactly once per call", () => {
    const cvaPair = createInstancePair("base", {
      variants: { tone: { first: "tone-first", second: "tone-second" } },
    });
    const createAlternatingVariantValue = () => {
      let coercionCount = 0;
      return {
        value: {
          toString: () => (++coercionCount % 2 === 1 ? "first" : "second"),
        },
        getCoercionCount: () => coercionCount,
      };
    };
    const cnfastVariantValue = createAlternatingVariantValue();
    const referenceVariantValue = createAlternatingVariantValue();

    expect(cvaPair.cnfast({ tone: cnfastVariantValue.value })).toBe(
      cvaPair.reference({ tone: referenceVariantValue.value }),
    );
    expect(cnfastVariantValue.getCoercionCount()).toBe(1);
    expect(referenceVariantValue.getCoercionCount()).toBe(1);

    expect(cvaPair.cnfast({ tone: cnfastVariantValue.value })).toBe(
      cvaPair.reference({ tone: referenceVariantValue.value }),
    );
    expect(cnfastVariantValue.getCoercionCount()).toBe(2);
    expect(referenceVariantValue.getCoercionCount()).toBe(2);
  });

  it("routes a default the table cannot key through the reference chain", () => {
    const objectDefault = { toString: () => "small" };
    const objectDefaultPair = createInstancePair("chip", {
      variants: { size: { small: "size-small", large: "size-large" } },
      defaultVariants: { size: objectDefault },
    });
    expectParityAcrossPasses(objectDefaultPair, [
      {},
      { size: "" },
      { size: "large" },
      { size: null },
    ]);

    const symbolDefaultPair = createInstancePair("chip", {
      variants: { size: { small: "size-small" } },
      defaultVariants: { size: Symbol("size") },
    });
    expectParityAcrossPasses(symbolDefaultPair, [{}, { size: "small" }, { size: Number.NaN }]);
  });

  it("keeps compound configs on the raw-value matching path", () => {
    const cvaPair = createInstancePair("button", {
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
    expectParityAcrossPasses(cvaPair, [
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
    const cvaPair = createInstancePair("button", {
      variants: {
        variant: { primary: "variant-primary", ghost: "variant-ghost" },
        size: { sm: "size-sm", lg: "size-lg" },
      },
      defaultVariants: { variant: "primary", size: "sm" },
    });
    const classNameToggles: Record<string, boolean> = { underline: true };
    for (let passIndex = 0; passIndex < 3; passIndex++) {
      expectParityAcrossPasses(cvaPair, [
        { variant: "ghost" },
        { variant: "ghost", className: "ml-2" },
        { variant: "ghost", className: classNameToggles },
        { variant: "ghost", class: ["px-2", { hidden: passIndex % 2 === 0 }] },
        { variant: "ghost" },
        { variant: "primary", size: "lg", class: "", className: "" },
      ]);
      classNameToggles.underline = !classNameToggles.underline;
    }
  });

  it("ignores undeclared props when selecting an interned result", () => {
    const cnfast = cva("button", {
      variants: { size: { sm: "size-sm", lg: "size-lg" } },
      defaultVariants: { size: "sm" },
    } as never) as CvaRuntimeComponent;
    const expectedClassName = cnfast({ size: "lg" });
    expect(cnfast({ size: "lg" })).toBe(expectedClassName);
    expect(cnfast({ size: "lg", undeclaredProp: "ignored" })).toBe(expectedClassName);
  });

  it("keeps interned results past the memo row capacity", () => {
    const valueKeys = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
    const variantDefinition: Record<string, string> = {};
    for (const valueKey of valueKeys) variantDefinition[valueKey] = `size-${valueKey}`;
    const cnfast = cva("button", {
      variants: { size: variantDefinition },
    } as never) as CvaRuntimeComponent;
    const expectedClassName = cnfast({ size: "a" });
    for (const valueKey of valueKeys) cnfast({ size: valueKey });
    expect(cnfast({ size: "a" })).toBe(expectedClassName);
  });

  it("matches a vacuous compound entry, which keeps the config off the table", () => {
    const cvaPair = createInstancePair("card", {
      variants: {},
      compoundVariants: [{ class: "vacuous" }],
    });
    expectParityAcrossPasses(cvaPair, [{}, { className: "ml-2" }, { class: "px-2" }, undefined]);
  });

  it("tables a variants-only config with no declared variant keys", () => {
    const cvaPair = createInstancePair("card", { variants: {} });
    expectParityAcrossPasses(cvaPair, [{}, { className: "ml-2" }, { class: "px-2" }, undefined]);
  });

  it("stays correct when the combination product exceeds the table cap", () => {
    const variants: Record<string, Record<string, string>> = {};
    for (let variantIndex = 0; variantIndex < 6; variantIndex++) {
      const variantDefinition: Record<string, string> = {};
      for (let valueIndex = 0; valueIndex < 6; valueIndex++) {
        variantDefinition[`v${valueIndex}`] = `variant-${variantIndex}-${valueIndex}`;
      }
      variants[`slot${variantIndex}`] = variantDefinition;
    }
    const cvaPair = createInstancePair("wide", { variants });
    expectParityAcrossPasses(cvaPair, [
      {},
      { slot0: "v1" },
      { slot0: "v1", slot5: "v5" },
      { slot3: null, slot4: "v0" },
    ]);
  });
});
