import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type ClassValue } from "../src/index.js";
import { createSeededRandom, type SeededRandom } from "./utils/create-seeded-random";
import { createShuffledIndices } from "./utils/create-shuffled-indices";

type BenchmarkLane = "fixed" | "shuffled";

interface ClassNameImplementation {
  (...classValues: ClassValue[]): string;
}

interface LoadedCnModule {
  cn?: unknown;
  default?: unknown;
}

interface ParentOptions {
  baseModulePath: string;
  candidateModulePath: string;
  datasetPath: string;
  engines: string[];
  processCount: number;
  lanes: BenchmarkLane[];
  quadCount: number;
  blockReplayCount: number;
  seed: number;
  jsonOutput: boolean;
}

interface ChildOptions {
  baseBundlePath: string;
  candidateBundlePath: string;
  datasetPath: string;
  lanes: BenchmarkLane[];
  quadCount: number;
  blockReplayCount: number;
  seed: number;
  mirrorRoles: boolean;
}

interface TimedBlock {
  elapsedNs: number;
  checksum: number;
}

interface LaneMeasurement {
  quadRatios: number[];
  baseNsPerCall: number;
  candidateNsPerCall: number;
  baseChecksum: number;
  candidateChecksum: number;
}

interface ChildReport {
  fixed?: LaneMeasurement;
  shuffled?: LaneMeasurement;
}

interface BootstrapInterval {
  lower: number;
  upper: number;
}

interface LaneComparison {
  engine: string;
  lane: BenchmarkLane;
  processCount: number;
  quadCount: number;
  medianRatio: number;
  ciLower: number;
  ciUpper: number;
  mdePercent: number;
  verdict: string;
  baseNsPerCall: number;
  candidateNsPerCall: number;
  checksumsMatch: boolean;
}

const DEFAULT_ENGINES = ["bun", "node"];
const DEFAULT_PROCESS_COUNT = 10;
const DEFAULT_LANES: BenchmarkLane[] = ["fixed", "shuffled"];
const DEFAULT_QUAD_COUNT = 16;
const DEFAULT_BLOCK_REPLAY_COUNT = 20;
const DEFAULT_CHILD_SEED = 20_260_830;
const WARMUP_QUAD_COUNT = 4;
const SHUFFLED_ORDER_COUNT = 8;
const BOOTSTRAP_RESAMPLE_COUNT = 10_000;
const BOOTSTRAP_SEED = 0xab_00_c1;
const BOOTSTRAP_LOWER_QUANTILE = 0.025;
const BOOTSTRAP_UPPER_QUANTILE = 0.975;
const CHILD_OUTPUT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const PERCENT_FACTOR = 100;

const DATASET_PATH = fileURLToPath(
  new URL("../tests/tailwind-merge/tw-merge-benchmark-data.json", import.meta.url),
);

const readFlagValue = (argv: string[], flag: string): string | undefined => {
  const flagIndex = argv.indexOf(flag);
  return flagIndex === -1 ? undefined : argv[flagIndex + 1];
};

const parseLanes = (laneList: string): BenchmarkLane[] => {
  const lanes: BenchmarkLane[] = [];
  for (const laneName of laneList.split(",")) {
    if (laneName !== "fixed" && laneName !== "shuffled") {
      throw new Error(`Unknown lane "${laneName}" (expected fixed|shuffled)`);
    }
    lanes.push(laneName);
  }
  return lanes;
};

const parseParentOptions = (argv: string[]): ParentOptions => {
  const baseModulePath = readFlagValue(argv, "--base");
  const candidateModulePath = readFlagValue(argv, "--cand");
  if (!baseModulePath || !candidateModulePath) {
    console.error(
      "Usage: bun bench/ab-compare.ts --base <module> --cand <module> " +
        "[--data <rows.json>] [--engines bun,node] [--processes N] [--lanes fixed,shuffled] " +
        "[--quads N] [--block-replays N] [--seed N] [--json]",
    );
    process.exit(2);
  }
  return {
    baseModulePath: resolve(baseModulePath),
    candidateModulePath: resolve(candidateModulePath),
    datasetPath: resolve(readFlagValue(argv, "--data") ?? DATASET_PATH),
    engines: (readFlagValue(argv, "--engines") ?? DEFAULT_ENGINES.join(",")).split(","),
    processCount: Number(readFlagValue(argv, "--processes") ?? DEFAULT_PROCESS_COUNT),
    lanes: parseLanes(readFlagValue(argv, "--lanes") ?? DEFAULT_LANES.join(",")),
    quadCount: Number(readFlagValue(argv, "--quads") ?? DEFAULT_QUAD_COUNT),
    blockReplayCount: Number(readFlagValue(argv, "--block-replays") ?? DEFAULT_BLOCK_REPLAY_COUNT),
    seed: Number(readFlagValue(argv, "--seed") ?? DEFAULT_CHILD_SEED),
    jsonOutput: argv.includes("--json"),
  };
};

const parseChildOptions = (argv: string[]): ChildOptions => ({
  baseBundlePath: readFlagValue(argv, "--base-bundle")!,
  candidateBundlePath: readFlagValue(argv, "--cand-bundle")!,
  datasetPath: readFlagValue(argv, "--data")!,
  lanes: parseLanes(readFlagValue(argv, "--lanes")!),
  quadCount: Number(readFlagValue(argv, "--quads")!),
  blockReplayCount: Number(readFlagValue(argv, "--block-replays")!),
  seed: Number(readFlagValue(argv, "--seed")!),
  mirrorRoles: argv.includes("--mirror"),
});

const loadImplementation = async (bundlePath: string): Promise<ClassNameImplementation> => {
  const loadedModule: LoadedCnModule = await import(pathToFileURL(bundlePath).href);
  const implementation =
    typeof loadedModule.cn === "function" ? loadedModule.cn : loadedModule.default;
  if (typeof implementation !== "function") {
    throw new Error(`Module ${bundlePath} exports neither "cn" nor a callable default`);
  }
  return implementation as ClassNameImplementation;
};

// Two textually identical timers so each `implementation(...)` call site keeps
// its own inline cache: a single shared timer hands the first-seen instance the
// IC fast slot and biases an A/A comparison by ~1% under JSC.
const timeBaseBlock = (
  implementation: ClassNameImplementation,
  rows: ClassValue[][],
  orders: number[][],
  replayCount: number,
): TimedBlock => {
  let checksum = 0;
  const startNs = process.hrtime.bigint();
  for (let replayIndex = 0; replayIndex < replayCount; replayIndex++) {
    const order = orders[replayIndex % orders.length]!;
    for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
      checksum += implementation(...rows[order[orderIndex]]!).length;
    }
  }
  const elapsedNs = Number(process.hrtime.bigint() - startNs);
  return { elapsedNs, checksum };
};

const timeCandidateBlock = (
  implementation: ClassNameImplementation,
  rows: ClassValue[][],
  orders: number[][],
  replayCount: number,
): TimedBlock => {
  let checksum = 0;
  const startNs = process.hrtime.bigint();
  for (let replayIndex = 0; replayIndex < replayCount; replayIndex++) {
    const order = orders[replayIndex % orders.length]!;
    for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
      checksum += implementation(...rows[order[orderIndex]]!).length;
    }
  }
  const elapsedNs = Number(process.hrtime.bigint() - startNs);
  return { elapsedNs, checksum };
};

const measureLane = (
  baseImplementation: ClassNameImplementation,
  candidateImplementation: ClassNameImplementation,
  rows: ClassValue[][],
  orders: number[][],
  quadCount: number,
  blockReplayCount: number,
): LaneMeasurement => {
  const runBaseBlock = (): TimedBlock =>
    timeBaseBlock(baseImplementation, rows, orders, blockReplayCount);
  const runCandidateBlock = (): TimedBlock =>
    timeCandidateBlock(candidateImplementation, rows, orders, blockReplayCount);

  // Warmup alternates the first runner exactly like the measured quads do:
  // JSC hands a consistent edge to whichever instance runs first overall.
  for (let warmupIndex = 0; warmupIndex < WARMUP_QUAD_COUNT; warmupIndex++) {
    const warmupOuter = warmupIndex % 2 === 0 ? runBaseBlock : runCandidateBlock;
    const warmupInner = warmupIndex % 2 === 0 ? runCandidateBlock : runBaseBlock;
    warmupOuter();
    warmupInner();
    warmupInner();
    warmupOuter();
  }

  const quadRatios: number[] = [];
  let baseNsTotal = 0;
  let candidateNsTotal = 0;
  let baseChecksum = 0;
  let candidateChecksum = 0;
  for (let quadIndex = 0; quadIndex < quadCount; quadIndex++) {
    const isBaseOuter = quadIndex % 2 === 0;
    const runOuterBlock = isBaseOuter ? runBaseBlock : runCandidateBlock;
    const runInnerBlock = isBaseOuter ? runCandidateBlock : runBaseBlock;
    const outerFirst = runOuterBlock();
    const innerFirst = runInnerBlock();
    const innerSecond = runInnerBlock();
    const outerSecond = runOuterBlock();
    const outerNs = outerFirst.elapsedNs + outerSecond.elapsedNs;
    const innerNs = innerFirst.elapsedNs + innerSecond.elapsedNs;
    const outerChecksum = outerFirst.checksum + outerSecond.checksum;
    const innerChecksum = innerFirst.checksum + innerSecond.checksum;
    const baseNs = isBaseOuter ? outerNs : innerNs;
    const candidateNs = isBaseOuter ? innerNs : outerNs;
    quadRatios.push(candidateNs / baseNs);
    baseNsTotal += baseNs;
    candidateNsTotal += candidateNs;
    baseChecksum += isBaseOuter ? outerChecksum : innerChecksum;
    candidateChecksum += isBaseOuter ? innerChecksum : outerChecksum;
  }

  const callsPerSide = quadCount * 2 * blockReplayCount * rows.length;
  return {
    quadRatios,
    baseNsPerCall: baseNsTotal / callsPerSide,
    candidateNsPerCall: candidateNsTotal / callsPerSide,
    baseChecksum,
    candidateChecksum,
  };
};

const invertMeasurement = (measurement: LaneMeasurement): LaneMeasurement => ({
  quadRatios: measurement.quadRatios.map((quadRatio) => 1 / quadRatio),
  baseNsPerCall: measurement.candidateNsPerCall,
  candidateNsPerCall: measurement.baseNsPerCall,
  baseChecksum: measurement.candidateChecksum,
  candidateChecksum: measurement.baseChecksum,
});

const runChild = async (argv: string[]): Promise<void> => {
  const options = parseChildOptions(argv);
  // Mirrored children run the whole experiment with the modules' roles
  // swapped and report inverted ratios, so structural in-process asymmetries
  // (first-executed advantage, IC ordering) cancel in the pooled median.
  const firstRoleBundlePath = options.mirrorRoles
    ? options.candidateBundlePath
    : options.baseBundlePath;
  const secondRoleBundlePath = options.mirrorRoles
    ? options.baseBundlePath
    : options.candidateBundlePath;
  const baseImplementation = await loadImplementation(firstRoleBundlePath);
  const candidateImplementation = await loadImplementation(secondRoleBundlePath);
  const rows = JSON.parse(readFileSync(options.datasetPath, "utf8")) as ClassValue[][];

  const fixedOrder = new Array<number>(rows.length);
  for (let index = 0; index < rows.length; index++) fixedOrder[index] = index;
  const shuffleRandom = createSeededRandom(options.seed);
  const shuffledOrders: number[][] = [];
  for (let orderIndex = 0; orderIndex < SHUFFLED_ORDER_COUNT; orderIndex++) {
    shuffledOrders.push(createShuffledIndices(rows.length, shuffleRandom));
  }

  const report: ChildReport = {};
  for (const lane of options.lanes) {
    const measurement = measureLane(
      baseImplementation,
      candidateImplementation,
      rows,
      lane === "fixed" ? [fixedOrder] : shuffledOrders,
      options.quadCount,
      options.blockReplayCount,
    );
    report[lane] = options.mirrorRoles ? invertMeasurement(measurement) : measurement;
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
};

const getMedian = (values: number[]): number => {
  const sortedValues = [...values].sort((left, right) => left - right);
  const middleIndex = sortedValues.length >> 1;
  return sortedValues.length % 2 === 0
    ? (sortedValues[middleIndex - 1]! + sortedValues[middleIndex]!) / 2
    : sortedValues[middleIndex]!;
};

const getSortedQuantile = (sortedValues: number[], quantile: number): number =>
  sortedValues[Math.min(sortedValues.length - 1, Math.floor(quantile * sortedValues.length))]!;

const getBootstrapMedianInterval = (samples: number[], random: SeededRandom): BootstrapInterval => {
  const resampleMedians = new Array<number>(BOOTSTRAP_RESAMPLE_COUNT);
  const resample = new Array<number>(samples.length);
  for (let resampleIndex = 0; resampleIndex < BOOTSTRAP_RESAMPLE_COUNT; resampleIndex++) {
    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
      resample[sampleIndex] = samples[Math.floor(random.getNext() * samples.length)]!;
    }
    resampleMedians[resampleIndex] = getMedian(resample);
  }
  resampleMedians.sort((left, right) => left - right);
  return {
    lower: getSortedQuantile(resampleMedians, BOOTSTRAP_LOWER_QUANTILE),
    upper: getSortedQuantile(resampleMedians, BOOTSTRAP_UPPER_QUANTILE),
  };
};

const getVerdict = (interval: BootstrapInterval, checksumsMatch: boolean): string => {
  if (!checksumsMatch) return "CHECKSUM MISMATCH";
  if (interval.upper < 1) return "win";
  if (interval.lower > 1) return "regression";
  return "tie";
};

const summarizeLane = (
  engine: string,
  lane: BenchmarkLane,
  measurements: LaneMeasurement[],
): LaneComparison => {
  // A fresh process is the sampling unit: the two loaded instances get
  // process-wide JIT/heap-layout luck (~±1-2%), so quads within a process are
  // correlated and pooling them would understate the CI.
  const processRatios: number[] = [];
  const baseNsPerCallSamples: number[] = [];
  const candidateNsPerCallSamples: number[] = [];
  let checksumsMatch = true;
  for (const measurement of measurements) {
    processRatios.push(getMedian(measurement.quadRatios));
    baseNsPerCallSamples.push(measurement.baseNsPerCall);
    candidateNsPerCallSamples.push(measurement.candidateNsPerCall);
    if (measurement.baseChecksum !== measurement.candidateChecksum) checksumsMatch = false;
  }
  const interval = getBootstrapMedianInterval(processRatios, createSeededRandom(BOOTSTRAP_SEED));
  return {
    engine,
    lane,
    processCount: measurements.length,
    quadCount: measurements.length * (measurements[0]?.quadRatios.length ?? 0),
    medianRatio: getMedian(processRatios),
    ciLower: interval.lower,
    ciUpper: interval.upper,
    mdePercent: ((interval.upper - interval.lower) / 2) * PERCENT_FACTOR,
    verdict: getVerdict(interval, checksumsMatch),
    baseNsPerCall: getMedian(baseNsPerCallSamples),
    candidateNsPerCall: getMedian(candidateNsPerCallSamples),
    checksumsMatch,
  };
};

const spawnChild = (
  engine: string,
  childBundlePath: string,
  childArguments: string[],
): ChildReport => {
  const spawned = spawnSync(engine, [childBundlePath, "--child", ...childArguments], {
    encoding: "utf8",
    maxBuffer: CHILD_OUTPUT_MAX_BUFFER_BYTES,
  });
  if (spawned.status !== 0) {
    throw new Error(
      `${engine} child exited with status ${spawned.status}:\n${spawned.stderr || spawned.stdout}`,
    );
  }
  const outputLines = spawned.stdout.trim().split("\n");
  return JSON.parse(outputLines[outputLines.length - 1]!) as ChildReport;
};

const formatRatio = (value: number): string => value.toFixed(4);
const formatNs = (value: number): string => value.toFixed(1);

const printComparisons = (comparisons: LaneComparison[]): void => {
  const header = [
    "engine".padEnd(7),
    "lane".padEnd(9),
    "procs".padEnd(6),
    "ratio(cand/base)".padEnd(17),
    "95% CI".padEnd(19),
    "MDE".padEnd(7),
    "verdict".padEnd(18),
    "base ns/call".padEnd(13),
    "cand ns/call",
  ].join(" ");
  console.log(header);
  for (const comparison of comparisons) {
    console.log(
      [
        comparison.engine.padEnd(7),
        comparison.lane.padEnd(9),
        String(comparison.processCount).padEnd(6),
        formatRatio(comparison.medianRatio).padEnd(17),
        `[${formatRatio(comparison.ciLower)}, ${formatRatio(comparison.ciUpper)}]`.padEnd(19),
        `${comparison.mdePercent.toFixed(2)}%`.padEnd(7),
        comparison.verdict.padEnd(18),
        formatNs(comparison.baseNsPerCall).padEnd(13),
        formatNs(comparison.candidateNsPerCall),
      ].join(" "),
    );
  }
};

const runParent = async (argv: string[]): Promise<void> => {
  const options = parseParentOptions(argv);
  const esbuild = await import("esbuild");
  const bundleDirectory = mkdtempSync(join(tmpdir(), "cnfast-ab-"));
  const baseBundlePath = join(bundleDirectory, "base.mjs");
  const candidateBundlePath = join(bundleDirectory, "cand.mjs");
  const childBundlePath = join(bundleDirectory, "ab-child.mjs");

  try {
    await esbuild.build({
      entryPoints: [options.baseModulePath],
      outfile: baseBundlePath,
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "silent",
    });
    await esbuild.build({
      entryPoints: [options.candidateModulePath],
      outfile: candidateBundlePath,
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "silent",
    });
    await esbuild.build({
      entryPoints: [fileURLToPath(import.meta.url)],
      outfile: childBundlePath,
      bundle: true,
      format: "esm",
      platform: "node",
      packages: "external",
      logLevel: "silent",
    });

    const comparisons: LaneComparison[] = [];
    for (const engine of options.engines) {
      const reports: ChildReport[] = [];
      for (let processIndex = 0; processIndex < options.processCount; processIndex++) {
        console.error(
          `[ab-compare] ${engine}: process ${processIndex + 1}/${options.processCount}`,
        );
        reports.push(
          spawnChild(engine, childBundlePath, [
            "--base-bundle",
            baseBundlePath,
            "--cand-bundle",
            candidateBundlePath,
            "--data",
            options.datasetPath,
            "--lanes",
            options.lanes.join(","),
            "--quads",
            String(options.quadCount),
            "--block-replays",
            String(options.blockReplayCount),
            "--seed",
            String(options.seed + processIndex),
            ...(processIndex % 2 === 1 ? ["--mirror"] : []),
          ]),
        );
      }
      for (const lane of options.lanes) {
        const laneMeasurements: LaneMeasurement[] = [];
        for (const report of reports) {
          const measurement = report[lane];
          if (measurement) laneMeasurements.push(measurement);
        }
        comparisons.push(summarizeLane(engine, lane, laneMeasurements));
      }
    }

    if (options.jsonOutput) {
      console.log(
        JSON.stringify(
          {
            base: options.baseModulePath,
            cand: options.candidateModulePath,
            processes: options.processCount,
            quadsPerProcess: options.quadCount,
            blockReplays: options.blockReplayCount,
            results: comparisons,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`base: ${options.baseModulePath}`);
      console.log(`cand: ${options.candidateModulePath}`);
      console.log(
        `${options.processCount} processes x ${options.quadCount} ABBA quads x ` +
          `${options.blockReplayCount} replays/block per engine\n`,
      );
      printComparisons(comparisons);
      console.log(
        "\nratio < 1 means the candidate is faster; a verdict is only win/regression " +
          "when the bootstrap 95% CI excludes 1.0.",
      );
    }

    for (const comparison of comparisons) {
      if (!comparison.checksumsMatch) process.exitCode = 1;
    }
  } finally {
    rmSync(bundleDirectory, { recursive: true, force: true });
  }
};

const argv = process.argv.slice(2);
if (argv.includes("--child")) {
  await runChild(argv);
} else {
  await runParent(argv);
}
