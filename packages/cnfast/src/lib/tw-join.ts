/**
 * The code in this file is copied from https://github.com/lukeed/clsx and modified to suit the needs of tailwind-merge better.
 *
 * Specifically:
 * - Runtime code from https://github.com/lukeed/clsx/blob/v1.2.1/src/index.js
 * - TypeScript types from https://github.com/lukeed/clsx/blob/v1.2.1/clsx.d.ts
 *
 * Original code has MIT license: Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)
 */

export type ClassNameValue = ClassNameArray | string | null | undefined | 0 | 0n | false;
type ClassNameArray = readonly ClassNameValue[];

export const twJoin = (...classLists: ClassNameValue[]): string => {
  let index = 0;
  let argument: ClassNameValue;
  let resolvedValue: string;
  let string = "";

  while (index < classLists.length) {
    if ((argument = classLists[index++])) {
      if ((resolvedValue = toValue(argument))) {
        if (string) string += " ";
        string += resolvedValue;
      }
    }
  }
  return string;
};

const toValue = (value: ClassNameArray | string): string => {
  if (typeof value === "string") {
    return value;
  }

  let resolvedValue: string;
  let string = "";

  for (let index = 0; index < value.length; index++) {
    if (value[index]) {
      if ((resolvedValue = toValue(value[index] as ClassNameArray | string))) {
        if (string) string += " ";
        string += resolvedValue;
      }
    }
  }

  return string;
};
