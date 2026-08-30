// V8 represents a `slice()` of 13+ chars as a SlicedString: every later charCodeAt pays a
// representation dispatch plus offset indirection, and the slice pins its whole parent string
// alive (JSC substrings share their base the same way). Long-lived canonical strings are copied
// char by char instead: the cons chain flattens to a sequential string on first read, and the
// parent is released. Short slices are already flat copies, so they take the plain path.
const SLICED_REPRESENTATION_MIN_LENGTH = 13;

export const sliceFlat = (source: string, start: number, end: number): string => {
  if (end - start < SLICED_REPRESENTATION_MIN_LENGTH) return source.slice(start, end);
  let copy = "";
  for (let i = start; i < end; i++) copy += source[i];
  return copy;
};
