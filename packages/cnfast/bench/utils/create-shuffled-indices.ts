import { type SeededRandom } from "./create-seeded-random";

export const createShuffledIndices = (length: number, random: SeededRandom): number[] => {
  const indices = new Array<number>(length);
  for (let index = 0; index < length; index++) indices[index] = index;
  for (let index = length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random.getNext() * (index + 1));
    const heldValue = indices[index]!;
    indices[index] = indices[swapIndex]!;
    indices[swapIndex] = heldValue;
  }
  return indices;
};
