import { describe, expect, it } from "vitest";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { type ClassValue, cn, createCallSiteCn, createCn } from "./src/index.js";

const referenceCn = (...classValues: ClassValue[]): string => twMerge(clsx(classValues));

describe("createCallSiteCn: matches cn byte-for-byte", () => {
  it("returns identical output on repeated identical calls", () => {
    const site = createCallSiteCn();
    const expected = cn("px-2 py-1", "px-4");
    expect(site("px-2 py-1", "px-4")).toBe(expected);
    expect(site("px-2 py-1", "px-4")).toBe(expected);
    expect(site("px-2 py-1", "px-4")).toBe(expected);
  });

  it("handles zero arguments", () => {
    const site = createCallSiteCn();
    expect(site()).toBe("");
    expect(site()).toBe("");
  });

  it("distinguishes falsy argument kinds at the same position", () => {
    const site = createCallSiteCn();
    expect(site("a", false, "b")).toBe(cn("a", false, "b"));
    expect(site("a", null, "b")).toBe(cn("a", null, "b"));
    expect(site("a", undefined, "b")).toBe(cn("a", undefined, "b"));
    expect(site("a", 0, "b")).toBe(cn("a", 0, "b"));
    expect(site("a", "", "b")).toBe(cn("a", "", "b"));
    expect(site("a", false, "b")).toBe(cn("a", false, "b"));
  });

  it("distinguishes arity changes at one site", () => {
    const site = createCallSiteCn();
    expect(site("px-2")).toBe("px-2");
    expect(site("px-2", "px-4")).toBe("px-4");
    expect(site("px-2", "px-4", "px-8")).toBe("px-8");
    expect(site("px-2", "px-4")).toBe("px-4");
    expect(site("px-2")).toBe("px-2");
  });

  it("distinguishes value-equal but differently shaped calls", () => {
    const site = createCallSiteCn();
    expect(site("a b", "c")).toBe(cn("a b", "c"));
    expect(site("a", "b c")).toBe(cn("a", "b c"));
  });

  it("compares equal-value non-identical strings correctly", () => {
    const site = createCallSiteCn();
    const first = "px-2 py-1";
    const second = ["px-2", "py-1"].join(" ");
    expect(site(first, "px-4")).toBe(cn(first, "px-4"));
    expect(site(second, "px-4")).toBe(cn(first, "px-4"));
  });

  it("never serves stale output for a mutated object argument", () => {
    const site = createCallSiteCn();
    const toggles: Record<string, boolean> = { underline: true };
    expect(site("flex", toggles)).toBe("flex underline");
    toggles.underline = false;
    expect(site("flex", toggles)).toBe("flex");
  });

  it("never serves stale output for a mutated array argument", () => {
    const site = createCallSiteCn();
    const nested = ["px-2"];
    expect(site("flex", nested)).toBe("flex px-2");
    nested[0] = "px-4";
    expect(site("flex", nested)).toBe("flex px-4");
  });

  it("keeps rows intact when a mid-store object argument aborts caching", () => {
    const site = createCallSiteCn();
    expect(site("m-1", "m-2", "m-3")).toBe("m-3");
    expect(site("m-1", { hidden: true }, "m-3")).toBe(cn("m-1", { hidden: true }, "m-3"));
    expect(site("m-1", "m-2", "m-3")).toBe("m-3");
    expect(site("m-1", { hidden: false }, "m-3")).toBe("m-3");
  });

  it("handles NaN arguments by always delegating", () => {
    const site = createCallSiteCn();
    expect(site("flex", Number.NaN)).toBe(cn("flex", Number.NaN));
    expect(site("flex", Number.NaN)).toBe(cn("flex", Number.NaN));
  });

  it("caches numbers and bigints by value", () => {
    const site = createCallSiteCn();
    expect(site("flex", 42)).toBe(cn("flex", 42));
    expect(site("flex", 42)).toBe(cn("flex", 42));
    expect(site("flex", 43)).toBe(cn("flex", 43));
    expect(site("flex", 42n)).toBe(cn("flex", 42n));
  });

  it("survives more shapes than its row capacity", () => {
    const site = createCallSiteCn();
    for (let round = 0; round < 3; round++) {
      for (let shape = 0; shape < 6; shape++) {
        const variant = `variant-${shape}`;
        expect(site("flex items-center", variant, "px-2")).toBe(
          cn("flex items-center", variant, "px-2"),
        );
      }
    }
  });

  it("caches beyond-capacity arities correctly by always delegating", () => {
    const site = createCallSiteCn();
    const classValues = Array.from({ length: 16 }, (_, index) => `c-${index}`);
    expect(site(...classValues)).toBe(cn(...classValues));
    expect(site(...classValues)).toBe(cn(...classValues));
  });

  it("wraps a custom cn from createCn", () => {
    const themed = createCn({
      extend: { classGroups: { "font-size": [{ text: ["display", "title"] }] } },
    });
    const site = createCallSiteCn(themed);
    expect(site("text-red-500 text-title")).toBe(themed("text-red-500 text-title"));
    expect(site("text-red-500 text-title")).toBe(themed("text-red-500 text-title"));
    expect(site("text-title text-display")).toBe("text-display");
  });

  it("keeps independent state per site instance", () => {
    const firstSite = createCallSiteCn();
    const secondSite = createCallSiteCn();
    expect(firstSite("p-1", "p-2")).toBe("p-2");
    expect(secondSite("m-1", "m-2")).toBe("m-2");
    expect(firstSite("p-1", "p-2")).toBe("p-2");
  });

  it("matches the reference across a seeded fuzz of mixed shapes", () => {
    let state = 0xdecafbad >>> 0;
    const nextRandom = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const classNames = [
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
    const pickClassValue = (): ClassValue => {
      const roll = nextRandom();
      if (roll < 0.55) return classNames[Math.floor(nextRandom() * classNames.length)];
      if (roll < 0.65) return false;
      if (roll < 0.72) return null;
      if (roll < 0.79) return undefined;
      if (roll < 0.84) return 0;
      if (roll < 0.88) return Math.floor(nextRandom() * 3);
      if (roll < 0.94) return { underline: nextRandom() < 0.5, "line-through": nextRandom() < 0.5 };
      return [
        classNames[Math.floor(nextRandom() * classNames.length)],
        nextRandom() < 0.5 && "m-1",
      ];
    };
    const sites = Array.from({ length: 16 }, () => createCallSiteCn());
    for (let call = 0; call < 20_000; call++) {
      const argumentCount = Math.floor(nextRandom() * 6);
      const classValues: ClassValue[] = [];
      for (let index = 0; index < argumentCount; index++) classValues.push(pickClassValue());
      const site = sites[Math.floor(nextRandom() * sites.length)]!;
      expect(site(...classValues)).toBe(referenceCn(...classValues));
    }
  });
});
