export const concatArrays = <T, U>(
  array1: readonly T[],
  array2: readonly U[],
): readonly (T | U)[] => {
  const length1 = array1.length;
  const length2 = array2.length;
  const combinedArray: (T | U)[] = new Array(length1 + length2);
  for (let index = 0; index < length1; index++) {
    combinedArray[index] = array1[index]!;
  }
  for (let index = 0; index < length2; index++) {
    combinedArray[length1 + index] = array2[index]!;
  }
  return combinedArray;
};
