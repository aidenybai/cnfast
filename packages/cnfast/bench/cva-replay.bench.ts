import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cva as referenceCva } from "class-variance-authority";
import { cn, cva } from "../src/index.js";
import { CVA_MEMO_ROWS } from "../src/lib/constants.js";
import { createSeededRandom } from "./utils/create-seeded-random";
import { createShuffledIndices } from "./utils/create-shuffled-indices";

type AnyProps = Record<string, unknown>;
type CvaCallRow = [number] | [number, AnyProps];

interface CvaSiteDefinition {
  base: unknown;
  config: AnyProps | null;
}

interface CvaComponent {
  (props?: AnyProps): string;
}

interface BoundCaller {
  (): string;
}

interface Scenario {
  name: string;
  siteDefinitions: CvaSiteDefinition[];
  callRows: CvaCallRow[];
  lanes: ("fixed" | "shuffled")[];
  composeWithCn?: boolean;
}

const REPLAY_SEED = 0xc4a_be4c;
const SHUFFLED_ORDER_COUNT = 8;
const WARMUP_ITERATIONS = 30;
const ITERATIONS_PER_SAMPLE = 40;
const SAMPLE_ATTEMPTS = 15;
const CREATION_INSTANCES_PER_SAMPLE = 20_000;

const sitesPath = fileURLToPath(new URL("./cva/cva-sites.json", import.meta.url));
const callsPath = fileURLToPath(new URL("./cva/cva-calls.json", import.meta.url));
const datasetSites: CvaSiteDefinition[] = JSON.parse(readFileSync(sitesPath, "utf8"));
const datasetCallRows: CvaCallRow[] = JSON.parse(readFileSync(callsPath, "utf8"));

const buildPortedInstance = (definition: CvaSiteDefinition): CvaComponent =>
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
  datasetSites.map((_, siteIndex): CvaCallRow => [siteIndex]),
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
  if (comboRows.length <= CVA_MEMO_ROWS) throw new Error("churn working set fits the memo");
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
    siteDefinitions: datasetSites,
    callRows: datasetCallRows,
    lanes: ["fixed", "shuffled"],
  },
  {
    name: "all-defaults / zero-arg",
    siteDefinitions: datasetSites,
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
    siteDefinitions: datasetSites,
    callRows: datasetCallRows,
    lanes: ["fixed"],
    composeWithCn: true,
  },
];

const createBoundCallers = (
  instances: CvaComponent[],
  callRows: CvaCallRow[],
  composeWithCn: boolean,
): BoundCaller[] =>
  callRows.map((row) => {
    const instance = instances[row[0]]!;
    const props = row.length === 2 ? row[1] : undefined;
    if (composeWithCn) {
      return props === undefined ? () => cn(instance()) : () => cn(instance(props));
    }
    return props === undefined ? () => instance() : () => instance(props);
  });

const verifyScenarioParity = (scenario: Scenario): void => {
  const portedInstances = scenario.siteDefinitions.map(buildPortedInstance);
  const referenceInstances = scenario.siteDefinitions.map(buildReferenceInstance);
  for (let pass = 0; pass < 3; pass++) {
    for (let callIndex = 0; callIndex < scenario.callRows.length; callIndex++) {
      const row = scenario.callRows[callIndex]!;
      const props = row.length === 2 ? row[1] : undefined;
      const ported = portedInstances[row[0]]!(props);
      const reference = referenceInstances[row[0]]!(props);
      if (ported !== reference) {
        throw new Error(
          `parity mismatch in "${scenario.name}" at call ${callIndex} pass ${pass}:\n` +
            ` ported:    ${ported}\n reference: ${reference}`,
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
  const definitions = datasetSites;
  const runCreation = (build: (definition: CvaSiteDefinition) => CvaComponent): number => {
    let bestNsPerCreation = Infinity;
    for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt++) {
      const startedAt = process.hrtime.bigint();
      for (let index = 0; index < CREATION_INSTANCES_PER_SAMPLE; index++) {
        const instance = build(definitions[index % definitions.length]!);
        resultLengthSink += instance.length;
      }
      const elapsedNs = Number(process.hrtime.bigint() - startedAt);
      const nsPerCreation = elapsedNs / CREATION_INSTANCES_PER_SAMPLE;
      if (nsPerCreation < bestNsPerCreation) bestNsPerCreation = nsPerCreation;
    }
    return bestNsPerCreation;
  };
  const portedNs = runCreation(buildPortedInstance);
  const referenceNs = runCreation(buildReferenceInstance);
  console.log(
    `creation${" ".repeat(24)} fixed     ported ${portedNs.toFixed(1).padStart(7)} ns/create | ` +
      `reference ${referenceNs.toFixed(1).padStart(7)} ns/create | ${(referenceNs / portedNs).toFixed(2)}x`,
  );
};

for (const scenario of scenarios) verifyScenarioParity(scenario);
console.log(
  `cva replay: ${scenarios.length} scenarios (3-pass parity verified per call vs class-variance-authority@0.7.1)\n`,
);

timeCreation();

for (const scenario of scenarios) {
  const portedCallers = createBoundCallers(
    scenario.siteDefinitions.map(buildPortedInstance),
    scenario.callRows,
    scenario.composeWithCn === true,
  );
  const referenceCallers = createBoundCallers(
    scenario.siteDefinitions.map(buildReferenceInstance),
    scenario.callRows,
    scenario.composeWithCn === true,
  );
  for (const lane of scenario.lanes) {
    const orders = buildOrders(lane, scenario.callRows.length);
    const portedNsPerCall = timeReplay(portedCallers, orders);
    const referenceNsPerCall = timeReplay(referenceCallers, orders);
    console.log(
      `${scenario.name.padEnd(32)} ${lane.padEnd(9)} ` +
        `ported ${portedNsPerCall.toFixed(1).padStart(7)} ns/call | ` +
        `reference ${referenceNsPerCall.toFixed(1).padStart(7)} ns/call | ` +
        `${(referenceNsPerCall / portedNsPerCall).toFixed(2)}x`,
    );
  }
}

if (resultLengthSink === -1) throw new Error("unreachable");
