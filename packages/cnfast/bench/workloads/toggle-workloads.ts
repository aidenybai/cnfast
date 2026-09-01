import { TOGGLE_FRAME_COUNT, TOGGLE_SITE_COUNT } from "../constants";
import { type Workload } from "../lib/harness";
import { createSeededRandom } from "../utils/create-seeded-random";

const baseClassNames: string[] = [];
const primaryVariantClassNames: string[] = [];
const disabledVariantClassNames: string[] = [];
const focusVariantClassNames: string[] = [];
for (let siteIndex = 0; siteIndex < TOGGLE_SITE_COUNT; siteIndex++) {
  baseClassNames.push(
    `flex items-center gap-${(siteIndex % 4) + 1} px-${(siteIndex % 6) + 1} text-sm`,
  );
  primaryVariantClassNames.push(`bg-blue-${((siteIndex % 5) + 1) * 100} text-white`);
  disabledVariantClassNames.push(`opacity-50 pointer-events-none px-${(siteIndex % 8) + 1}`);
  focusVariantClassNames.push(`ring-2 ring-offset-${siteIndex % 4}`);
}

const createFlagSchedule = (toggleRate: number, seed: number): boolean[][] => {
  const random = createSeededRandom(seed);
  const flagFrames: boolean[][] = [];
  const currentFlags: boolean[] = [];
  for (let index = 0; index < TOGGLE_SITE_COUNT * 3; index++) {
    currentFlags.push(random.getNext() < 0.5);
  }
  flagFrames.push([...currentFlags]);
  for (let frameIndex = 1; frameIndex < TOGGLE_FRAME_COUNT; frameIndex++) {
    for (let index = 0; index < TOGGLE_SITE_COUNT * 3; index++) {
      if (random.getNext() < toggleRate) currentFlags[index] = !currentFlags[index];
    }
    flagFrames.push([...currentFlags]);
  }
  return flagFrames;
};

export const getToggleWorkloads = (): Workload[] => {
  const workloads: Workload[] = [];

  for (const toggleRate of [0.1, 0.3, 0.5]) {
    const toggleRateLabel = `${Math.round(toggleRate * 100)}%`;

    const twoArgumentFlagFrames = createFlagSchedule(toggleRate, 0xc0ffee);
    workloads.push({
      group: "toggle",
      name: `arity-2 toggle ${toggleRateLabel}`,
      meta: `(${TOGGLE_SITE_COUNT} sites x ${TOGGLE_FRAME_COUNT} frames)`,
      run: (implementation) => {
        let resultLengthSum = 0;
        for (let frameIndex = 0; frameIndex < TOGGLE_FRAME_COUNT; frameIndex++) {
          const frameFlags = twoArgumentFlagFrames[frameIndex]!;
          for (let siteIndex = 0; siteIndex < TOGGLE_SITE_COUNT; siteIndex++) {
            resultLengthSum += implementation(
              baseClassNames[siteIndex]!,
              frameFlags[siteIndex * 3]! && primaryVariantClassNames[siteIndex]!,
            ).length;
          }
        }
        return resultLengthSum;
      },
    });

    const threeArgumentFlagFrames = createFlagSchedule(toggleRate, 0xbadf00d);
    workloads.push({
      group: "toggle",
      name: `arity-3 toggle ${toggleRateLabel}`,
      meta: `(${TOGGLE_SITE_COUNT} sites x ${TOGGLE_FRAME_COUNT} frames)`,
      run: (implementation) => {
        let resultLengthSum = 0;
        for (let frameIndex = 0; frameIndex < TOGGLE_FRAME_COUNT; frameIndex++) {
          const frameFlags = threeArgumentFlagFrames[frameIndex]!;
          for (let siteIndex = 0; siteIndex < TOGGLE_SITE_COUNT; siteIndex++) {
            resultLengthSum += implementation(
              baseClassNames[siteIndex]!,
              frameFlags[siteIndex * 3]! && primaryVariantClassNames[siteIndex]!,
              frameFlags[siteIndex * 3 + 1]! && disabledVariantClassNames[siteIndex]!,
            ).length;
          }
        }
        return resultLengthSum;
      },
    });

    const fiveArgumentFlagFrames = createFlagSchedule(toggleRate, 0x5eed);
    workloads.push({
      group: "toggle",
      name: `arity-5 toggle ${toggleRateLabel}`,
      meta: `(${TOGGLE_SITE_COUNT} sites x ${TOGGLE_FRAME_COUNT} frames)`,
      run: (implementation) => {
        let resultLengthSum = 0;
        for (let frameIndex = 0; frameIndex < TOGGLE_FRAME_COUNT; frameIndex++) {
          const frameFlags = fiveArgumentFlagFrames[frameIndex]!;
          for (let siteIndex = 0; siteIndex < TOGGLE_SITE_COUNT; siteIndex++) {
            resultLengthSum += implementation(
              baseClassNames[siteIndex]!,
              frameFlags[siteIndex * 3]! && primaryVariantClassNames[siteIndex]!,
              frameFlags[siteIndex * 3 + 1]! && disabledVariantClassNames[siteIndex]!,
              frameFlags[siteIndex * 3 + 2]! && focusVariantClassNames[siteIndex]!,
              "rounded-md",
            ).length;
          }
        }
        return resultLengthSum;
      },
    });
  }

  workloads.push({
    group: "toggle",
    name: "all-truthy control",
    meta: `(${TOGGLE_SITE_COUNT} sites x ${TOGGLE_FRAME_COUNT} frames, arity 3)`,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < TOGGLE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < TOGGLE_SITE_COUNT; siteIndex++) {
          resultLengthSum += implementation(
            baseClassNames[siteIndex]!,
            primaryVariantClassNames[siteIndex]!,
            disabledVariantClassNames[siteIndex]!,
          ).length;
        }
      }
      return resultLengthSum;
    },
  });

  workloads.push({
    group: "toggle",
    name: "all-falsy tail",
    meta: `(${TOGGLE_SITE_COUNT} sites x ${TOGGLE_FRAME_COUNT} frames, arity 3)`,
    run: (implementation) => {
      let resultLengthSum = 0;
      for (let frameIndex = 0; frameIndex < TOGGLE_FRAME_COUNT; frameIndex++) {
        for (let siteIndex = 0; siteIndex < TOGGLE_SITE_COUNT; siteIndex++) {
          resultLengthSum += implementation(baseClassNames[siteIndex]!, false, null).length;
        }
      }
      return resultLengthSum;
    },
  });

  return workloads;
};
