export interface SeededRandom {
  getNext(): number;
}

export const createSeededRandom = (seed: number): SeededRandom => {
  let state = seed >>> 0;
  return {
    getNext: () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    },
  };
};
