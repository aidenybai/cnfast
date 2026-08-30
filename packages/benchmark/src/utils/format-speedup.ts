import { VALUE_DECIMAL_PLACES } from "../constants";

export const formatSpeedup = (value: number): string => `${value.toFixed(VALUE_DECIMAL_PLACES)}×`;
