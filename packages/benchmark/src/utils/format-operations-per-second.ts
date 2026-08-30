import { VALUE_DECIMAL_PLACES } from "../constants";

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: VALUE_DECIMAL_PLACES,
  notation: "compact",
});

export const formatOperationsPerSecond = (value: number): string =>
  `${compactNumberFormatter.format(value)} ops/s`;
