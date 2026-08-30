import { SPACE_CHARACTER } from "./constants";

/**
 * Adapted from clsx v1.2.1 runtime and TypeScript definitions.
 * MIT License. Copyright Luke Edwards <luke.edwards05@gmail.com>.
 */

export type ClassNameValue = ClassNameArray | string | null | undefined | 0 | 0n | false;
type ClassNameArray = readonly ClassNameValue[];

export const twJoin = (...classValues: ClassNameValue[]): string => {
  let index = 0;
  let classValue: ClassNameValue;
  let resolvedClassName: string;
  let classList = "";

  while (index < classValues.length) {
    if ((classValue = classValues[index++])) {
      if ((resolvedClassName = resolveClassNameValue(classValue))) {
        if (classList) classList += SPACE_CHARACTER;
        classList += resolvedClassName;
      }
    }
  }
  return classList;
};

const resolveClassNameValue = (value: ClassNameArray | string): string => {
  if (typeof value === "string") {
    return value;
  }

  let resolvedClassName: string;
  let classList = "";

  for (let index = 0; index < value.length; index++) {
    if (value[index]) {
      if ((resolvedClassName = resolveClassNameValue(value[index] as ClassNameArray | string))) {
        if (classList) classList += SPACE_CHARACTER;
        classList += resolvedClassName;
      }
    }
  }

  return classList;
};
