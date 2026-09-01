import { SPACE_CHARACTER } from "./constants.js";

export type ClassNameValue = ClassNameArray | string | null | undefined | 0 | 0n | false;
interface ClassNameArray extends ReadonlyArray<ClassNameValue> {
  readonly [index: number]: ClassNameValue;
}

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
    const nestedValue = value[index];
    if (nestedValue) {
      if ((resolvedClassName = resolveClassNameValue(nestedValue))) {
        if (classList) classList += SPACE_CHARACTER;
        classList += resolvedClassName;
      }
    }
  }

  return classList;
};
