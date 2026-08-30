// `new Array(count).fill(value)` keeps the HOLEY elements kind from its allocation site; pushing
// into an empty literal yields PACKED elements, which hot indexed reads depend on.
export const createFilledArray = <Value>(count: number, value: Value): Value[] => {
  const slots: Value[] = [];
  for (let i = 0; i < count; i++) slots.push(value);
  return slots;
};
