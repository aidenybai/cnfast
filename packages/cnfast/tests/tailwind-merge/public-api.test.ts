import { expect, test } from "vitest";

import { ClassNameValue, twJoin, twMerge } from "../src";

test("has correct export types", () => {
  expect(twMerge).toStrictEqual(expect.any(Function));
  expect(twJoin).toStrictEqual(expect.any(Function));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const noRun = () => {
    const classNameValue: ClassNameValue = "some-class";

    twMerge(classNameValue, classNameValue, classNameValue);
    twJoin(classNameValue, classNameValue, classNameValue);
  };
});

test("twMerge() has correct inputs and outputs", () => {
  expect(twMerge("")).toStrictEqual(expect.any(String));
  expect(twMerge("hello world")).toStrictEqual(expect.any(String));
  expect(twMerge("-:-:-:::---h-")).toStrictEqual(expect.any(String));
  expect(twMerge("hello world", "-:-:-:::---h-")).toStrictEqual(expect.any(String));
  expect(twMerge("hello world", "-:-:-:::---h-", "", "something")).toStrictEqual(
    expect.any(String),
  );
  expect(twMerge("hello world", undefined)).toStrictEqual(expect.any(String));
  expect(twMerge("hello world", undefined, null)).toStrictEqual(expect.any(String));
  expect(twMerge("hello world", undefined, null, false)).toStrictEqual(expect.any(String));
  expect(twMerge("hello world", [undefined], [null, false])).toStrictEqual(expect.any(String));
  expect(twMerge("hello world", [undefined], [null, [false, "some-class"], []])).toStrictEqual(
    expect.any(String),
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const noRun = () => {
    // @ts-expect-error number is not a valid class value
    twMerge(123);
    // @ts-expect-error boolean true is not a valid class value
    twMerge(true);
    // @ts-expect-error object is not a valid class value
    twMerge({});
    // @ts-expect-error Date is not a valid class value
    twMerge(new Date());
    // @ts-expect-error function is not a valid class value
    twMerge(() => {});
  };
});

test("twJoin has correct inputs and outputs", () => {
  expect(twJoin()).toStrictEqual(expect.any(String));
  expect(twJoin("")).toStrictEqual(expect.any(String));
  expect(twJoin("", [false, null, undefined, 0, [], [false, [""], ""]])).toStrictEqual(
    expect.any(String),
  );
});
