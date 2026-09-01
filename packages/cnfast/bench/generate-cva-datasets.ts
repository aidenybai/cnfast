import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadCorpora } from "../scripts/lib/load-corpus";
import { createSeededRandom, type SeededRandom } from "./utils/create-seeded-random";
import {
  CVA_DATASET_SEED,
  CVA_DATASET_SITE_COUNT,
  CVA_DATASET_FRAME_COUNT,
  CVA_DATASET_TOKEN_POOL_SIZE,
} from "./constants";

type AnyProps = Record<string, unknown>;

export interface CvaSiteDefinition {
  base: unknown;
  config: AnyProps | null;
}

export type CvaCallRow = [number] | [number, AnyProps];

const random = createSeededRandom(CVA_DATASET_SEED);

const tokenPool: string[] = [];
for (const corpus of loadCorpora(["shadcn-ui"])) {
  for (const classGroup of corpus.groups) {
    for (const value of classGroup) {
      if (typeof value === "string" && value.trim() !== "" && !tokenPool.includes(value)) {
        tokenPool.push(value.trim());
      }
      if (tokenPool.length >= CVA_DATASET_TOKEN_POOL_SIZE) break;
    }
    if (tokenPool.length >= CVA_DATASET_TOKEN_POOL_SIZE) break;
  }
}

const pickToken = (localRandom: SeededRandom): string =>
  tokenPool[Math.floor(localRandom.getNext() * tokenPool.length)]!;

const VARIANT_NAME_POOL = ["variant", "size", "color", "orientation", "align", "side", "tone"];
const BOOLEAN_VARIANT_NAME_POOL = ["disabled", "loading", "fullWidth", "selected", "active"];
const VALUE_KEY_POOL = [
  "default",
  "primary",
  "secondary",
  "outline",
  "ghost",
  "sm",
  "md",
  "lg",
  "destructive",
];

// Shapes follow the 58-repo corpus distribution: 58% one variant key, 27% two,
// ~8% three-plus, 7% none; 95% of configs have no compoundVariants; boolean
// variants and 0-2 defaults are common.
const generateSite = (siteIndex: number): CvaSiteDefinition => {
  const base = random.getNext() < 0.9 ? pickToken(random) : [pickToken(random), pickToken(random)];
  const shapeRoll = random.getNext();
  if (shapeRoll < 0.07) return { base, config: null };

  const variants: AnyProps = {};
  const variantCountRoll = random.getNext();
  const variantCount = variantCountRoll < 0.58 ? 1 : variantCountRoll < 0.85 ? 2 : 3;
  const variantNames: string[] = [];
  for (let index = 0; index < variantCount; index++) {
    const useBooleanVariant = random.getNext() < 0.25;
    const namePool = useBooleanVariant ? BOOLEAN_VARIANT_NAME_POOL : VARIANT_NAME_POOL;
    const variantName = namePool[Math.floor(random.getNext() * namePool.length)]!;
    if (variantNames.includes(variantName)) continue;
    variantNames.push(variantName);
    const valueMap: AnyProps = {};
    if (useBooleanVariant) {
      valueMap["true"] = pickToken(random);
      valueMap["false"] = pickToken(random);
    } else {
      const valueCount = 2 + Math.floor(random.getNext() * 4);
      for (let valueIndex = 0; valueIndex < valueCount; valueIndex++) {
        const valueKey =
          VALUE_KEY_POOL[(valueIndex + Math.floor(random.getNext() * 3)) % VALUE_KEY_POOL.length]!;
        valueMap[valueKey] =
          random.getNext() < 0.85 ? pickToken(random) : [pickToken(random), pickToken(random)];
      }
    }
    variants[variantName] = valueMap;
  }

  const defaultVariants: AnyProps = {};
  for (const variantName of variantNames) {
    if (random.getNext() < 0.6) {
      const valueKeys = Object.keys(variants[variantName] as AnyProps);
      const defaultKey = valueKeys[Math.floor(random.getNext() * valueKeys.length)]!;
      defaultVariants[variantName] =
        defaultKey === "true" ? true : defaultKey === "false" ? false : defaultKey;
    }
  }

  const config: AnyProps = { variants };
  if (Object.keys(defaultVariants).length > 0) config.defaultVariants = defaultVariants;

  if (siteIndex % 20 === 0 && variantNames.length >= 2) {
    const compoundVariants: AnyProps[] = [];
    const entryCount = 4 + Math.floor(random.getNext() * 9);
    for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
      const entry: AnyProps = {};
      for (const variantName of variantNames) {
        if (random.getNext() < 0.5) continue;
        const valueKeys = Object.keys(variants[variantName] as AnyProps);
        const selectedKey = valueKeys[Math.floor(random.getNext() * valueKeys.length)]!;
        const selectorValue =
          selectedKey === "true" ? true : selectedKey === "false" ? false : selectedKey;
        entry[variantName] = random.getNext() < 0.2 ? [selectorValue, valueKeys[0]] : selectorValue;
      }
      if (random.getNext() < 0.8) entry.class = pickToken(random);
      else entry.className = pickToken(random);
      compoundVariants.push(entry);
    }
    config.compoundVariants = compoundVariants;
  }

  return { base, config };
};

const sites: CvaSiteDefinition[] = [];
for (let siteIndex = 0; siteIndex < CVA_DATASET_SITE_COUNT; siteIndex++) {
  sites.push(generateSite(siteIndex));
}

// Call-site distribution from the corpus: 8% zero-arg, 52% one prop, 30% two
// props, the rest three-plus; className routed through cva at ~21% of calls;
// forwarded shorthand props are frequently undefined.
const generateCallRow = (siteIndex: number): CvaCallRow => {
  const site = sites[siteIndex]!;
  if (random.getNext() < 0.08) return [siteIndex];
  const props: AnyProps = {};
  const variantNames = site.config ? Object.keys(site.config.variants as AnyProps) : [];
  const propCountRoll = random.getNext();
  const targetPropCount = propCountRoll < 0.52 ? 1 : propCountRoll < 0.82 ? 2 : 3;
  let assignedCount = 0;
  for (const variantName of variantNames) {
    if (assignedCount >= targetPropCount) break;
    assignedCount++;
    // A skipped slot models the dominant shorthand-forwarding shape where the
    // component prop is undefined (explicit null props were absent in the corpus).
    if (random.getNext() < 0.35) continue;
    const valueMap = (site.config!.variants as AnyProps)[variantName] as AnyProps;
    const valueKeys = Object.keys(valueMap);
    const valueKey = valueKeys[Math.floor(random.getNext() * valueKeys.length)]!;
    props[variantName] = valueKey === "true" ? true : valueKey === "false" ? false : valueKey;
  }
  if (random.getNext() < 0.21) props.className = pickToken(random);
  return [siteIndex, props];
};

const callRows: CvaCallRow[] = [];
for (let frameIndex = 0; frameIndex < CVA_DATASET_FRAME_COUNT; frameIndex++) {
  for (let siteIndex = 0; siteIndex < sites.length; siteIndex++) {
    callRows.push(generateCallRow(siteIndex));
  }
}

const sitesPath = fileURLToPath(new URL("./cva/cva-sites.json", import.meta.url));
const callsPath = fileURLToPath(new URL("./cva/cva-calls.json", import.meta.url));
writeFileSync(sitesPath, `${JSON.stringify(sites)}\n`);
writeFileSync(callsPath, `${JSON.stringify(callRows)}\n`);
console.log(`wrote ${sites.length} sites -> ${sitesPath}`);
console.log(`wrote ${callRows.length} call rows -> ${callsPath}`);
