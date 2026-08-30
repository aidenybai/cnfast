import { SPACE_CHARACTER } from "./lib/constants.js";

export interface ClassDictionary {
  // `unknown` rejects render functions accepted by clsx, including Base UI class-name callbacks.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional clsx type parity
  [className: string]: any;
}

export type ClassValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | ClassValue[]
  | ClassDictionary;

// A local binding avoids a global-object property read on every recursive call.
const isArray = Array.isArray;

export const resolveClassValue = (value: ClassValue): string => {
  if (!value) return "";

  if (typeof value === "string") return value;
  if (typeof value === "number") return "" + value;

  let classList = "";

  if (isArray(value)) {
    const length = value.length;
    for (let index = 0; index < length; index++) {
      const classValue = value[index];
      if (!classValue) continue;
      const resolvedClassName =
        typeof classValue === "string" ? classValue : resolveClassValue(classValue);
      if (resolvedClassName) {
        if (classList) classList += SPACE_CHARACTER;
        classList += resolvedClassName;
      }
    }
    return classList;
  }

  if (typeof value === "object") {
    for (const key in value) {
      if (value[key]) {
        if (classList) classList += SPACE_CHARACTER;
        classList += key;
      }
    }
  }

  return classList;
};

export const clsx = (...classValues: ClassValue[]): string => resolveClassValue(classValues);
