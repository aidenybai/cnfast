import { INPUT_SHAPE_FRAME_COUNT, INPUT_SHAPE_SITE_COUNT } from "../constants";
import { type ClassListArgs, type Workload } from "../lib/harness";

const baseClassNames: string[] = [];
const primaryClassNames: string[] = [];
const disabledClassNames: string[] = [];
const focusClassNames: string[] = [];

for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
  baseClassNames.push(
    `inline-flex items-center gap-${(siteIndex % 4) + 1} px-${(siteIndex % 6) + 1} text-sm`,
  );
  primaryClassNames.push(`bg-blue-${((siteIndex % 5) + 1) * 100} text-white`);
  disabledClassNames.push(`opacity-50 pointer-events-none px-${(siteIndex % 8) + 1}`);
  focusClassNames.push(`focus-visible:ring-2 ring-offset-${siteIndex % 4}`);
}

const getCases = (getCase: (siteIndex: number) => ClassListArgs): ClassListArgs[] => {
  const classListCases: ClassListArgs[] = [];
  for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
    classListCases.push(getCase(siteIndex));
  }
  return classListCases;
};

const oneStringCases = getCases((siteIndex) => [baseClassNames[siteIndex]!]);
const twoStringCases = getCases((siteIndex) => [
  baseClassNames[siteIndex]!,
  primaryClassNames[siteIndex]!,
]);
const threeStringCases = getCases((siteIndex) => [
  baseClassNames[siteIndex]!,
  primaryClassNames[siteIndex]!,
  disabledClassNames[siteIndex]!,
]);
const fourStringCases = getCases((siteIndex) => [
  baseClassNames[siteIndex]!,
  primaryClassNames[siteIndex]!,
  disabledClassNames[siteIndex]!,
  focusClassNames[siteIndex]!,
]);
const conditionalCases = getCases((siteIndex) => [
  baseClassNames[siteIndex]!,
  siteIndex % 2 === 0 && primaryClassNames[siteIndex]!,
  siteIndex % 3 === 0 ? disabledClassNames[siteIndex]! : null,
]);
const fiveStringCases = getCases((siteIndex) => [
  baseClassNames[siteIndex]!,
  primaryClassNames[siteIndex]!,
  disabledClassNames[siteIndex]!,
  focusClassNames[siteIndex]!,
  "rounded-md",
]);
const eightValueCases = getCases((siteIndex) => [
  baseClassNames[siteIndex]!,
  primaryClassNames[siteIndex]!,
  false,
  disabledClassNames[siteIndex]!,
  null,
  focusClassNames[siteIndex]!,
  undefined,
  "rounded-md",
]);
const flatArrayCases = getCases((siteIndex) => [
  [
    baseClassNames[siteIndex]!,
    primaryClassNames[siteIndex]!,
    siteIndex % 2 === 0 && disabledClassNames[siteIndex]!,
  ],
]);
const objectCases = getCases((siteIndex) => [
  baseClassNames[siteIndex]!,
  {
    [primaryClassNames[siteIndex]!]: siteIndex % 2 === 0,
    [disabledClassNames[siteIndex]!]: siteIndex % 3 === 0,
    [focusClassNames[siteIndex]!]: siteIndex % 5 === 0,
  },
]);
const nestedCases = getCases((siteIndex) => [
  baseClassNames[siteIndex]!,
  [
    primaryClassNames[siteIndex]!,
    [siteIndex % 2 === 0 && disabledClassNames[siteIndex]!, [focusClassNames[siteIndex]!]],
  ],
  { "rounded-md": true, hidden: false },
  siteIndex + 1,
]);

export const getInputShapeWorkloads = (): Workload[] => [
  {
    group: "input shape",
    name: "empty and falsy values",
    meta: `(${INPUT_SHAPE_SITE_COUNT} calls per form x ${INPUT_SHAPE_FRAME_COUNT} frames)`,
    classListCases: [[], [false, null, undefined, 0]],
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < INPUT_SHAPE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
          resultLengthSum += implementation().length;
          resultLengthSum += implementation(false, null, undefined, 0).length;
        }
      }
      return resultLengthSum;
    },
  },
  {
    group: "input shape",
    name: "one string",
    meta: `(arity 1, ${INPUT_SHAPE_SITE_COUNT} sites x ${INPUT_SHAPE_FRAME_COUNT} frames)`,
    classListCases: oneStringCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < INPUT_SHAPE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
          resultLengthSum += implementation(baseClassNames[siteIndex]!).length;
        }
      }
      return resultLengthSum;
    },
  },
  {
    group: "input shape",
    name: "two strings",
    meta: `(arity 2, ${INPUT_SHAPE_SITE_COUNT} sites x ${INPUT_SHAPE_FRAME_COUNT} frames)`,
    classListCases: twoStringCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < INPUT_SHAPE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
          resultLengthSum += implementation(
            baseClassNames[siteIndex]!,
            primaryClassNames[siteIndex]!,
          ).length;
        }
      }
      return resultLengthSum;
    },
  },
  {
    group: "input shape",
    name: "three strings",
    meta: `(arity 3, ${INPUT_SHAPE_SITE_COUNT} sites x ${INPUT_SHAPE_FRAME_COUNT} frames)`,
    classListCases: threeStringCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < INPUT_SHAPE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
          resultLengthSum += implementation(
            baseClassNames[siteIndex]!,
            primaryClassNames[siteIndex]!,
            disabledClassNames[siteIndex]!,
          ).length;
        }
      }
      return resultLengthSum;
    },
  },
  {
    group: "input shape",
    name: "conditional strings",
    meta: `(arity 3, ${INPUT_SHAPE_SITE_COUNT} sites x ${INPUT_SHAPE_FRAME_COUNT} frames)`,
    classListCases: conditionalCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < INPUT_SHAPE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
          resultLengthSum += implementation(
            baseClassNames[siteIndex]!,
            siteIndex % 2 === 0 && primaryClassNames[siteIndex]!,
            siteIndex % 3 === 0 ? disabledClassNames[siteIndex]! : null,
          ).length;
        }
      }
      return resultLengthSum;
    },
  },
  {
    group: "input shape",
    name: "four strings",
    meta: `(arity 4, ${INPUT_SHAPE_SITE_COUNT} sites x ${INPUT_SHAPE_FRAME_COUNT} frames)`,
    classListCases: fourStringCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < INPUT_SHAPE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
          resultLengthSum += implementation(
            baseClassNames[siteIndex]!,
            primaryClassNames[siteIndex]!,
            disabledClassNames[siteIndex]!,
            focusClassNames[siteIndex]!,
          ).length;
        }
      }
      return resultLengthSum;
    },
  },
  {
    group: "input shape",
    name: "five strings",
    meta: `(arity 5, ${INPUT_SHAPE_SITE_COUNT} sites x ${INPUT_SHAPE_FRAME_COUNT} frames)`,
    classListCases: fiveStringCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < INPUT_SHAPE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
          resultLengthSum += implementation(
            baseClassNames[siteIndex]!,
            primaryClassNames[siteIndex]!,
            disabledClassNames[siteIndex]!,
            focusClassNames[siteIndex]!,
            "rounded-md",
          ).length;
        }
      }
      return resultLengthSum;
    },
  },
  {
    group: "input shape",
    name: "eight mixed values",
    meta: `(arity 8, ${INPUT_SHAPE_SITE_COUNT} sites x ${INPUT_SHAPE_FRAME_COUNT} frames)`,
    classListCases: eightValueCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < INPUT_SHAPE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
          resultLengthSum += implementation(
            baseClassNames[siteIndex]!,
            primaryClassNames[siteIndex]!,
            false,
            disabledClassNames[siteIndex]!,
            null,
            focusClassNames[siteIndex]!,
            undefined,
            "rounded-md",
          ).length;
        }
      }
      return resultLengthSum;
    },
  },
  {
    group: "input shape",
    name: "flat arrays",
    meta: `(${INPUT_SHAPE_SITE_COUNT} sites x ${INPUT_SHAPE_FRAME_COUNT} frames)`,
    classListCases: flatArrayCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < INPUT_SHAPE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
          resultLengthSum += implementation(flatArrayCases[siteIndex]![0]!).length;
        }
      }
      return resultLengthSum;
    },
  },
  {
    group: "input shape",
    name: "object flags",
    meta: `(${INPUT_SHAPE_SITE_COUNT} sites x ${INPUT_SHAPE_FRAME_COUNT} frames)`,
    classListCases: objectCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < INPUT_SHAPE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
          const classListCase = objectCases[siteIndex]!;
          resultLengthSum += implementation(classListCase[0]!, classListCase[1]!).length;
        }
      }
      return resultLengthSum;
    },
  },
  {
    group: "input shape",
    name: "nested mixed values",
    meta: `(${INPUT_SHAPE_SITE_COUNT} sites x ${INPUT_SHAPE_FRAME_COUNT} frames)`,
    classListCases: nestedCases,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < INPUT_SHAPE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < INPUT_SHAPE_SITE_COUNT; siteIndex++) {
          const classListCase = nestedCases[siteIndex]!;
          resultLengthSum += implementation(
            classListCase[0]!,
            classListCase[1]!,
            classListCase[2]!,
            classListCase[3]!,
          ).length;
        }
      }
      return resultLengthSum;
    },
  },
];
