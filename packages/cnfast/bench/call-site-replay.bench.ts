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
const callRows: ClassValue[][] = JSON.parse(readFileSync(benchmarkDataPath, "utf8"));

const referenceCn: ClassNameFunction = (...classValues) => twMerge(clsx(classValues));

const siteIdsByRowKey = new Map<string, number>();
const callSiteIds: number[] = [];
for (const callRow of callRows) {
  const rowKey = JSON.stringify(callRow);
  let siteId = siteIdsByRowKey.get(rowKey);
  if (siteId === undefined) {
    siteId = siteIdsByRowKey.size;
    siteIdsByRowKey.set(rowKey, siteId);
  }
  callSiteIds.push(siteId);
}
const siteCount = siteIdsByRowKey.size;

interface BoundCaller {
  (): string;
}

// Real call sites pass a fixed argument list directly, so the callers are
// arity-specialized: a shared spread caller would tax every implementation
// with the same dispatch overhead and dilute the measured ratio.
const createBoundCaller = (implementation: ClassNameFunction, row: ClassValue[]): BoundCaller => {
  switch (row.length) {
    case 2:
      return () => implementation(row[0], row[1]);
    case 3:
      return () => implementation(row[0], row[1], row[2]);
    case 4:
      return () => implementation(row[0], row[1], row[2], row[3]);
    case 5:
      return () => implementation(row[0], row[1], row[2], row[3], row[4]);
    case 6:
      return () => implementation(row[0], row[1], row[2], row[3], row[4], row[5]);
    case 9:
      return () =>
        implementation(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8]);
    case 10:
      return () =>
        implementation(
          row[0],
          row[1],
          row[2],
          row[3],
          row[4],
          row[5],
          row[6],
          row[7],
          row[8],
          row[9],
        );
    default:
      return () => implementation(...row);
  }
};

const createBoundCallers = (implementationForSite: (siteId: number) => ClassNameFunction) =>
  callRows.map((callRow, callIndex) =>
    createBoundCaller(implementationForSite(callSiteIds[callIndex]!), callRow),
  );

const createCallSiteImplementations = (): ((siteId: number) => ClassNameFunction) => {
  const sites: ClassNameFunction[] = [];
  for (let siteId = 0; siteId < siteCount; siteId++) sites.push(createCallSiteCn());
  return (siteId) => sites[siteId]!;
};

const verifyParity = (): void => {
  const memoForSite = createCallSiteImplementations();
  for (let pass = 0; pass < 3; pass++) {
    for (let callIndex = 0; callIndex < callRows.length; callIndex++) {
      const callRow = callRows[callIndex]!;
      const memoized = memoForSite(callSiteIds[callIndex]!)(...callRow);
      const direct = cn(...callRow);
      const reference = referenceCn(...callRow);
      if (memoized !== direct || memoized !== reference) {
        throw new Error(
          `parity mismatch at call ${callIndex} pass ${pass}:\n memo: ${memoized}\n cn: ${direct}\n reference: ${reference}`,
        );
      }
    }
  }
};

let resultLengthSink = 0;

const timeReplay = (callers: BoundCaller[], orders: number[][]): number => {
  const callCount = callers.length;
  const runIteration = (order: number[]): void => {
    for (let index = 0; index < callCount; index++)
      resultLengthSink += callers[order[index]!]!().length;
  };
  for (let warmup = 0; warmup < WARMUP_ITERATIONS; warmup++)
    runIteration(orders[warmup % orders.length]!);
  let bestNsPerCall = Infinity;
  for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt++) {
    const startedAt = process.hrtime.bigint();
    for (let iteration = 0; iteration < ITERATIONS_PER_SAMPLE; iteration++)
      runIteration(orders[iteration % orders.length]!);
    const elapsedNs = Number(process.hrtime.bigint() - startedAt);
    const nsPerCall = elapsedNs / (ITERATIONS_PER_SAMPLE * callCount);
    if (nsPerCall < bestNsPerCall) bestNsPerCall = nsPerCall;
  }
  return bestNsPerCall;
};

const buildOrders = (lane: "fixed" | "shuffled"): number[][] => {
  const identityOrder = callRows.map((_, callIndex) => callIndex);
  if (lane === "fixed") return [identityOrder];
  const random = createSeededRandom(REPLAY_SEED);
  const orders: number[][] = [];
  for (let orderIndex = 0; orderIndex < SHUFFLED_ORDER_COUNT; orderIndex++)
    orders.push(createShuffledIndices(callRows.length, random));
  return orders;
};

verifyParity();
console.log(
  `call-site replay: ${callRows.length} calls across ${siteCount} modeled sites (parity verified per call)`,
);

for (const lane of ["fixed", "shuffled"] as const) {
  const orders = buildOrders(lane);
  const plainNsPerCall = timeReplay(
    createBoundCallers(() => cn),
    orders,
  );
  const memoNsPerCall = timeReplay(createBoundCallers(createCallSiteImplementations()), orders);
  const referenceNsPerCall = timeReplay(
    createBoundCallers(() => referenceCn),
    orders,
  );
  console.log(
    `${lane.padEnd(9)} cn ${plainNsPerCall.toFixed(1).padStart(6)} ns/call | ` +
      `createCallSiteCn ${memoNsPerCall.toFixed(1).padStart(6)} ns/call (${(plainNsPerCall / memoNsPerCall).toFixed(2)}x vs cn) | ` +
      `reference ${referenceNsPerCall.toFixed(1).padStart(6)} ns/call`,
  );
}

if (resultLengthSink === -1) throw new Error("unreachable");
