/**
 * Cases ported from clsx (https://github.com/lukeed/clsx), MIT License,
 * Copyright (c) Luke Edwards. Adapted to vitest and fastcn's `clsx` export.
 */
import { describe, expect, it } from "vitest";
import { clsx } from "../src/index.js";

describe("clsx: strings", () => {
  it("handles strings and falsy strings", () => {
    expect(clsx("")).toBe("");
    expect(clsx("foo")).toBe("foo");
    expect(clsx(true && "foo")).toBe("foo");
    expect(clsx(false && "foo")).toBe("");
  });

  it("handles variadic strings", () => {
    expect(clsx("foo", "bar")).toBe("foo bar");
    expect(clsx(true && "foo", false && "bar", "baz")).toBe("foo baz");
    expect(clsx(false && "foo", "bar", "baz", "")).toBe("bar baz");
  });
});

describe("clsx: numbers", () => {
  it("stringifies truthy numbers", () => {
    expect(clsx(1)).toBe("1");
    expect(clsx(12)).toBe("12");
    expect(clsx(0.1)).toBe("0.1");
    expect(clsx(0)).toBe("");
    expect(clsx(Infinity)).toBe("Infinity");
    expect(clsx(NaN)).toBe("");
  });

  it("handles variadic numbers", () => {
    expect(clsx(0, 1)).toBe("1");
    expect(clsx(1, 2)).toBe("1 2");
  });
});

describe("clsx: objects", () => {
  it("includes truthy keys", () => {
    expect(clsx({})).toBe("");
    expect(clsx({ foo: true })).toBe("foo");
    expect(clsx({ foo: true, bar: false })).toBe("foo");
    expect(clsx({ foo: "hiya", bar: 1 })).toBe("foo bar");
    expect(clsx({ foo: 1, bar: 0, baz: 1 })).toBe("foo baz");
    expect(clsx({ "-foo": 1, "--bar": 1 })).toBe("-foo --bar");
  });

  it("handles variadic objects", () => {
    expect(clsx({}, {})).toBe("");
    expect(clsx({ foo: 1 }, { bar: 2 })).toBe("foo bar");
    expect(clsx({ foo: 1 }, null, { baz: 1, bat: 0 })).toBe("foo baz");
    expect(clsx({ foo: 1 }, {}, {}, { bar: "a" }, { baz: null, bat: Infinity })).toBe(
      "foo bar bat",
    );
  });
});

describe("clsx: arrays", () => {
  it("flattens arrays", () => {
    expect(clsx([])).toBe("");
    expect(clsx(["foo"])).toBe("foo");
    expect(clsx(["foo", "bar"])).toBe("foo bar");
    expect(clsx(["foo", 0 && "bar", 1 && "baz"])).toBe("foo baz");
  });

  it("flattens nested arrays", () => {
    expect(clsx([[[]]])).toBe("");
    expect(clsx([[["foo"]]])).toBe("foo");
    expect(clsx([true, [["foo"]]])).toBe("foo");
    expect(clsx(["foo", ["bar", ["", [["baz"]]]]])).toBe("foo bar baz");
  });

  it("handles variadic arrays", () => {
    expect(clsx([], [])).toBe("");
    expect(clsx(["foo"], ["bar"])).toBe("foo bar");
    expect(clsx(["foo"], null, ["baz", ""], true, "", [])).toBe("foo baz");
  });
});

describe("clsx: functions are ignored", () => {
  it("drops function arguments", () => {
    const noop = () => {};
    expect(clsx(noop, "hello")).toBe("hello");
    expect(clsx(noop, "hello", clsx)).toBe("hello");
    expect(clsx(noop, "hello", [[clsx], "world"])).toBe("hello world");
  });
});
