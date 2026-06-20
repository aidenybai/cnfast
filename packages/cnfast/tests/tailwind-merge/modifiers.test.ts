import { expect, test } from "vitest";

import { twMerge } from "../src";

test("conflicts across prefix modifiers", () => {
  expect(twMerge("hover:block hover:inline")).toBe("hover:inline");
  expect(twMerge("hover:block hover:focus:inline")).toBe("hover:block hover:focus:inline");
  expect(twMerge("hover:block hover:focus:inline focus:hover:inline")).toBe(
    "hover:block focus:hover:inline",
  );
  expect(twMerge("focus-within:inline focus-within:block")).toBe("focus-within:block");
});

test("conflicts across postfix modifiers", () => {
  expect(twMerge("text-lg/7 text-lg/8")).toBe("text-lg/8");
  expect(twMerge("text-lg/none leading-9")).toBe("text-lg/none leading-9");
  expect(twMerge("leading-9 text-lg/none")).toBe("text-lg/none");
  expect(twMerge("w-full w-1/2")).toBe("w-1/2");
});

test("sorts modifiers correctly", () => {
  expect(twMerge("c:d:e:block d:c:e:inline")).toBe("d:c:e:inline");
  expect(twMerge("*:before:block *:before:inline")).toBe("*:before:inline");
  expect(twMerge("*:before:block before:*:inline")).toBe("*:before:block before:*:inline");
  expect(twMerge("x:y:*:z:block y:x:*:z:inline")).toBe("y:x:*:z:inline");
});
