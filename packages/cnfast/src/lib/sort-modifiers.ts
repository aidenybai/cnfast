import { CHAR_OPEN_BRACKET } from "./char-codes";
import { AnyConfig } from "./types";

export const createSortModifiers = (config: AnyConfig) => {
  const orderSensitiveModifiers = new Set(config.orderSensitiveModifiers);

  const sortAndFlushSegment = (segment: string[], result: string[]): void => {
    segment.sort();
    for (let index = 0; index < segment.length; index++) {
      result.push(segment[index]!);
    }
  };

  return (modifiers: readonly string[]): string[] => {
    const result: string[] = [];
    let currentSegment: string[] = [];

    for (let index = 0; index < modifiers.length; index++) {
      const modifier = modifiers[index]!;

      const isArbitrary = modifier.length !== 0 && modifier.charCodeAt(0) === CHAR_OPEN_BRACKET;
      const isOrderSensitive = orderSensitiveModifiers.has(modifier);

      if (isArbitrary || isOrderSensitive) {
        if (currentSegment.length > 0) {
          sortAndFlushSegment(currentSegment, result);
          currentSegment = [];
        }
        result.push(modifier);
      } else {
        currentSegment.push(modifier);
      }
    }

    if (currentSegment.length > 0) {
      sortAndFlushSegment(currentSegment, result);
    }

    return result;
  };
};
