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

describe("cn: tagged-template form", () => {
  it("merges a static template", () => {
    expect(cn`px-2 px-4`).toBe("px-4");
    expect(cn`flex items-center gap-2`).toBe("flex items-center gap-2");
  });

  it("interleaves string interpolations and merges conflicts", () => {
    const dynamic = "px-8";
    expect(cn`px-2 py-1 ${dynamic}`).toBe("py-1 px-8");
  });

  it("treats falsy interpolations as empty", () => {
    const active = false;
    expect(cn`rounded border ${active && "bg-blue-500"}`).toBe("rounded border");
  });

  it("resolves array and object interpolations like clsx", () => {
    expect(cn`flex ${["px-2", "px-4"]}`).toBe("flex px-4");
    expect(cn`btn ${{ "text-sm": true, "text-lg": false }}`).toBe("btn text-sm");
  });

  it("matches the equivalent variadic call output", () => {
    const value = "bg-red-500";
    expect(cn`bg-blue-500 ${value}`).toBe(cn("bg-blue-500", value));
  });

  it("returns the same result across repeated calls (identity cache)", () => {
    const make = (variant: string | false) => cn`rounded p-2 ${variant && "bg-blue-500"}`;
    expect(make("on")).toBe("rounded p-2 bg-blue-500");
    expect(make(false)).toBe("rounded p-2");
    expect(make("on")).toBe("rounded p-2 bg-blue-500");
    expect(make(false)).toBe("rounded p-2");
  });
});
