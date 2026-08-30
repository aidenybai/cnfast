import { describe, expect, it } from "vitest";
import { cn } from "./src/index.js";

describe("cn: clsx-style joining", () => {
  it("joins string arguments with a single space", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("ignores falsy values", () => {
    expect(cn("a", null, undefined, false, 0, "", "b")).toBe("a b");
  });

  it("flattens nested arrays", () => {
    expect(cn("a", ["b", ["c", ["d"]]])).toBe("a b c d");
  });

  it("includes object keys whose values are truthy", () => {
    expect(cn({ a: true, b: false, c: 1, d: 0, e: "x" })).toBe("a c e");
  });

  it("supports conditional className patterns", () => {
    const isActive = true;
    const isDisabled = false;
    expect(cn("btn", { active: isActive, disabled: isDisabled })).toBe("btn active");
  });

  it("returns an empty string with no arguments", () => {
    expect(cn()).toBe("");
  });

  it("treats an object with a `raw` key as a class dictionary", () => {
    expect(cn({ raw: true })).toBe("raw");
    expect(cn({ raw: false })).toBe("");
    expect(cn({ raw: true, "px-4": true })).toBe("raw px-4");
    expect(cn("flex", { raw: true })).toBe("flex raw");
  });
});

describe("cn: tailwind conflict merging", () => {
  it("keeps the last conflicting utility", () => {
    expect(cn("px-2 px-4")).toBe("px-4");
    expect(cn("p-4", "p-2")).toBe("p-2");
    expect(cn("text-sm text-lg")).toBe("text-lg");
  });

  it("merges across object/array inputs", () => {
    expect(cn("px-2", { "px-4": true })).toBe("px-4");
    expect(cn(["bg-red-500", "bg-blue-500"])).toBe("bg-blue-500");
  });

  it("preserves non-conflicting utilities in order", () => {
    expect(cn("flex items-center px-2 px-4")).toBe("flex items-center px-4");
  });
});
