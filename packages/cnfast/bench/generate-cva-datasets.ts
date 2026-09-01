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
import {
  type CvaDataRecord,
  type CvaCallRow,
  type CvaSiteDefinition,
} from "./cva/cva-benchmark-types";

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

// Distribution thresholds mirror the 58-repository corpus.
const generateSite = (siteIndex: number): CvaSiteDefinition => {
  const base = random.getNext() < 0.9 ? pickToken(random) : [pickToken(random), pickToken(random)];
  const shapeRoll = random.getNext();
  if (shapeRoll < 0.07) return { base, config: null };

  const variants: CvaDataRecord = {};
  const variantCountRoll = random.getNext();
  const variantCount = variantCountRoll < 0.58 ? 1 : variantCountRoll < 0.85 ? 2 : 3;
  const variantNames: string[] = [];
  for (let index = 0; index < variantCount; index++) {
    const useBooleanVariant = random.getNext() < 0.25;
    const namePool = useBooleanVariant ? BOOLEAN_VARIANT_NAME_POOL : VARIANT_NAME_POOL;
    const variantName = namePool[Math.floor(random.getNext() * namePool.length)]!;
    if (variantNames.includes(variantName)) continue;
    variantNames.push(variantName);
    const valueMap: CvaDataRecord = {};
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

  const defaultVariants: CvaDataRecord = {};
  for (const variantName of variantNames) {
    if (random.getNext() < 0.6) {
      const valueKeys = Object.keys(variants[variantName] as CvaDataRecord);
      const defaultKey = valueKeys[Math.floor(random.getNext() * valueKeys.length)]!;
      defaultVariants[variantName] =
        defaultKey === "true" ? true : defaultKey === "false" ? false : defaultKey;
    }
  }

  const config: CvaDataRecord = { variants };
  if (Object.keys(defaultVariants).length > 0) config.defaultVariants = defaultVariants;

  if (siteIndex % 20 === 0 && variantNames.length >= 2) {
    const compoundVariants: CvaDataRecord[] = [];
    const entryCount = 4 + Math.floor(random.getNext() * 9);
    for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
      const compoundVariant: CvaDataRecord = {};
      for (const variantName of variantNames) {
        if (random.getNext() < 0.5) continue;
        const valueKeys = Object.keys(variants[variantName] as CvaDataRecord);
        const selectedKey = valueKeys[Math.floor(random.getNext() * valueKeys.length)]!;
        const selectorValue =
          selectedKey === "true" ? true : selectedKey === "false" ? false : selectedKey;
        compoundVariant[variantName] =
          random.getNext() < 0.2 ? [selectorValue, valueKeys[0]] : selectorValue;
      }
      if (random.getNext() < 0.8) compoundVariant.class = pickToken(random);
      else compoundVariant.className = pickToken(random);
      compoundVariants.push(compoundVariant);
    }
    config.compoundVariants = compoundVariants;
  }

  return { base, config };
};

const siteDefinitions: CvaSiteDefinition[] = [];
for (let siteIndex = 0; siteIndex < CVA_DATASET_SITE_COUNT; siteIndex++) {
  siteDefinitions.push(generateSite(siteIndex));
}

// Call-shape thresholds mirror the 58-repository corpus.
const generateCallRow = (siteIndex: number): CvaCallRow => {
  const siteDefinition = siteDefinitions[siteIndex]!;
  if (random.getNext() < 0.08) return [siteIndex];
  const props: CvaDataRecord = {};
  const variantNames = siteDefinition.config
    ? Object.keys(siteDefinition.config.variants as CvaDataRecord)
    : [];
  const propCountRoll = random.getNext();
  const targetPropCount = propCountRoll < 0.52 ? 1 : propCountRoll < 0.82 ? 2 : 3;
  let assignedCount = 0;
  for (const variantName of variantNames) {
    if (assignedCount >= targetPropCount) break;
    assignedCount++;
    const shouldForwardUndefinedProp = random.getNext() < 0.35;
    if (shouldForwardUndefinedProp) continue;
    const valueMap = (siteDefinition.config!.variants as CvaDataRecord)[
      variantName
    ] as CvaDataRecord;
    const valueKeys = Object.keys(valueMap);
    const valueKey = valueKeys[Math.floor(random.getNext() * valueKeys.length)]!;
    props[variantName] = valueKey === "true" ? true : valueKey === "false" ? false : valueKey;
  }
  if (random.getNext() < 0.21) props.className = pickToken(random);
  return [siteIndex, props];
};

const callDataset: CvaCallRow[] = [];
for (let frameIndex = 0; frameIndex < CVA_DATASET_FRAME_COUNT; frameIndex++) {
  for (let siteIndex = 0; siteIndex < siteDefinitions.length; siteIndex++) {
    callDataset.push(generateCallRow(siteIndex));
  }
}

const siteDefinitionsPath = fileURLToPath(new URL("./cva/cva-sites.json", import.meta.url));
const callDatasetPath = fileURLToPath(new URL("./cva/cva-calls.json", import.meta.url));
writeFileSync(siteDefinitionsPath, `${JSON.stringify(siteDefinitions)}\n`);
writeFileSync(callDatasetPath, `${JSON.stringify(callDataset)}\n`);
console.log(`wrote ${siteDefinitions.length} sites -> ${siteDefinitionsPath}`);
console.log(`wrote ${callDataset.length} call rows -> ${callDatasetPath}`);
