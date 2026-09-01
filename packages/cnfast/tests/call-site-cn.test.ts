import { describe, expect, it } from "vitest";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { createSeededRandom } from "../bench/utils/create-seeded-random";
import { type ClassValue, cn, createCallSiteCn, createCn } from "./src/index.js";

const referenceCn = (...classValues: ClassValue[]): string => twMerge(clsx(classValues));
const CALL_SITE_FUZZ_SEED = 0xdecafbad;
const CALL_SITE_FUZZ_INSTANCE_COUNT = 16;
const CALL_SITE_FUZZ_CALL_COUNT = 20_000;
const CALL_SITE_FUZZ_MAX_ARGUMENT_COUNT = 6;
const CALL_SITE_OVERFLOW_ARGUMENT_COUNT = 16;

describe("createCallSiteCn: matches cn byte-for-byte", () => {
  it("returns identical output on repeated identical calls", () => {
    const callSiteCn = createCallSiteCn();
    const expected = cn("px-2 py-1", "px-4");
    expect(callSiteCn("px-2 py-1", "px-4")).toBe(expected);
    expect(callSiteCn("px-2 py-1", "px-4")).toBe(expected);
    expect(callSiteCn("px-2 py-1", "px-4")).toBe(expected);
  });

  it("handles zero arguments", () => {
    const callSiteCn = createCallSiteCn();
    expect(callSiteCn()).toBe("");
    expect(callSiteCn()).toBe("");
  });

  it("distinguishes falsy argument kinds at the same position", () => {
    const callSiteCn = createCallSiteCn();
    expect(callSiteCn("a", false, "b")).toBe(cn("a", false, "b"));
    expect(callSiteCn("a", null, "b")).toBe(cn("a", null, "b"));
    expect(callSiteCn("a", undefined, "b")).toBe(cn("a", undefined, "b"));
    expect(callSiteCn("a", 0, "b")).toBe(cn("a", 0, "b"));
    expect(callSiteCn("a", "", "b")).toBe(cn("a", "", "b"));
    expect(callSiteCn("a", false, "b")).toBe(cn("a", false, "b"));
  });

  it("distinguishes arity changes at one call site", () => {
    const callSiteCn = createCallSiteCn();
    expect(callSiteCn("px-2")).toBe("px-2");
    expect(callSiteCn("px-2", "px-4")).toBe("px-4");
    expect(callSiteCn("px-2", "px-4", "px-8")).toBe("px-8");
    expect(callSiteCn("px-2", "px-4")).toBe("px-4");
    expect(callSiteCn("px-2")).toBe("px-2");
  });

  it("distinguishes value-equal but differently shaped calls", () => {
    const callSiteCn = createCallSiteCn();
    expect(callSiteCn("a b", "c")).toBe(cn("a b", "c"));
    expect(callSiteCn("a", "b c")).toBe(cn("a", "b c"));
  });

  it("compares equal-value non-identical strings correctly", () => {
    const callSiteCn = createCallSiteCn();
    const firstClassName = "px-2 py-1";
    const secondClassName = ["px-2", "py-1"].join(" ");
    expect(callSiteCn(firstClassName, "px-4")).toBe(cn(firstClassName, "px-4"));
    expect(callSiteCn(secondClassName, "px-4")).toBe(cn(firstClassName, "px-4"));
  });

  it("never serves stale output for a mutated object argument", () => {
    const callSiteCn = createCallSiteCn();
    const classNameToggles: Record<string, boolean> = { underline: true };
    expect(callSiteCn("flex", classNameToggles)).toBe("flex underline");
    classNameToggles.underline = false;
    expect(callSiteCn("flex", classNameToggles)).toBe("flex");
  });

  it("never serves stale output for a mutated array argument", () => {
    const callSiteCn = createCallSiteCn();
    const nestedClassValue = ["px-2"];
    expect(callSiteCn("flex", nestedClassValue)).toBe("flex px-2");
    nestedClassValue[0] = "px-4";
    expect(callSiteCn("flex", nestedClassValue)).toBe("flex px-4");
  });

  it("keeps rows intact when a mid-store object argument aborts caching", () => {
    const callSiteCn = createCallSiteCn();
    expect(callSiteCn("m-1", "m-2", "m-3")).toBe("m-3");
    expect(callSiteCn("m-1", { hidden: true }, "m-3")).toBe(cn("m-1", { hidden: true }, "m-3"));
    expect(callSiteCn("m-1", "m-2", "m-3")).toBe("m-3");
    expect(callSiteCn("m-1", { hidden: false }, "m-3")).toBe("m-3");
  });

  it("handles NaN arguments by always delegating", () => {
    const callSiteCn = createCallSiteCn();
    expect(callSiteCn("flex", Number.NaN)).toBe(cn("flex", Number.NaN));
    expect(callSiteCn("flex", Number.NaN)).toBe(cn("flex", Number.NaN));
  });

  it("caches numbers and bigints by value", () => {
    const callSiteCn = createCallSiteCn();
    expect(callSiteCn("flex", 42)).toBe(cn("flex", 42));
    expect(callSiteCn("flex", 42)).toBe(cn("flex", 42));
    expect(callSiteCn("flex", 43)).toBe(cn("flex", 43));
    expect(callSiteCn("flex", 42n)).toBe(cn("flex", 42n));
  });

  it("survives more shapes than its row capacity", () => {
    const callSiteCn = createCallSiteCn();
    for (let passIndex = 0; passIndex < 3; passIndex++) {
      for (let shapeIndex = 0; shapeIndex < 6; shapeIndex++) {
        const variantClassName = `variant-${shapeIndex}`;
        expect(callSiteCn("flex items-center", variantClassName, "px-2")).toBe(
          cn("flex items-center", variantClassName, "px-2"),
        );
      }
    }
  });

  it("caches beyond-capacity arities correctly by always delegating", () => {
    const callSiteCn = createCallSiteCn();
    const classValues = Array.from(
      { length: CALL_SITE_OVERFLOW_ARGUMENT_COUNT },
      (_, classIndex) => `c-${classIndex}`,
    );
    expect(callSiteCn(...classValues)).toBe(cn(...classValues));
    expect(callSiteCn(...classValues)).toBe(cn(...classValues));
  });

  it("wraps a custom cn from createCn", () => {
    const themedCn = createCn({
      extend: { classGroups: { "font-size": [{ text: ["display", "title"] }] } },
    });
    const callSiteCn = createCallSiteCn(themedCn);
    expect(callSiteCn("text-red-500 text-title")).toBe(themedCn("text-red-500 text-title"));
    expect(callSiteCn("text-red-500 text-title")).toBe(themedCn("text-red-500 text-title"));
    expect(callSiteCn("text-title text-display")).toBe("text-display");
  });

  it("keeps independent state per call-site instance", () => {
    const firstCallSiteCn = createCallSiteCn();
    const secondCallSiteCn = createCallSiteCn();
    expect(firstCallSiteCn("p-1", "p-2")).toBe("p-2");
    expect(secondCallSiteCn("m-1", "m-2")).toBe("m-2");
    expect(firstCallSiteCn("p-1", "p-2")).toBe("p-2");
  });

  it("matches the reference across a seeded fuzz of mixed shapes", () => {
    const random = createSeededRandom(CALL_SITE_FUZZ_SEED);
    const classNamePool = [
      "flex",
      "px-2",
      "px-4",
      "py-1",
      "text-sm",
      "text-lg",
      "bg-red-500",
      "bg-red-500/50",
      "hover:bg-blue-100",
      "grid grid-cols-2 gap-2",
      "[margin:2px]",
      "",
    ];
    const createRandomClassValue = (): ClassValue => {
      const randomValue = random.getNext();
      if (randomValue < 0.55) {
        return classNamePool[Math.floor(random.getNext() * classNamePool.length)];
      }
      if (randomValue < 0.65) return false;
      if (randomValue < 0.72) return null;
      if (randomValue < 0.79) return undefined;
      if (randomValue < 0.84) return 0;
      if (randomValue < 0.88) return Math.floor(random.getNext() * 3);
      if (randomValue < 0.94) {
        return { underline: random.getNext() < 0.5, "line-through": random.getNext() < 0.5 };
      }
      return [
        classNamePool[Math.floor(random.getNext() * classNamePool.length)],
        random.getNext() < 0.5 && "m-1",
      ];
    };
    const callSiteFunctions = Array.from({ length: CALL_SITE_FUZZ_INSTANCE_COUNT }, () =>
      createCallSiteCn(),
    );
    for (let callIndex = 0; callIndex < CALL_SITE_FUZZ_CALL_COUNT; callIndex++) {
      const argumentCount = Math.floor(random.getNext() * CALL_SITE_FUZZ_MAX_ARGUMENT_COUNT);
      const classValues: ClassValue[] = [];
      for (let index = 0; index < argumentCount; index++) {
        classValues.push(createRandomClassValue());
      }
      const callSiteCn =
        callSiteFunctions[Math.floor(random.getNext() * callSiteFunctions.length)]!;
      expect(callSiteCn(...classValues)).toBe(referenceCn(...classValues));
    }
  });
});
