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

// The arity-2/3 fast paths and the variadic (arity >= 4) path each canonicalize falsy args away
// before probing the arg cache (the cache key is the truthy-string sequence, not the raw arg
// list). These tests pin the equivalence: every falsy placement/arity of the same truthy sequence
// must produce the identical string, including on repeat calls that hit the cache entries the
// first round populated.
describe("cn: falsy-canonical arg shapes across arities", () => {
  it("treats falsy args as absent at every arity", () => {
    // Run twice: the first pass populates caches, the second must hit them with identical output.
    for (let round = 0; round < 2; round++) {
      // arity 2 (cnTwoArgs path)
      expect(cn("px-2", false)).toBe("px-2");
      expect(cn(0, "px-2")).toBe("px-2");
      expect(cn("", "")).toBe("");
      // arity 3 (cnThreeArgs path) — every falsy placement reduces to the same truthy sequence
      expect(cn("px-2", false, "px-4")).toBe("px-4");
      expect(cn(false, "px-2", "px-4")).toBe("px-4");
      expect(cn("px-2", "px-4", null)).toBe("px-4");
      expect(cn("px-2", undefined, 0)).toBe("px-2");
      // arity >= 4 (variadic path) — same truthy sequence again
      expect(cn("px-2", false, "px-4", null)).toBe("px-4");
      expect(cn(null, 0, "", "px-4")).toBe("px-4");
      expect(cn(false, null, undefined, 0, "")).toBe("");
    }
  });

  it("returns the same result for a truthy sequence regardless of arity padding", () => {
    const direct = cn("flex px-2", "px-4");
    expect(cn("flex px-2", false, "px-4")).toBe(direct);
    expect(cn("flex px-2", "px-4", null)).toBe(direct);
    expect(cn(undefined, "flex px-2", 0, "px-4", false)).toBe(direct);
  });

  it("keeps clsx truthiness semantics: '0' is truthy, 0 and '' are not", () => {
    expect(cn("a", 0)).toBe("a");
    expect(cn("a", "0")).toBe("a 0");
    expect(cn("a", "", "b")).toBe("a b");
  });

  it("handles duplicate string args identically on every arity path", () => {
    for (let round = 0; round < 2; round++) {
      expect(cn("px-2", "px-2")).toBe("px-2");
      expect(cn("px-2", "px-2", "px-2")).toBe("px-2");
      expect(cn("px-2", "px-2", "px-2", "px-2")).toBe("px-2");
      // Last-wins dedup: the trailing "flex" claims the display group, dropping earlier ones.
      expect(cn("flex", "flex px-2", false, "flex")).toBe("px-2 flex");
    }
  });

  it("bails to the resolve path for truthy non-string args mixed with falsy args", () => {
    for (let round = 0; round < 2; round++) {
      expect(cn("px-2", false, { "px-4": true })).toBe("px-4");
      expect(cn(false, ["px-2"], null, "px-4")).toBe("px-4");
      expect(cn("a", 5)).toBe("a 5");
    }
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
