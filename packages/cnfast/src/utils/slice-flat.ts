import { SLICED_REPRESENTATION_MIN_LENGTH } from "../lib/constants.js";

export const sliceFlat = (source: string, start: number, end: number): string => {
  if (end - start < SLICED_REPRESENTATION_MIN_LENGTH) return source.slice(start, end);
  let copy = "";
  for (let index = start; index < end; index++) copy += source[index];
  return copy;
};
