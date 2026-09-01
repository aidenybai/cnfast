import { cn, type ClassNameFunction } from "./core.js";
import { CALL_SITE_MEMO_ROWS, CALL_SITE_MEMO_ROW_ARG_SLOTS } from "./lib/constants.js";
import { createFilledArray } from "./utils/create-filled-array.js";

// A memo row may only hold primitives: cn is a pure function of its argument
// VALUES, so === on primitives guarantees a byte-identical result, while a
// truthy object/array can mutate between calls without changing identity.
// Rows are invalidated before the store loop because bailing out mid-write
// (on a truthy object argument) would otherwise leave a row whose surviving
// tail arguments belong to the evicted entry's result. The store loop reads
// this function's arguments object, which the delegated call cannot mutate.
export const createCallSiteCn = (classNameFunction: ClassNameFunction = cn): ClassNameFunction => {
  const rowArities = createFilledArray(CALL_SITE_MEMO_ROWS, -1);
  const rowResults = createFilledArray(CALL_SITE_MEMO_ROWS, "");
  const rowArguments = createFilledArray<unknown>(
    CALL_SITE_MEMO_ROWS * CALL_SITE_MEMO_ROW_ARG_SLOTS,
    undefined,
  );
  let victimRow = 0;

  const callSiteCn: ClassNameFunction = function (): string {
    const argumentCount = arguments.length;
    for (let row = 0; row < CALL_SITE_MEMO_ROWS; row++) {
      if (rowArities[row] !== argumentCount) continue;
      const base = row * CALL_SITE_MEMO_ROW_ARG_SLOTS;
      let index = 0;
      while (index < argumentCount && arguments[index] === rowArguments[base + index]) index++;
      if (index === argumentCount) return rowResults[row]!;
    }
    const mergedClassName = Reflect.apply(classNameFunction, undefined, arguments);
    if (argumentCount <= CALL_SITE_MEMO_ROW_ARG_SLOTS) {
      const row = victimRow;
      const base = row * CALL_SITE_MEMO_ROW_ARG_SLOTS;
      rowArities[row] = -1;
      let index = 0;
      for (; index < argumentCount; index++) {
        const classValue = arguments[index];
        if (
          classValue !== null &&
          (typeof classValue === "object" || typeof classValue === "function")
        )
          break;
        rowArguments[base + index] = classValue;
      }
      if (index === argumentCount) {
        victimRow = row + 1 === CALL_SITE_MEMO_ROWS ? 0 : row + 1;
        rowArities[row] = argumentCount;
        rowResults[row] = mergedClassName;
      }
    }
    return mergedClassName;
  };
  return callSiteCn;
};
