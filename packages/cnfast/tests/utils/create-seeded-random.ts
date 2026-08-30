export interface SeededRandom {
  getNext(): number;
}

export const createSeededRandom = (seed: number): SeededRandom => {
  let state = seed >>> 0;
  return {
    getNext: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let randomValue = state;
      randomValue = Math.imul(randomValue ^ (randomValue >>> 15), randomValue | 1);
      randomValue ^= randomValue + Math.imul(randomValue ^ (randomValue >>> 7), randomValue | 61);
      return ((randomValue ^ (randomValue >>> 14)) >>> 0) / 4_294_967_296;
    },
  };
};
