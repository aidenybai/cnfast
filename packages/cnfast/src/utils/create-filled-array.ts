export const createFilledArray = <Value>(count: number, value: Value): Value[] => {
  const slots: Value[] = [];
  for (let index = 0; index < count; index++) slots.push(value);
  return slots;
};
