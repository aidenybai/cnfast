import { UNCACHED_BENCHMARK_CASE_COUNT } from "../constants";
import { type ClassListArgs, type Workload } from "../lib/harness";
import { createClassListReplay } from "../utils/create-class-list-replay";

const spacingValues = ["0", "0.5", "1", "2", "3", "4", "6", "8"];
const colorValues = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
const breakpoints = ["sm", "md", "lg", "xl", "2xl"];
const states = ["hover", "focus", "focus-visible", "active", "disabled"];

const getClassListCases = (getClassList: (index: number) => string): ClassListArgs[] => {
  const classListCases: ClassListArgs[] = [];
  for (let index = 0; index < UNCACHED_BENCHMARK_CASE_COUNT; index++) {
    classListCases.push([getClassList(index)]);
  }
  return classListCases;
};

const getWorkload = (name: string, classListCases: ClassListArgs[]): Workload => ({
  group: "merge syntax",
  name,
  meta: `(${UNCACHED_BENCHMARK_CASE_COUNT} unique misses)`,
  classListCases,
  run: createClassListReplay(classListCases),
});

export const getMergeSyntaxWorkloads = (): Workload[] => [
  getWorkload(
    "conflict-free utilities",
    getClassListCases((index) =>
      [
        "flex items-center justify-between rounded-md border shadow-sm",
        `gap-${spacingValues[index % spacingValues.length]}`,
        `text-blue-${colorValues[index % colorValues.length]}`,
        `benchmark-${index}`,
      ].join(" "),
    ),
  ),
  getWorkload(
    "same-group conflicts",
    getClassListCases(
      (index) =>
        `p-1 p-2 p-3 p-${spacingValues[index % spacingValues.length]} ` +
        `bg-red-100 bg-blue-300 bg-zinc-${colorValues[index % colorValues.length]} ` +
        `rounded-sm rounded-lg rounded-${index % 2 === 0 ? "full" : "none"} benchmark-${index}`,
    ),
  ),
  getWorkload(
    "directional conflicts",
    getClassListCases(
      (index) =>
        `inset-0 inset-x-2 left-${spacingValues[index % spacingValues.length]} right-4 ` +
        `p-2 px-4 ps-6 pl-${spacingValues[(index + 1) % spacingValues.length]} ` +
        `border border-x-2 border-l-${index % 2 === 0 ? "4" : "8"} benchmark-${index}`,
    ),
  ),
  getWorkload(
    "responsive and state modifiers",
    getClassListCases((index) => {
      const breakpoint = breakpoints[index % breakpoints.length]!;
      const state = states[index % states.length]!;
      return (
        `${breakpoint}:p-2 ${breakpoint}:p-4 ${state}:bg-red-500 ${state}:bg-blue-500 ` +
        `dark:${state}:text-zinc-${colorValues[index % colorValues.length]} ` +
        `group-hover:${breakpoint}:opacity-100 benchmark-${index}`
      );
    }),
  ),
  getWorkload(
    "arbitrary variants",
    getClassListCases(
      (index) =>
        `[&>*]:p-2 [&>*]:p-4 [&_svg]:size-4 [&_svg]:size-5 ` +
        `[@supports(display:grid)]:grid [@media(min-width:${640 + index}px)]:block ` +
        `[&:nth-child(${(index % spacingValues.length) + 1})]:text-red-500 benchmark-${index}`,
    ),
  ),
  getWorkload(
    "arbitrary values and properties",
    getClassListCases(
      (index) =>
        `w-[${index + 1}px] w-[calc(100%-${index % colorValues.length}px)] ` +
        `bg-[rgb(${index % 256}_${(index * 7) % 256}_${(index * 13) % 256})] ` +
        `[mask-type:luminance] [mask-type:alpha] [--column:${index}] benchmark-${index}`,
    ),
  ),
  getWorkload(
    "important negative and postfix",
    getClassListCases(
      (index) =>
        `-mt-2 mt-4! !-translate-x-1/2 translate-x-${spacingValues[index % spacingValues.length]} ` +
        `text-sm/6 text-lg/${(index % spacingValues.length) + 3} leading-8 ` +
        `!bg-red-500 bg-blue-${colorValues[index % colorValues.length]}! benchmark-${index}`,
    ),
  ),
  getWorkload(
    "theme variable shorthand",
    getClassListCases(
      (index) =>
        `bg-(--surface-${index}) text-(color:--foreground-${index}) ` +
        `grid-cols-(--columns-${index}) shadow-(--shadow-${index}) ` +
        `font-(family-name:--font-${index}) benchmark-${index}`,
    ),
  ),
  getWorkload(
    "whitespace normalization",
    getClassListCases(
      (index) =>
        `  flex\t items-center\n p-2   p-${spacingValues[index % spacingValues.length]} ` +
        ` hover:bg-red-500\r\n hover:bg-blue-500  benchmark-${index}  `,
    ),
  ),
  getWorkload(
    "long conflict chains",
    getClassListCases(
      (index) =>
        `p-0 p-1 p-2 p-3 p-4 p-5 p-6 p-7 p-8 p-9 p-10 p-11 p-12 p-14 p-16 ` +
        `text-xs text-sm text-base text-lg text-xl text-2xl text-3xl text-${index % 2 === 0 ? "4xl" : "5xl"} ` +
        `bg-red-50 bg-red-100 bg-red-200 bg-red-300 bg-red-400 bg-red-500 bg-red-600 benchmark-${index}`,
    ),
  ),
  getWorkload(
    "unknown class names",
    getClassListCases(
      (index) =>
        `component-${index} component__item-${index} is-active-${index} js-hook-${index} ` +
        `vendor:token-${index} data-state-${index} benchmark-${index}`,
    ),
  ),
  getWorkload(
    "slash and typed arbitrary values",
    getClassListCases(
      (index) =>
        `w-1/2 w-${(index % spacingValues.length) + 1}/12 aspect-4/3 ` +
        `text-[length:${index + 10}px] text-[color:rgb(${index % 256}_0_0)] ` +
        `bg-[position:${index}px_${index + 1}px] benchmark-${index}`,
    ),
  ),
];
