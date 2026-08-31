export const getGeometricMean = (values: number[]): number => {
  if (values.length === 0) return Number.NaN;
  let logarithmSum = 0;
  for (let index = 0; index < values.length; index++) {
    logarithmSum += Math.log(values[index]!);
  }
  return Math.exp(logarithmSum / values.length);
};
