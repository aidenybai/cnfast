/**
 * Concatenates two arrays faster than the array spread operator.
 */
export const concatArrays = <T, U>(
  array1: readonly T[],
  array2: readonly U[],
): readonly (T | U)[] => {
  // Pre-allocate for better V8 optimization
  const length1 = array1.length;
  const length2 = array2.length;
  const combinedArray: (T | U)[] = new Array(length1 + length2);
  for (let i = 0; i < length1; i++) {
    combinedArray[i] = array1[i]!;
  }
  for (let i = 0; i < length2; i++) {
    combinedArray[length1 + i] = array2[i]!;
  }
  return combinedArray;
};
