/**
 * Adapted from clsx v1.2.1 tests.
 * MIT License. Copyright Luke Edwards <luke.edwards05@gmail.com>.
 */

import { expect, test } from "vitest";

import { twJoin } from "../src";

test("strings", () => {
  expect(twJoin("")).toBe("");
  expect(twJoin("foo")).toBe("foo");
  expect(twJoin(true && "foo")).toBe("foo");
  expect(twJoin(false && "foo")).toBe("");
});

test("strings (variadic)", () => {
  expect(twJoin("")).toBe("");
  expect(twJoin("foo", "bar")).toBe("foo bar");
  expect(twJoin(true && "foo", false && "bar", "baz")).toBe("foo baz");
  expect(twJoin(false && "foo", "bar", "baz", "")).toBe("bar baz");
});

test("arrays", () => {
  expect(twJoin([])).toBe("");
  expect(twJoin(["foo"])).toBe("foo");
  expect(twJoin(["foo", "bar"])).toBe("foo bar");
  expect(twJoin(["foo", 0 && "bar", 1 && "baz"])).toBe("foo baz");
});

test("arrays (nested)", () => {
  expect(twJoin([[[]]])).toBe("");
  expect(twJoin([[["foo"]]])).toBe("foo");
  expect(twJoin([false, [["foo"]]])).toBe("foo");
  expect(twJoin(["foo", ["bar", ["", [["baz"]]]]])).toBe("foo bar baz");
});

test("arrays (variadic)", () => {
  expect(twJoin([], [])).toBe("");
  expect(twJoin(["foo"], ["bar"])).toBe("foo bar");
  expect(twJoin(["foo"], null, ["baz", ""], false, "", [])).toBe("foo baz");
});
