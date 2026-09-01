import { describe, expect, it } from "vitest";
import { cva as referenceCva } from "class-variance-authority";
import { cva } from "./src/index.js";
import { CVA_MEMO_ROWS } from "./src/lib/constants.js";

const buttonConfig = {
  variants: {
    intent: {
      primary: "button--primary bg-blue-500",
      secondary: "button--secondary bg-white",
      danger: "button--danger bg-red-500",
    },
    size: {
      small: "button--small text-sm",
      medium: "button--medium text-base",
    },
    disabled: {
      true: "button--disabled opacity-50",
      false: "button--enabled cursor-pointer",
    },
  },
  compoundVariants: [
    { intent: "primary", size: "medium", class: "button--primary-medium" },
    { intent: "danger", disabled: false, className: "button--danger-enabled" },
  ],
  defaultVariants: { intent: "primary", size: "medium", disabled: false },
};

interface AnyPropsCva {
  (props?: Record<string, unknown>): string;
}

const createPair = (): { ported: AnyPropsCva; reference: AnyPropsCva } => ({
  ported: cva("button", buttonConfig as never) as AnyPropsCva,
  reference: referenceCva("button", buttonConfig as never) as AnyPropsCva,
});

describe("cva memo: matches the reference byte-for-byte across cache states", () => {
  it("returns identical output on repeated identical calls", () => {
    const { ported, reference } = createPair();
    const props = { intent: "secondary", size: "small" };
    const expected = reference(props);
    expect(ported(props)).toBe(expected);
    expect(ported(props)).toBe(expected);
    expect(ported({ intent: "secondary", size: "small" })).toBe(expected);
  });

  it("interns the zero-props result", () => {
    const { ported, reference } = createPair();
    const expected = reference();
    expect(ported()).toBe(expected);
    expect(ported(undefined)).toBe(expected);
    expect(ported({})).toBe(expected);
  });

  it("distinguishes null from undefined variant props", () => {
    const { ported, reference } = createPair();
    for (let round = 0; round < 3; round++) {
      expect(ported({ size: null })).toBe(reference({ size: null }));
      expect(ported({ size: undefined })).toBe(reference({ size: undefined }));
      expect(ported({ disabled: null })).toBe(reference({ disabled: null }));
      expect(ported({ disabled: undefined })).toBe(reference({ disabled: undefined }));
    }
  });

  it("distinguishes falsy prop kinds at the same slot", () => {
    const { ported, reference } = createPair();
    const falsyRolls = [false, 0, "", null, undefined, Number.NaN];
    for (let round = 0; round < 2; round++) {
      for (const roll of falsyRolls) {
        expect(ported({ disabled: roll })).toBe(reference({ disabled: roll }));
      }
    }
  });

  it("never serves stale output for a mutated object className", () => {
    const { ported, reference } = createPair();
    const toggles: Record<string, boolean> = { underline: true };
    const props = { intent: "secondary", className: toggles };
    expect(ported(props)).toBe(reference(props));
    toggles.underline = false;
    expect(ported(props)).toBe(reference(props));
  });

  it("never serves stale output for a mutated array class", () => {
    const { ported, reference } = createPair();
    const nested = ["px-2"];
    const props = { size: "small", class: nested };
    expect(ported(props)).toBe(reference(props));
    nested[0] = "px-4";
    expect(ported(props)).toBe(reference(props));
  });

  it("keeps rows intact when a mid-store object value aborts caching", () => {
    const { ported, reference } = createPair();
    const primitiveProps = { intent: "danger", size: "small" };
    expect(ported(primitiveProps)).toBe(reference(primitiveProps));
    const objectProps = { intent: "danger", size: "small", className: { hidden: true } };
    expect(ported(objectProps)).toBe(reference(objectProps));
    expect(ported(primitiveProps)).toBe(reference(primitiveProps));
  });

  it("survives more combinations than its row capacity", () => {
    const { ported, reference } = createPair();
    const intents = ["primary", "secondary", "danger"];
    const sizes = ["small", "medium", null, undefined];
    const disabledRolls = [true, false, null];
    for (let round = 0; round < 3; round++) {
      for (const intent of intents) {
        for (const size of sizes) {
          for (const disabled of disabledRolls) {
            const props = { intent, size, disabled };
            expect(ported(props)).toBe(reference(props));
          }
        }
      }
    }
  });

  it("wraps the victim row round-robin past capacity", () => {
    const { ported, reference } = createPair();
    for (let round = 0; round < 4; round++) {
      for (let combo = 0; combo < CVA_MEMO_ROWS + 3; combo++) {
        const props = { intent: "primary", className: `adhoc-${combo}` };
        expect(ported(props)).toBe(reference(props));
      }
    }
  });

  it("ignores extra undeclared props exactly like the reference", () => {
    const { ported, reference } = createPair();
    const plainProps = { intent: "secondary" };
    const extraProps = { intent: "secondary", aCheekyExtraProp: "lol" };
    expect(ported(plainProps)).toBe(reference(plainProps));
    expect(ported(extraProps)).toBe(reference(extraProps));
    expect(ported(plainProps)).toBe(reference(plainProps));
  });

  it("stays correct on configs too wide for the memo", () => {
    const variants: Record<string, Record<string, string>> = {};
    for (let index = 0; index < 20; index++) {
      variants[`variant${index}`] = { on: `variant-${index}-on`, off: `variant-${index}-off` };
    }
    const wideConfig = { variants };
    const ported = cva("wide", wideConfig as never) as AnyPropsCva;
    const reference = referenceCva("wide", wideConfig as never) as AnyPropsCva;
    const props = { variant0: "on", variant7: "off", variant19: "on" };
    expect(ported(props)).toBe(reference(props));
    expect(ported(props)).toBe(reference(props));
    expect(ported({})).toBe(reference({}));
  });

  it("keeps independent state per instance", () => {
    const firstPair = createPair();
    const secondPair = createPair();
    expect(firstPair.ported({ intent: "danger" })).toBe(firstPair.reference({ intent: "danger" }));
    expect(secondPair.ported({ size: "small" })).toBe(secondPair.reference({ size: "small" }));
    expect(firstPair.ported({ intent: "danger" })).toBe(firstPair.reference({ intent: "danger" }));
  });
});
