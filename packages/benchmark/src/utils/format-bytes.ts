import { BYTES_PER_KIBIBYTE, VALUE_DECIMAL_PLACES } from "../constants";

export const formatBytes = (value: number): string =>
  `${(value / BYTES_PER_KIBIBYTE).toFixed(VALUE_DECIMAL_PLACES)} KiB`;
