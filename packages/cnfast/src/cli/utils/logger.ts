import { highlighter } from "./highlighter.js";

export const logger = {
  error: (...values: unknown[]) => {
    console.log(highlighter.error(values.join(" ")));
  },
  warn: (...values: unknown[]) => {
    console.log(highlighter.warn(values.join(" ")));
  },
  success: (...values: unknown[]) => {
    console.log(highlighter.success(values.join(" ")));
  },
  info: (...values: unknown[]) => {
    console.log(highlighter.info(values.join(" ")));
  },
  log: (...values: unknown[]) => {
    console.log(values.join(" "));
  },
  break: () => {
    console.log("");
  },
};
