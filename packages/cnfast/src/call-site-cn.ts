import { cn, type ClassNameFunction } from "./core.js";
import {
  CALL_SITE_MEMO_ARGUMENT_SLOTS_PER_ROW,
  CALL_SITE_MEMO_ROW_COUNT,
  EMPTY_CALL_SITE_MEMO_ARGUMENT_COUNT,
} from "./lib/constants.js";
import { createFilledArray } from "./utils/create-filled-array.js";

export const createCallSiteCn = (classNameFunction: ClassNameFunction = cn): ClassNameFunction => {
  const memoizedArgumentCounts = createFilledArray(
    CALL_SITE_MEMO_ROW_COUNT,
    EMPTY_CALL_SITE_MEMO_ARGUMENT_COUNT,
  );
  const memoizedResults = createFilledArray(CALL_SITE_MEMO_ROW_COUNT, "");
  const memoizedArguments = createFilledArray<unknown>(
    CALL_SITE_MEMO_ROW_COUNT * CALL_SITE_MEMO_ARGUMENT_SLOTS_PER_ROW,
    undefined,
  );
  let nextMemoRowIndex = 0;

  const memoizedClassNameFunction: ClassNameFunction = function (): string {
    const argumentCount = arguments.length;
    for (let rowIndex = 0; rowIndex < CALL_SITE_MEMO_ROW_COUNT; rowIndex++) {
      if (memoizedArgumentCounts[rowIndex] !== argumentCount) continue;
      const rowStartIndex = rowIndex * CALL_SITE_MEMO_ARGUMENT_SLOTS_PER_ROW;
      let argumentIndex = 0;
      while (
        argumentIndex < argumentCount &&
        arguments[argumentIndex] === memoizedArguments[rowStartIndex + argumentIndex]
      ) {
        argumentIndex++;
      }
      if (argumentIndex === argumentCount) return memoizedResults[rowIndex]!;
    }
    const resolvedClassName = Reflect.apply(classNameFunction, undefined, arguments);
    if (argumentCount <= CALL_SITE_MEMO_ARGUMENT_SLOTS_PER_ROW) {
      const rowIndex = nextMemoRowIndex;
      const rowStartIndex = rowIndex * CALL_SITE_MEMO_ARGUMENT_SLOTS_PER_ROW;
      memoizedArgumentCounts[rowIndex] = EMPTY_CALL_SITE_MEMO_ARGUMENT_COUNT;
      let argumentIndex = 0;
      for (; argumentIndex < argumentCount; argumentIndex++) {
        const classValue = arguments[argumentIndex];
        if (
          classValue !== null &&
          (typeof classValue === "object" || typeof classValue === "function")
        )
          break;
        memoizedArguments[rowStartIndex + argumentIndex] = classValue;
      }
      if (argumentIndex === argumentCount) {
        nextMemoRowIndex = rowIndex + 1 === CALL_SITE_MEMO_ROW_COUNT ? 0 : rowIndex + 1;
        memoizedArgumentCounts[rowIndex] = argumentCount;
        memoizedResults[rowIndex] = resolvedClassName;
      }
    }
    return resolvedClassName;
  };
  return memoizedClassNameFunction;
};
