// `Array.fill` keeps a slower sparse-array layout. Pushing creates the packed layout used by hot
// indexed reads.
export const createFilledArray = <Value>(count: number, value: Value): Value[] => {
  const slots: Value[] = [];
  for (let index = 0; index < count; index++) slots.push(value);
  return slots;
};
