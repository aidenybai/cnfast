import { runSuite, type ClassListArgs, type Workload } from "./lib/harness";

// Conditional-classname toggle family: React re-render patterns of the shape
// `cn(base, cond && "variant")` where the SAME call sites re-run every frame but their boolean
// flags flip between frames. Falsy args contribute nothing to the output, so the arg cache keys
// on the truthy-filtered sequence (falsy-canonical keys): every flag combination of a call site
// collapses onto a handful of shared truthy-sequence entries instead of one entry per raw arg
// pattern, and a single-truthy frame routes to the whole-string cache. These cells exist to keep
// that property measured — a regression shows up as toggle-rate-dependent slowdown (higher toggle
// rates would thrash the arg cache) instead of flat hit-path cost across rates.

const SITES = 200;
const FRAMES = 32;

// Deterministic LCG so every run (and both impls) sees the identical flag schedule.
const makeRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

// Per-site stable class fragments (JSX-literal analogs: identity-stable across frames).
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

// Precomputed flag schedule: flags[frame][site * 3 + slot]. Each flag flips between consecutive
// frames with probability `toggleRate` (frame 0 starts random at 50/50), so the workload models
// "N% of conditions changed since the last render".
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

    // Arity 2: cn(base, active && variant) — the canonical shadcn conditional.
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

    // Arity 3: two independent conditions.
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

    // Arity 5 (variadic path): three conditions plus a trailing stable arg.
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

  // Control cell: 0% toggle (all flags permanently truthy). If canonicalization works, the toggle
  // cells above cost roughly the same per call as this pure-hit control; a gap that grows with
  // toggle rate means falsy variants are being keyed separately again.
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

  // All-falsy tails: every conditional off — the single-truthy fast-path cell.
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
