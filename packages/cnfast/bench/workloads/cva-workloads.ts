import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cva as referenceCva } from "class-variance-authority";
import { cn, cva } from "../../src/index.js";
import {
  type CvaDataRecord,
  type CvaCallRow,
  type CvaComponent,
  type CvaSiteDefinition,
} from "../cva/cva-benchmark-types";
import {
  referenceCn,
  type ClassListArgs,
  type ClassNameImplementation,
  type Workload,
  type WorkloadImplementationPair,
} from "../lib/harness";

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")) as T;

const buildInstances = (
  siteDefinitions: CvaSiteDefinition[],
  buildInstance: (base: never, config: never) => CvaComponent,
): CvaComponent[] =>
  siteDefinitions.map((definition) =>
    buildInstance(definition.base as never, (definition.config ?? undefined) as never),
  );

const createCvaImplementation = (cvaInstances: CvaComponent[]): ClassNameImplementation =>
  ((siteIndex: number, props?: CvaDataRecord) =>
    cvaInstances[siteIndex]!(props)) as unknown as ClassNameImplementation;

const createComposedImplementation = (
  cvaInstances: CvaComponent[],
  composeClassName: ClassNameImplementation,
): ClassNameImplementation =>
  ((siteIndex: number, props?: CvaDataRecord) =>
    composeClassName(cvaInstances[siteIndex]!(props))) as unknown as ClassNameImplementation;

const createReplayRun =
  (callRows: CvaCallRow[]): ((implementation: ClassNameImplementation) => number) =>
  (implementation) => {
    let resultLengthSum = 0;
    for (let index = 0; index < callRows.length; index++) {
      const callRow = callRows[index]!;
      resultLengthSum +=
        callRow.length === 2
          ? implementation(callRow[0], callRow[1]).length
          : implementation(callRow[0]).length;
    }
    return resultLengthSum;
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
      { class: "always-on" },
    ],
    defaultVariants: { m: 0, disabled: false, intent: "primary", size: "medium" },
  },
};

const compoundHeavyRows: CvaCallRow[] = [
  [0, {}],
  [0, { intent: "warning", size: "large", disabled: true }],
  [0, { intent: "danger", size: "medium" }],
  [0, { intent: "primary", m: 1 }],
  [0, { intent: "warning", disabled: false, className: "adhoc" }],
  [0, { intent: "danger", size: "small", disabled: true, m: 1 }],
];

export const getCvaWorkloads = (): Workload[] => {
  const datasetSiteDefinitions = readJson<CvaSiteDefinition[]>("../cva/cva-sites.json");
  const datasetCallRows = readJson<CvaCallRow[]>("../cva/cva-calls.json");
  const buildCnfast = (): CvaComponent[] =>
    buildInstances(datasetSiteDefinitions, cva as (base: never, config: never) => CvaComponent);
  const buildReference = (): CvaComponent[] =>
    buildInstances(
      datasetSiteDefinitions,
      referenceCva as (base: never, config: never) => CvaComponent,
    );

  const zeroArgRows = datasetSiteDefinitions.map((_, siteIndex): CvaCallRow => [siteIndex]);

  const replayImplementations: WorkloadImplementationPair = {
    cnfast: createCvaImplementation(buildCnfast()),
    reference: createCvaImplementation(buildReference()),
  };
  const zeroArgImplementations: WorkloadImplementationPair = {
    cnfast: createCvaImplementation(buildCnfast()),
    reference: createCvaImplementation(buildReference()),
  };
  const compoundImplementations: WorkloadImplementationPair = {
    cnfast: createCvaImplementation(
      buildInstances([compoundHeavySite], cva as (base: never, config: never) => CvaComponent),
    ),
    reference: createCvaImplementation(
      buildInstances(
        [compoundHeavySite],
        referenceCva as (base: never, config: never) => CvaComponent,
      ),
    ),
  };
  const composedImplementations: WorkloadImplementationPair = {
    cnfast: createComposedImplementation(buildCnfast(), cn),
    reference: createComposedImplementation(buildReference(), referenceCn),
  };

  return [
    {
      group: "cva",
      name: "cva / variant replay",
      meta: `(${datasetCallRows.length} calls, ${datasetSiteDefinitions.length} sites)`,
      classListCases: datasetCallRows as ClassListArgs[],
      implementations: replayImplementations,
      run: createReplayRun(datasetCallRows),
    },
    {
      group: "cva",
      name: "cva / all-defaults",
      meta: `(${zeroArgRows.length} zero-arg sites)`,
      classListCases: zeroArgRows as ClassListArgs[],
      implementations: zeroArgImplementations,
      run: createReplayRun(zeroArgRows),
    },
    {
      group: "cva",
      name: "cva / compound-heavy",
      meta: `(${compoundHeavyRows.length} calls, 9 compound entries)`,
      classListCases: compoundHeavyRows as ClassListArgs[],
      implementations: compoundImplementations,
      run: createReplayRun(compoundHeavyRows),
    },
    {
      group: "cva",
      name: "cva / composite cn(cva)",
      meta: `(${datasetCallRows.length} calls through cn)`,
      classListCases: datasetCallRows as ClassListArgs[],
      implementations: composedImplementations,
      run: createReplayRun(datasetCallRows),
    },
  ];
};
