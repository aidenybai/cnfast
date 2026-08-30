import { CHAR_OPEN_BRACKET } from "./char-codes";
import { AnyConfig } from "./types";

/**
 * Sorts modifiers according to following schema:
 * - Predefined modifiers are sorted alphabetically
 * - When an arbitrary variant appears, it must be preserved which modifiers are before and after it
 */
export const createSortModifiers = (config: AnyConfig) => {
  const orderSensitiveModifiers = new Set(config.orderSensitiveModifiers);

  const sortAndFlushSegment = (segment: string[], result: string[]): void => {
    segment.sort();
    for (let i = 0; i < segment.length; i++) {
      result.push(segment[i]!);
    }
  };

  return (modifiers: readonly string[]): string[] => {
    const result: string[] = [];
    let currentSegment: string[] = [];

    for (let i = 0; i < modifiers.length; i++) {
      const modifier = modifiers[i]!;

      // Empty modifiers (from `::`) read in bounds via the length guard.
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
