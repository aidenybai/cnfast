import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cva as referenceCva } from "class-variance-authority";
import { cn, cva } from "../src/index.js";
import { CVA_MEMO_ROW_COUNT } from "../src/lib/constants.js";
import {
  type CvaCallRow,
  type CvaComponent,
  type CvaSiteDefinition,
} from "./cva/cva-benchmark-types";
import { createSeededRandom } from "./utils/create-seeded-random";
import { createShuffledIndices } from "./utils/create-shuffled-indices";

interface BoundCaller {
  (): string;
}

interface Scenario {
  name: string;
  siteDefinitions: CvaSiteDefinition[];
  callRows: CvaCallRow[];
  lanes: ("fixed" | "shuffled")[];
  shouldComposeWithCn?: boolean;
}

const REPLAY_SEED = 0xc4a_be4c;
const SHUFFLED_ORDER_COUNT = 8;
const WARMUP_ITERATIONS = 30;
const ITERATIONS_PER_SAMPLE = 40;
const SAMPLE_ATTEMPTS = 15;
const CREATION_INSTANCES_PER_SAMPLE = 20_000;

const siteDefinitionsPath = fileURLToPath(new URL("./cva/cva-sites.json", import.meta.url));
const callDatasetPath = fileURLToPath(new URL("./cva/cva-calls.json", import.meta.url));
const datasetSiteDefinitions: CvaSiteDefinition[] = JSON.parse(
  readFileSync(siteDefinitionsPath, "utf8"),
);
const datasetCallRows: CvaCallRow[] = JSON.parse(readFileSync(callDatasetPath, "utf8"));

const buildCnfastInstance = (definition: CvaSiteDefinition): CvaComponent =>
  cva(definition.base as never, (definition.config ?? undefined) as never) as CvaComponent;
const buildReferenceInstance = (definition: CvaSiteDefinition): CvaComponent =>
  referenceCva(definition.base as never, (definition.config ?? undefined) as never) as CvaComponent;

const shadcnButtonSite: CvaSiteDefinition = {
  base: "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none",
  config: {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
};

const compoundHeavySite: CvaSiteDefinition = {
  base: "button font-semibold border rounded",
  config: {
    variants: {
      intent: { primary: "intent--primary", warning: "intent--warning", danger: "intent--danger" },
      disabled: { true: "is-disabled opacity-50", false: "is-enabled cursor-pointer" },
      size: {
        small: "size--small text-sm",
        medium: "size--medium text-base",
        large: "size--large text-lg",
      },
      m: { 0: "m-0", 1: "m-1" },
    },
    compoundVariants: [
      { intent: "primary", size: "medium", class: "primary-medium uppercase" },
      { intent: "warning", disabled: false, class: "warning-enabled text-gray-800" },
      { intent: "warning", disabled: true, class: "warning-disabled text-black" },
      { intent: ["warning", "danger"], class: "warning-danger !border-red-500" },
      { intent: ["warning", "danger"], size: "medium", class: "warning-danger-medium" },
      { disabled: true, size: "small", className: "disabled-small" },
      { intent: "primary", m: 1, className: "primary-m1" },
      { intent: "danger", disabled: false, size: "large", class: "danger-enabled-large" },
      { m: 0, size: "medium", class: "m0-medium" },
      { intent: "primary", disabled: false, className: "primary-enabled" },
      { class: "always-on" },
      { intent: "danger", size: ["small", "large"], class: "danger-extreme" },
    ],
    defaultVariants: { m: 0, disabled: false, intent: "primary", size: "medium" },
  },
};

const buildRepeatedRows = (rows: CvaCallRow[], repeatCount: number): CvaCallRow[] => {
  const repeated: CvaCallRow[] = [];
  for (let repeat = 0; repeat < repeatCount; repeat++) {
    for (const row of rows) repeated.push(row);
  }
  return repeated;
};

const shadcnSteadyStateRows: CvaCallRow[] = buildRepeatedRows(
  [
    [0, { variant: "default", size: "default" }],
    [0, { variant: "outline", size: "sm", className: "ml-2" }],
    [0, { variant: "destructive", size: "default" }],
    [0, { variant: "ghost", size: "lg", className: "w-full" }],
    [0, {}],
    [0, { variant: "outline", size: "sm", className: "ml-2" }],
  ],
  40,
);

const allDefaultRows: CvaCallRow[] = buildRepeatedRows(
  datasetSiteDefinitions.map((_, siteIndex): CvaCallRow => [siteIndex]),
  5,
);

const memoMissChurnRows: CvaCallRow[] = (() => {
  const comboRows: CvaCallRow[] = [];
  const variants = ["default", "destructive", "outline", "ghost"];
  const sizes = ["default", "sm", "lg"];
  let comboIndex = 0;
  for (const variant of variants) {
    for (const size of sizes) {
      comboRows.push([0, { variant, size, className: `churn-${comboIndex++}` }]);
      comboRows.push([0, { variant, size }]);
    }
  }
  if (comboRows.length <= CVA_MEMO_ROW_COUNT) throw new Error("churn working set fits the memo");
  return buildRepeatedRows(comboRows, 10);
})();

const compoundHeavyRows: CvaCallRow[] = buildRepeatedRows(
  [
    [0, {}],
    [0, { intent: "warning", size: "large", disabled: true }],
    [0, { intent: "danger", size: "medium" }],
    [0, { intent: "primary", m: 1 }],
    [0, { intent: "warning", disabled: false, className: "adhoc" }],
    [0, { intent: "danger", size: "small", disabled: true, m: 1 }],
  ],
  40,
);

const uncacheableRows: CvaCallRow[] = (() => {
  const rows: CvaCallRow[] = [];
  for (let index = 0; index < 240; index++) {
    rows.push([
      0,
      {
        variant: "outline",
        size: "sm",
        className: { [`dynamic-${index % 7}`]: true, hidden: index % 2 === 0 },
      },
    ]);
  }
  return rows;
})();

const scenarios: Scenario[] = [
  {
    name: "realistic mix (48 sites)",
    siteDefinitions: datasetSiteDefinitions,
    callRows: datasetCallRows,
    lanes: ["fixed", "shuffled"],
  },
  {
    name: "all-defaults / zero-arg",
    siteDefinitions: datasetSiteDefinitions,
    callRows: allDefaultRows,
    lanes: ["fixed"],
  },
  {
    name: "shadcn steady-state",
    siteDefinitions: [shadcnButtonSite],
    callRows: shadcnSteadyStateRows,
    lanes: ["fixed"],
  },
  {
    name: "memo-miss churn",
    siteDefinitions: [shadcnButtonSite],
    callRows: memoMissChurnRows,
    lanes: ["fixed", "shuffled"],
  },
  {
    name: "compound-heavy",
    siteDefinitions: [compoundHeavySite],
    callRows: compoundHeavyRows,
    lanes: ["fixed"],
  },
  {
    name: "uncacheable object className",
    siteDefinitions: [shadcnButtonSite],
    callRows: uncacheableRows,
    lanes: ["fixed"],
  },
  {
    name: "composite cn(cva(props))",
    siteDefinitions: datasetSiteDefinitions,
    callRows: datasetCallRows,
    lanes: ["fixed"],
    shouldComposeWithCn: true,
  },
];

const createBoundCallers = (
  cvaInstances: CvaComponent[],
  callRows: CvaCallRow[],
  shouldComposeWithCn: boolean,
): BoundCaller[] =>
  callRows.map((callRow) => {
    const cvaInstance = cvaInstances[callRow[0]]!;
    const props = callRow.length === 2 ? callRow[1] : undefined;
    if (shouldComposeWithCn) {
      return props === undefined ? () => cn(cvaInstance()) : () => cn(cvaInstance(props));
    }
    return props === undefined ? () => cvaInstance() : () => cvaInstance(props);
  });

const verifyScenarioParity = (scenario: Scenario): void => {
  const cnfastInstances = scenario.siteDefinitions.map(buildCnfastInstance);
  const referenceInstances = scenario.siteDefinitions.map(buildReferenceInstance);
  for (let pass = 0; pass < 3; pass++) {
    for (let callIndex = 0; callIndex < scenario.callRows.length; callIndex++) {
      const callRow = scenario.callRows[callIndex]!;
      const props = callRow.length === 2 ? callRow[1] : undefined;
      const cnfastResult = cnfastInstances[callRow[0]]!(props);
      const referenceResult = referenceInstances[callRow[0]]!(props);
      if (cnfastResult !== referenceResult) {
        throw new Error(
          `parity mismatch in "${scenario.name}" at call ${callIndex} pass ${pass}:\n` +
            ` cnfast:    ${cnfastResult}\n reference: ${referenceResult}`,
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
  let bestNanosecondsPerCall = Infinity;
  for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt++) {
    const startedAt = process.hrtime.bigint();
    for (let iteration = 0; iteration < ITERATIONS_PER_SAMPLE; iteration++)
      runIteration(orders[iteration % orders.length]!);
    const elapsedNanoseconds = Number(process.hrtime.bigint() - startedAt);
    const nanosecondsPerCall = elapsedNanoseconds / (ITERATIONS_PER_SAMPLE * callCount);
    if (nanosecondsPerCall < bestNanosecondsPerCall) bestNanosecondsPerCall = nanosecondsPerCall;
  }
  return bestNanosecondsPerCall;
};

const buildOrders = (lane: "fixed" | "shuffled", rowCount: number): number[][] => {
  const identityOrder: number[] = [];
  for (let index = 0; index < rowCount; index++) identityOrder.push(index);
  if (lane === "fixed") return [identityOrder];
  const random = createSeededRandom(REPLAY_SEED);
  const orders: number[][] = [];
  for (let orderIndex = 0; orderIndex < SHUFFLED_ORDER_COUNT; orderIndex++)
    orders.push(createShuffledIndices(rowCount, random));
  return orders;
};

const timeCreation = (): void => {
  const siteDefinitions = datasetSiteDefinitions;
  const runCreation = (build: (definition: CvaSiteDefinition) => CvaComponent): number => {
    let bestNanosecondsPerCreation = Infinity;
    for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt++) {
      const startedAt = process.hrtime.bigint();
      for (let index = 0; index < CREATION_INSTANCES_PER_SAMPLE; index++) {
        const cvaInstance = build(siteDefinitions[index % siteDefinitions.length]!);
        resultLengthSink += cvaInstance.length;
      }
      const elapsedNanoseconds = Number(process.hrtime.bigint() - startedAt);
      const nanosecondsPerCreation = elapsedNanoseconds / CREATION_INSTANCES_PER_SAMPLE;
      if (nanosecondsPerCreation < bestNanosecondsPerCreation) {
        bestNanosecondsPerCreation = nanosecondsPerCreation;
      }
    }
    return bestNanosecondsPerCreation;
  };
  const cnfastNanoseconds = runCreation(buildCnfastInstance);
  const referenceNanoseconds = runCreation(buildReferenceInstance);
  console.log(
    `creation${" ".repeat(24)} fixed     cnfast ${cnfastNanoseconds.toFixed(1).padStart(7)} ns/create | ` +
      `reference ${referenceNanoseconds.toFixed(1).padStart(7)} ns/create | ` +
      `${(referenceNanoseconds / cnfastNanoseconds).toFixed(2)}x`,
  );
};

for (const scenario of scenarios) verifyScenarioParity(scenario);
console.log(
  `cva replay: ${scenarios.length} scenarios (3-pass parity verified per call vs class-variance-authority@0.7.1)\n`,
);

timeCreation();

for (const scenario of scenarios) {
  const cnfastCallers = createBoundCallers(
    scenario.siteDefinitions.map(buildCnfastInstance),
    scenario.callRows,
    scenario.shouldComposeWithCn === true,
  );
  const referenceCallers = createBoundCallers(
    scenario.siteDefinitions.map(buildReferenceInstance),
    scenario.callRows,
    scenario.shouldComposeWithCn === true,
  );
  for (const lane of scenario.lanes) {
    const orders = buildOrders(lane, scenario.callRows.length);
    const cnfastNanosecondsPerCall = timeReplay(cnfastCallers, orders);
    const referenceNanosecondsPerCall = timeReplay(referenceCallers, orders);
    console.log(
      `${scenario.name.padEnd(32)} ${lane.padEnd(9)} ` +
        `cnfast ${cnfastNanosecondsPerCall.toFixed(1).padStart(7)} ns/call | ` +
        `reference ${referenceNanosecondsPerCall.toFixed(1).padStart(7)} ns/call | ` +
        `${(referenceNanosecondsPerCall / cnfastNanosecondsPerCall).toFixed(2)}x`,
    );
  }
}

if (resultLengthSink === -1) throw new Error("unreachable");
