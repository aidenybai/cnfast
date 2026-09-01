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

interface CvaRuntimeComponent {
  (props?: Record<string, unknown>): string;
}

interface CvaInstancePair {
  cnfast: CvaRuntimeComponent;
  reference: CvaRuntimeComponent;
}

const createInstancePair = (): CvaInstancePair => ({
  cnfast: cva("button", buttonConfig as never) as CvaRuntimeComponent,
  reference: referenceCva("button", buttonConfig as never) as CvaRuntimeComponent,
});

describe("cva memo: matches the reference byte-for-byte across cache states", () => {
  it("returns identical output on repeated identical calls", () => {
    const { cnfast, reference } = createInstancePair();
    const props = { intent: "secondary", size: "small" };
    const expected = reference(props);
    expect(cnfast(props)).toBe(expected);
    expect(cnfast(props)).toBe(expected);
    expect(cnfast({ intent: "secondary", size: "small" })).toBe(expected);
  });

  it("interns the zero-props result", () => {
    const { cnfast, reference } = createInstancePair();
    const expected = reference();
    expect(cnfast()).toBe(expected);
    expect(cnfast(undefined)).toBe(expected);
    expect(cnfast({})).toBe(expected);
  });

  it("distinguishes null from undefined variant props", () => {
    const { cnfast, reference } = createInstancePair();
    for (let passIndex = 0; passIndex < 3; passIndex++) {
      expect(cnfast({ size: null })).toBe(reference({ size: null }));
      expect(cnfast({ size: undefined })).toBe(reference({ size: undefined }));
      expect(cnfast({ disabled: null })).toBe(reference({ disabled: null }));
      expect(cnfast({ disabled: undefined })).toBe(reference({ disabled: undefined }));
    }
  });

  it("distinguishes falsy prop kinds at the same slot", () => {
    const { cnfast, reference } = createInstancePair();
    const falsyValues = [false, 0, "", null, undefined, Number.NaN];
    for (let passIndex = 0; passIndex < 2; passIndex++) {
      for (const falsyValue of falsyValues) {
        expect(cnfast({ disabled: falsyValue })).toBe(reference({ disabled: falsyValue }));
      }
    }
  });

  it("never serves stale output for a mutated object className", () => {
    const { cnfast, reference } = createInstancePair();
    const classNameToggles: Record<string, boolean> = { underline: true };
    const props = { intent: "secondary", className: classNameToggles };
    expect(cnfast(props)).toBe(reference(props));
    classNameToggles.underline = false;
    expect(cnfast(props)).toBe(reference(props));
  });

  it("never serves stale output for a mutated array class", () => {
    const { cnfast, reference } = createInstancePair();
    const nestedClass = ["px-2"];
    const props = { size: "small", class: nestedClass };
    expect(cnfast(props)).toBe(reference(props));
    nestedClass[0] = "px-4";
    expect(cnfast(props)).toBe(reference(props));
  });

  it("keeps rows intact when a mid-store object value aborts caching", () => {
    const { cnfast, reference } = createInstancePair();
    const primitiveProps = { intent: "danger", size: "small" };
    expect(cnfast(primitiveProps)).toBe(reference(primitiveProps));
    const objectProps = { intent: "danger", size: "small", className: { hidden: true } };
    expect(cnfast(objectProps)).toBe(reference(objectProps));
    expect(cnfast(primitiveProps)).toBe(reference(primitiveProps));
  });

  it("survives more combinations than its row capacity", () => {
    const { cnfast, reference } = createInstancePair();
    const intents = ["primary", "secondary", "danger"];
    const sizes = ["small", "medium", null, undefined];
    const disabledRolls = [true, false, null];
    for (let passIndex = 0; passIndex < 3; passIndex++) {
      for (const intent of intents) {
        for (const size of sizes) {
          for (const disabled of disabledRolls) {
            const props = { intent, size, disabled };
            expect(cnfast(props)).toBe(reference(props));
          }
        }
      }
    }
  });

  it("wraps the victim row round-robin past capacity", () => {
    const { cnfast, reference } = createInstancePair();
    for (let passIndex = 0; passIndex < 4; passIndex++) {
      for (let combinationIndex = 0; combinationIndex < CVA_MEMO_ROWS + 3; combinationIndex++) {
        const props = { intent: "primary", className: `adhoc-${combinationIndex}` };
        expect(cnfast(props)).toBe(reference(props));
      }
    }
  });

  it("ignores extra undeclared props exactly like the reference", () => {
    const { cnfast, reference } = createInstancePair();
    const plainProps = { intent: "secondary" };
    const extraProps = { intent: "secondary", aCheekyExtraProp: "lol" };
    expect(cnfast(plainProps)).toBe(reference(plainProps));
    expect(cnfast(extraProps)).toBe(reference(extraProps));
    expect(cnfast(plainProps)).toBe(reference(plainProps));
  });

  it("stays correct on configs too wide for the memo", () => {
    const variants: Record<string, Record<string, string>> = {};
    for (let index = 0; index < 20; index++) {
      variants[`variant${index}`] = { on: `variant-${index}-on`, off: `variant-${index}-off` };
    }
    const wideConfig = { variants };
    const cnfast = cva("wide", wideConfig as never) as CvaRuntimeComponent;
    const reference = referenceCva("wide", wideConfig as never) as CvaRuntimeComponent;
    const props = { variant0: "on", variant7: "off", variant19: "on" };
    expect(cnfast(props)).toBe(reference(props));
    expect(cnfast(props)).toBe(reference(props));
    expect(cnfast({})).toBe(reference({}));
  });

  it("keeps independent state per instance", () => {
    const firstPair = createInstancePair();
    const secondPair = createInstancePair();
    expect(firstPair.cnfast({ intent: "danger" })).toBe(firstPair.reference({ intent: "danger" }));
    expect(secondPair.cnfast({ size: "small" })).toBe(secondPair.reference({ size: "small" }));
    expect(firstPair.cnfast({ intent: "danger" })).toBe(firstPair.reference({ intent: "danger" }));
  });
});
