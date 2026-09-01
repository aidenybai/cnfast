import { cva as referenceCva } from "class-variance-authority";
import { cva } from "../src/index.js";
import { CVA_FAST_MEMO_ROWS } from "../src/lib/constants.js";
import { createSeededRandom } from "../bench/utils/create-seeded-random";
import { createShuffledIndices } from "../bench/utils/create-shuffled-indices";

type AnyProps = Record<string, unknown>;

interface OracleSite {
  name: string;
  base: unknown;
  config: AnyProps | undefined;
  ported: (props?: AnyProps) => string;
  variantNames: string[];
  valueKeys: string[];
}

const ORACLE_SEED = 0xc4a_5eed;
const SCHEDULE_ROLL_COUNT = 4_000;
const SHUFFLED_PASS_COUNT = 2;
const MEMO_STORM_COMBO_COUNT = CVA_FAST_MEMO_ROWS * 3;
const MEMO_STORM_PASS_COUNT = 3;
const MUTATION_INTERLEAVE_COUNT = 400;
const MISMATCH_SAMPLE_LIMIT = 10;

const random = createSeededRandom(ORACLE_SEED);

const SITE_DEFINITIONS: { name: string; base: unknown; config: AnyProps | undefined }[] = [
  {
    name: "shadcn-button",
    base: "inline-flex items-center justify-center rounded-md text-sm font-medium",
    config: {
      variants: {
        variant: {
          default: "bg-primary text-primary-foreground hover:bg-primary/90",
          destructive: "bg-destructive text-destructive-foreground",
          outline: "border border-input bg-background hover:bg-accent",
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
  },
  {
    name: "compound-heavy",
    base: ["button", ["font-semibold", { border: true, rounded: true }]],
    config: {
      variants: {
        intent: {
          primary: "intent--primary",
          warning: "intent--warning",
          danger: ["intent--danger", ["bg-red-500", { baz: false, bat: null }]],
        },
        disabled: { true: "is-disabled", false: "is-enabled" },
        size: { small: "size--small", medium: "size--medium", large: "size--large" },
        m: { 0: "m-0", 1: "m-1" },
      },
      compoundVariants: [
        { intent: "primary", size: "medium", class: "primary-medium" },
        { intent: "warning", disabled: false, className: "warning-enabled" },
        { intent: ["warning", "danger"], class: "warning-danger" },
        { intent: ["warning", "danger"], size: "medium", className: "warning-danger-medium" },
        { class: "vacuous-class", className: "vacuous-classname" },
        { disabled: [true, Number.NaN], class: "disabled-or-nan" },
        { undeclaredKey: "ghost", class: "undeclared-hit" },
        { m: 0, class: "m-zero-compound" },
      ],
      defaultVariants: { m: 0, disabled: false, intent: "primary", size: "medium" },
    },
  },
  {
    name: "numeric-and-exotic-keys",
    base: "exotic",
    config: {
      variants: {
        0: { a: "zero-a", b: "zero-b" },
        12: { on: "twelve-on", off: "twelve-off" },
        tone: {
          "": "tone-empty",
          undefined: "tone-undefined-key",
          null: "tone-null-key",
          "-1": "tone-neg",
        },
        class: { primary: "class-variant-primary" },
      },
      defaultVariants: { tone: "" },
    },
  },
  { name: "no-config", base: "bare", config: undefined },
  {
    name: "empty-variants",
    base: "empty-variants-base",
    config: {
      variants: {},
      compoundVariants: [{ class: "vacuous-fires" }],
    },
  },
  {
    name: "wide-beyond-memo",
    base: "wide",
    config: {
      variants: Object.fromEntries(
        Array.from({ length: 18 }, (_, index) => [
          `variant${index}`,
          { on: `wide-${index}-on`, off: `wide-${index}-off` },
        ]),
      ),
      defaultVariants: { variant0: "on" },
    },
  },
];

const buildSites = (): OracleSite[] =>
  SITE_DEFINITIONS.map((definition) => {
    const variants = (definition.config?.variants ?? {}) as Record<string, AnyProps>;
    const variantNames = Object.keys(variants);
    const valueKeys: string[] = [];
    for (const variantName of variantNames) {
      for (const valueKey of Object.keys(variants[variantName]!)) {
        if (!valueKeys.includes(valueKey)) valueKeys.push(valueKey);
      }
    }
    if (valueKeys.length === 0) valueKeys.push("primary");
    return {
      ...definition,
      ported: cva(definition.base as never, definition.config as never) as (
        props?: AnyProps,
      ) => string,
      variantNames,
      valueKeys,
    };
  });

const sites = buildSites();

let totalCallCount = 0;
let mismatchCount = 0;

const verifyCall = (site: OracleSite, props: AnyProps | undefined): void => {
  totalCallCount++;
  const actualOutput = site.ported(props);
  const expectedOutput = (
    referenceCva(site.base as never, site.config as never) as (props?: AnyProps) => string
  )(props);
  if (actualOutput === expectedOutput) return;
  mismatchCount++;
  if (mismatchCount <= MISMATCH_SAMPLE_LIMIT) {
    console.error(
      `MISMATCH at call ${totalCallCount} site=${site.name}\n` +
        `  props:    ${JSON.stringify(props, (_key, value) => (value === undefined ? "«undefined»" : value))}\n` +
        `  expected: ${expectedOutput}\n` +
        `  actual:   ${actualOutput}`,
    );
  }
};

const rollPropValue = (valueKeys: string[]): unknown => {
  const roll = random.getNext();
  if (roll < 0.4) return valueKeys[Math.floor(random.getNext() * valueKeys.length)];
  if (roll < 0.48) return null;
  if (roll < 0.56) return undefined;
  if (roll < 0.62) return random.getNext() < 0.5;
  if (roll < 0.68) return 0;
  if (roll < 0.72) return "";
  if (roll < 0.76) return Number.NaN;
  if (roll < 0.84) return Math.floor(random.getNext() * 4) - 1;
  if (roll < 0.92) return "bogus";
  return "toString";
};

const rollScheduleProps = (site: OracleSite): AnyProps | undefined => {
  if (random.getNext() < 0.08) return undefined;
  const props: AnyProps = {};
  for (const variantName of site.variantNames) {
    if (random.getNext() < 0.4) continue;
    props[variantName] = rollPropValue(site.valueKeys);
  }
  if (random.getNext() < 0.1) props["undeclaredKey"] = rollPropValue(site.valueKeys);
  const classRoll = random.getNext();
  if (classRoll < 0.2) props.className = `adhoc-${Math.floor(random.getNext() * 12)}`;
  else if (classRoll < 0.3) props.class = `adhoc-class-${Math.floor(random.getNext() * 12)}`;
  else if (classRoll < 0.36) {
    props.class = "adhoc-class";
    props.className = "adhoc-classname";
  }
  return props;
};

const logPhase = (phaseName: string): void => {
  console.log(`[${totalCallCount} calls verified] ${phaseName}`);
};

interface ScheduledCall {
  siteIndex: number;
  props: AnyProps | undefined;
}

logPhase(
  `phase A: ordered replay of ${SCHEDULE_ROLL_COUNT} seeded rolls across ${sites.length} sites`,
);
const schedule: ScheduledCall[] = [];
for (let rollIndex = 0; rollIndex < SCHEDULE_ROLL_COUNT; rollIndex++) {
  const siteIndex = Math.floor(random.getNext() * sites.length);
  schedule.push({ siteIndex, props: rollScheduleProps(sites[siteIndex]!) });
}
for (const scheduledCall of schedule) {
  verifyCall(sites[scheduledCall.siteIndex]!, scheduledCall.props);
}

logPhase(`phase B: ${SHUFFLED_PASS_COUNT} shuffled replays of the same schedule`);
for (let passIndex = 0; passIndex < SHUFFLED_PASS_COUNT; passIndex++) {
  const order = createShuffledIndices(schedule.length, random);
  for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
    const scheduledCall = schedule[order[orderIndex]!]!;
    verifyCall(sites[scheduledCall.siteIndex]!, scheduledCall.props);
  }
}

logPhase(
  `phase C: memo storm, ${MEMO_STORM_COMBO_COUNT} live combos x${MEMO_STORM_PASS_COUNT} passes per site ` +
    `(forces ${CVA_FAST_MEMO_ROWS}-row eviction and round-robin wrap)`,
);
for (const site of sites) {
  const stormRolls: (AnyProps | undefined)[] = [];
  for (let comboIndex = 0; comboIndex < MEMO_STORM_COMBO_COUNT; comboIndex++) {
    const props = rollScheduleProps(site) ?? {};
    props.className = `storm-${comboIndex}`;
    stormRolls.push(props);
  }
  for (let passIndex = 0; passIndex < MEMO_STORM_PASS_COUNT; passIndex++) {
    for (const props of stormRolls) verifyCall(site, props);
    verifyCall(site, undefined);
    verifyCall(site, {});
  }
}

logPhase(
  `phase D: ${MUTATION_INTERLEAVE_COUNT} mutated-object class props interleaved with cached combos`,
);
for (let index = 0; index < MUTATION_INTERLEAVE_COUNT; index++) {
  const site = sites[index % sites.length]!;
  const toggles: Record<string, boolean> = { underline: index % 2 === 0 };
  const nested: unknown[] = [`px-${index % 6}`];
  const cachedProps = { className: "stable-adhoc" };
  verifyCall(site, cachedProps);
  verifyCall(site, { className: toggles });
  toggles.underline = !toggles.underline;
  verifyCall(site, { className: toggles });
  verifyCall(site, { class: nested });
  nested[0] = `px-${(index + 1) % 6}`;
  verifyCall(site, { class: nested });
  verifyCall(site, cachedProps);
}

logPhase("phase E: post-storm re-replay of the phase A schedule (stale-after-eviction check)");
for (const scheduledCall of schedule) {
  verifyCall(sites[scheduledCall.siteIndex]!, scheduledCall.props);
}

console.log(
  `\nVerified ${totalCallCount} sequential calls through ${sites.length} stateful cva instances ` +
    "against fresh class-variance-authority output.",
);
if (mismatchCount > 0) {
  console.error(
    `Mismatches: ${mismatchCount}` +
      (mismatchCount > MISMATCH_SAMPLE_LIMIT
        ? ` (first ${MISMATCH_SAMPLE_LIMIT} shown above)`
        : ""),
  );
  process.exit(1);
}
console.log("Every call was byte-identical: no stale or cross-wired memo rows.");
