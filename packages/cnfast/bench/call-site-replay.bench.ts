import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { type ClassNameFunction, type ClassValue, cn, createCallSiteCn } from "../src/index.js";
import { createSeededRandom } from "./utils/create-seeded-random";
import { createShuffledIndices } from "./utils/create-shuffled-indices";

const REPLAY_SEED = 0x5eed_c11e;
const SHUFFLED_ORDER_COUNT = 8;
const WARMUP_ITERATIONS = 30;
const ITERATIONS_PER_SAMPLE = 40;
const SAMPLE_ATTEMPTS = 15;

const benchmarkDataPath = fileURLToPath(
  new URL("../tests/tailwind-merge/tw-merge-benchmark-data.json", import.meta.url),
);
const benchmarkCallRows: ClassValue[][] = JSON.parse(readFileSync(benchmarkDataPath, "utf8"));

const referenceCn: ClassNameFunction = (...classValues) => twMerge(clsx(classValues));

interface CallSiteModel {
  callSiteIndices: number[];
  label: string;
  maximumShapesPerCallSite: number;
  polymorphicCallSiteCount: number;
  callSiteCount: number;
}

interface CallSiteSignatureGetter {
  (callRow: ClassValue[]): string;
}

const createCallSiteModel = (
  label: string,
  getCallSiteSignature: CallSiteSignatureGetter,
): CallSiteModel => {
  const callSiteIndexBySignature = new Map<string, number>();
  const uniqueCallKeysByCallSite: Set<string>[] = [];
  const callSiteIndices: number[] = [];
  for (const callRow of benchmarkCallRows) {
    const callSiteSignature = getCallSiteSignature(callRow);
    const callKey = JSON.stringify(callRow);
    let callSiteIndex = callSiteIndexBySignature.get(callSiteSignature);
    if (callSiteIndex === undefined) {
      callSiteIndex = callSiteIndexBySignature.size;
      callSiteIndexBySignature.set(callSiteSignature, callSiteIndex);
      uniqueCallKeysByCallSite.push(new Set());
    }
    uniqueCallKeysByCallSite[callSiteIndex]!.add(callKey);
    callSiteIndices.push(callSiteIndex);
  }
  let polymorphicCallSiteCount = 0;
  let maximumShapesPerCallSite = 0;
  for (const uniqueCallKeys of uniqueCallKeysByCallSite) {
    if (uniqueCallKeys.size > 1) polymorphicCallSiteCount++;
    if (uniqueCallKeys.size > maximumShapesPerCallSite) {
      maximumShapesPerCallSite = uniqueCallKeys.size;
    }
  }
  return {
    callSiteIndices,
    label,
    maximumShapesPerCallSite,
    polymorphicCallSiteCount,
    callSiteCount: callSiteIndexBySignature.size,
  };
};

const callSiteModels = [
  createCallSiteModel("monomorphic upper bound", (callRow) => JSON.stringify(callRow)),
  // The capture lacks source locations, so arity plus the first static class
  // provides a conservative proxy for polymorphic component call sites.
  createCallSiteModel("component-variant proxy", (callRow) =>
    JSON.stringify([callRow.length, callRow[0]]),
  ),
];

interface BoundCaller {
  (): string;
}

// Arity specialization avoids adding spread-dispatch overhead to every implementation.
const createBoundCaller = (
  implementation: ClassNameFunction,
  callRow: ClassValue[],
): BoundCaller => {
  switch (callRow.length) {
    case 2:
      return () => implementation(callRow[0], callRow[1]);
    case 3:
      return () => implementation(callRow[0], callRow[1], callRow[2]);
    case 4:
      return () => implementation(callRow[0], callRow[1], callRow[2], callRow[3]);
    case 5:
      return () => implementation(callRow[0], callRow[1], callRow[2], callRow[3], callRow[4]);
    case 6:
      return () =>
        implementation(callRow[0], callRow[1], callRow[2], callRow[3], callRow[4], callRow[5]);
    case 9:
      return () =>
        implementation(
          callRow[0],
          callRow[1],
          callRow[2],
          callRow[3],
          callRow[4],
          callRow[5],
          callRow[6],
          callRow[7],
          callRow[8],
        );
    case 10:
      return () =>
        implementation(
          callRow[0],
          callRow[1],
          callRow[2],
          callRow[3],
          callRow[4],
          callRow[5],
          callRow[6],
          callRow[7],
          callRow[8],
          callRow[9],
        );
    default:
      return () => implementation(...callRow);
  }
};

const createBoundCallers = (
  getImplementationForCallSite: (callSiteIndex: number) => ClassNameFunction,
  callSiteIndices: number[],
) =>
  benchmarkCallRows.map((callRow, callIndex) =>
    createBoundCaller(getImplementationForCallSite(callSiteIndices[callIndex]!), callRow),
  );

const createCallSiteFunctionGetter = (
  callSiteCount: number,
): ((callSiteIndex: number) => ClassNameFunction) => {
  const callSiteFunctions: ClassNameFunction[] = [];
  for (let callSiteIndex = 0; callSiteIndex < callSiteCount; callSiteIndex++) {
    callSiteFunctions.push(createCallSiteCn());
  }
  return (callSiteIndex) => callSiteFunctions[callSiteIndex]!;
};

const verifyParity = (callSiteModel: CallSiteModel): void => {
  const getMemoizedImplementationForCallSite = createCallSiteFunctionGetter(
    callSiteModel.callSiteCount,
  );
  for (let passIndex = 0; passIndex < 3; passIndex++) {
    for (let callIndex = 0; callIndex < benchmarkCallRows.length; callIndex++) {
      const callRow = benchmarkCallRows[callIndex]!;
      const callSiteResult = getMemoizedImplementationForCallSite(
        callSiteModel.callSiteIndices[callIndex]!,
      )(...callRow);
      const directResult = cn(...callRow);
      const referenceResult = referenceCn(...callRow);
      if (callSiteResult !== directResult || callSiteResult !== referenceResult) {
        throw new Error(
          `parity mismatch at call ${callIndex} pass ${passIndex}:\n ` +
            `call site: ${callSiteResult}\n cn: ${directResult}\n reference: ${referenceResult}`,
        );
      }
    }
  }
};

let resultLengthSink = 0;

const timeReplay = (callers: BoundCaller[], replayOrders: number[][]): number => {
  const callCount = callers.length;
  const runIteration = (replayOrder: number[]): void => {
    for (let index = 0; index < callCount; index++)
      resultLengthSink += callers[replayOrder[index]!]!().length;
  };
  for (let warmup = 0; warmup < WARMUP_ITERATIONS; warmup++)
    runIteration(replayOrders[warmup % replayOrders.length]!);
  let bestNanosecondsPerCall = Infinity;
  for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt++) {
    const startedAt = process.hrtime.bigint();
    for (let iteration = 0; iteration < ITERATIONS_PER_SAMPLE; iteration++)
      runIteration(replayOrders[iteration % replayOrders.length]!);
    const elapsedNanoseconds = Number(process.hrtime.bigint() - startedAt);
    const nanosecondsPerCall = elapsedNanoseconds / (ITERATIONS_PER_SAMPLE * callCount);
    if (nanosecondsPerCall < bestNanosecondsPerCall) {
      bestNanosecondsPerCall = nanosecondsPerCall;
    }
  }
  return bestNanosecondsPerCall;
};

const createReplayOrders = (lane: "fixed" | "shuffled"): number[][] => {
  const identityOrder = benchmarkCallRows.map((_, callIndex) => callIndex);
  if (lane === "fixed") return [identityOrder];
  const random = createSeededRandom(REPLAY_SEED);
  const replayOrders: number[][] = [];
  for (let orderIndex = 0; orderIndex < SHUFFLED_ORDER_COUNT; orderIndex++) {
    replayOrders.push(createShuffledIndices(benchmarkCallRows.length, random));
  }
  return replayOrders;
};

for (const callSiteModel of callSiteModels) {
  verifyParity(callSiteModel);
  console.log(
    `\n${callSiteModel.label}: ${benchmarkCallRows.length} calls across ${callSiteModel.callSiteCount} ` +
      `modeled sites, ${callSiteModel.polymorphicCallSiteCount} polymorphic, up to ` +
      `${callSiteModel.maximumShapesPerCallSite} shapes/site (parity verified per call)`,
  );
  for (const lane of ["fixed", "shuffled"] as const) {
    const replayOrders = createReplayOrders(lane);
    const directNanosecondsPerCall = timeReplay(
      createBoundCallers(() => cn, callSiteModel.callSiteIndices),
      replayOrders,
    );
    const callSiteNanosecondsPerCall = timeReplay(
      createBoundCallers(
        createCallSiteFunctionGetter(callSiteModel.callSiteCount),
        callSiteModel.callSiteIndices,
      ),
      replayOrders,
    );
    const referenceNanosecondsPerCall = timeReplay(
      createBoundCallers(() => referenceCn, callSiteModel.callSiteIndices),
      replayOrders,
    );
    console.log(
      `${lane.padEnd(9)} cn ${directNanosecondsPerCall.toFixed(1).padStart(6)} ns/call | ` +
        `createCallSiteCn ${callSiteNanosecondsPerCall.toFixed(1).padStart(6)} ns/call ` +
        `(${(directNanosecondsPerCall / callSiteNanosecondsPerCall).toFixed(2)}x vs cn) | ` +
        `reference ${referenceNanosecondsPerCall.toFixed(1).padStart(6)} ns/call`,
    );
  }
}

if (resultLengthSink === -1) throw new Error("unreachable");
