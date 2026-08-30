// `new Array(count).fill(value)` keeps the HOLEY elements kind from its allocation site; pushing
// into an empty literal yields PACKED elements, which hot indexed reads depend on.
export const createFilledArray = <Value>(count: number, value: Value): Value[] => {
  const slots: Value[] = [];
  for (let index = 0; index < count; index++) slots.push(value);
  return slots;
};
