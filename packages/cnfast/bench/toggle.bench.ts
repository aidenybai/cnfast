import { runSuite, type ClassListArgs, type Workload } from "./lib/harness";

const SITES = 200;
const FRAMES = 32;

const makeRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const bases: string[] = [];
const variantA: string[] = [];
const variantB: string[] = [];
const variantC: string[] = [];
for (let site = 0; site < SITES; site++) {
  bases.push(`flex items-center gap-${(site % 4) + 1} px-${(site % 6) + 1} text-sm`);
  variantA.push(`bg-blue-${((site % 5) + 1) * 100} text-white`);
  variantB.push(`opacity-50 pointer-events-none px-${(site % 8) + 1}`);
  variantC.push(`ring-2 ring-offset-${site % 4}`);
}

const makeFlagSchedule = (toggleRate: number, seed: number): boolean[][] => {
  const random = makeRandom(seed);
  const frames: boolean[][] = [];
  const current: boolean[] = [];
  for (let index = 0; index < SITES * 3; index++) current.push(random() < 0.5);
  frames.push([...current]);
  for (let frame = 1; frame < FRAMES; frame++) {
    for (let index = 0; index < SITES * 3; index++) {
      if (random() < toggleRate) current[index] = !current[index];
    }
    frames.push([...current]);
  }
  return frames;
};

const toggleWorkloads = (): Workload[] => {
  const workloads: Workload[] = [];

  for (const rate of [0.1, 0.3, 0.5]) {
    const label = `${Math.round(rate * 100)}%`;

    const flags2 = makeFlagSchedule(rate, 0xc0ffee);
    workloads.push({
      group: "toggle",
      name: `arity-2 toggle ${label}`,
      meta: `(${SITES} sites x ${FRAMES} frames)`,
      run: (impl) => {
        let sink = 0;
        for (let frame = 0; frame < FRAMES; frame++) {
          const flags = flags2[frame]!;
          for (let site = 0; site < SITES; site++) {
            sink += impl(bases[site]!, flags[site * 3]! && variantA[site]!).length;
          }
        }
        return sink;
      },
    });

    const flags3 = makeFlagSchedule(rate, 0xbadf00d);
    workloads.push({
      group: "toggle",
      name: `arity-3 toggle ${label}`,
      meta: `(${SITES} sites x ${FRAMES} frames)`,
      run: (impl) => {
        let sink = 0;
        for (let frame = 0; frame < FRAMES; frame++) {
          const flags = flags3[frame]!;
          for (let site = 0; site < SITES; site++) {
            sink += impl(
              bases[site]!,
              flags[site * 3]! && variantA[site]!,
              flags[site * 3 + 1]! && variantB[site]!,
            ).length;
          }
        }
        return sink;
      },
    });

    const flags5 = makeFlagSchedule(rate, 0x5eed);
    workloads.push({
      group: "toggle",
      name: `arity-5 toggle ${label}`,
      meta: `(${SITES} sites x ${FRAMES} frames)`,
      run: (impl) => {
        let sink = 0;
        for (let frame = 0; frame < FRAMES; frame++) {
          const flags = flags5[frame]!;
          for (let site = 0; site < SITES; site++) {
            sink += impl(
              bases[site]!,
              flags[site * 3]! && variantA[site]!,
              flags[site * 3 + 1]! && variantB[site]!,
              flags[site * 3 + 2]! && variantC[site]!,
              "rounded-md",
            ).length;
          }
        }
        return sink;
      },
    });
  }

  workloads.push({
    group: "toggle",
    name: "all-truthy control",
    meta: `(${SITES} sites x ${FRAMES} frames, arity 3)`,
    run: (impl) => {
      let sink = 0;
      for (let frame = 0; frame < FRAMES; frame++) {
        for (let site = 0; site < SITES; site++) {
          sink += impl(bases[site]!, variantA[site]!, variantB[site]!).length;
        }
      }
      return sink;
    },
  });

  workloads.push({
    group: "toggle",
    name: "all-falsy tail",
    meta: `(${SITES} sites x ${FRAMES} frames, arity 3)`,
    run: (impl) => {
      let sink = 0;
      for (let frame = 0; frame < FRAMES; frame++) {
        for (let site = 0; site < SITES; site++) {
          sink += impl(bases[site]!, false as ClassListArgs[number], null).length;
        }
      }
      return sink;
    },
  });

  return workloads;
};

await runSuite(toggleWorkloads(), "toggle");
