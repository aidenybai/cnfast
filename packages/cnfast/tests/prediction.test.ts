import { describe, expect, it } from "vitest";
import { createCn } from "./src/index.js";
import {
  ARGUMENT_CACHE_BUCKET_ENTRIES,
  ARGUMENT_CACHE_PREDICTION_SLOTS,
} from "../src/lib/constants.js";
import { createSeededRandom } from "./utils/create-seeded-random";

const SEQUENCE_LENGTH = 10;
const CACHE_TRIM_INPUT_COUNT = 120;
const CACHE_ROTATION_INPUT_COUNT = 2_500;
const CHURN_INPUT_COUNT = 60;

// After trimBucket relocates entries, a prediction's stored position can point
// at a numeric bookkeeping slot (a restLength header or an entryId) rather than
// the entry it was armed on. A truthy NUMBER argument (clsx accepts numbers)
// can strict-equal that numeric slot, so a probe that treated its identity
// compares as type guards would return another entry's bytes. This layout
// drives that exact misalignment: G's entryId slot lands where the prediction
// reads its restLength, and the overlay entry's restLength slot (sized to
// `tailRestLength`) lands where a numeric argument is compared.
const STALE_TRIM_ANCHOR = "stale-anchor";
const STALE_TRIM_FILLER_ENTRY_COUNT = 44;
type StaleTrimCn = (...args: unknown[]) => string;

const driveStaleTrimLayout = (
  cn: StaleTrimCn,
  targetEntryId: number,
  tailRestLength: number,
): void => {
  const droppedEntryCount = ARGUMENT_CACHE_BUCKET_ENTRIES >> 1;
  const entryIdsConsumedBeforeTarget = droppedEntryCount + 3 + STALE_TRIM_FILLER_ENTRY_COUNT;
  const dummyInsertCount =
    (targetEntryId - entryIdsConsumedBeforeTarget + 2 * ARGUMENT_CACHE_PREDICTION_SLOTS) %
    ARGUMENT_CACHE_PREDICTION_SLOTS;
  for (let index = 0; index < dummyInsertCount; index++) cn(`d${index}`, `da${index}`);
  for (let index = 0; index < droppedEntryCount; index++) cn(`a${index}`, STALE_TRIM_ANCHOR);
  cn("e-first", "e-second", STALE_TRIM_ANCHOR);
  cn("x1", "x-anchor");
  cn("e-first", "e-second", STALE_TRIM_ANCHOR);
  cn("w1", "w2", "w3", "w4", "w5", STALE_TRIM_ANCHOR);
  for (let index = 0; index < STALE_TRIM_FILLER_ENTRY_COUNT; index++) {
    cn(`b${index}`, STALE_TRIM_ANCHOR);
  }
  cn("g1", STALE_TRIM_ANCHOR);
  const tailArgs: string[] = [];
  for (let index = 0; index < tailRestLength; index++) tailArgs.push(`h${index + 1}`);
  cn(...tailArgs, STALE_TRIM_ANCHOR);
  cn("trigger", STALE_TRIM_ANCHOR);
  cn("x1", "x-anchor");
};

describe("cn: successor prediction staleness", () => {
  it("stays correct across learned chains, bucket trims, and cache rotation", () => {
    const cn = createCn((config) => config);

    const sequenceArguments: string[] = [];
    for (let sequenceIndex = 0; sequenceIndex < SEQUENCE_LENGTH; sequenceIndex++) {
      sequenceArguments.push(`seq-${sequenceIndex}`);
    }

    const replaySequence = (): void => {
      for (let sequenceIndex = 0; sequenceIndex < SEQUENCE_LENGTH; sequenceIndex++) {
        expect(cn(sequenceArguments[sequenceIndex]!, "seq-anchor")).toBe(
          `seq-${sequenceIndex} seq-anchor`,
        );
        expect(cn(sequenceArguments[sequenceIndex]!, `tri-${sequenceIndex}`, "tri-anchor")).toBe(
          `seq-${sequenceIndex} tri-${sequenceIndex} tri-anchor`,
        );
        expect(
          cn(sequenceArguments[sequenceIndex]!, false, `var-${sequenceIndex}`, "var-anchor", null),
        ).toBe(`seq-${sequenceIndex} var-${sequenceIndex} var-anchor`);
      }
    };

    for (let round = 0; round < 4; round++) replaySequence();

    for (let inputIndex = 0; inputIndex < CACHE_TRIM_INPUT_COUNT; inputIndex++) {
      expect(cn(`trim-${inputIndex}`, "seq-anchor")).toBe(`trim-${inputIndex} seq-anchor`);
      expect(cn(`trim-${inputIndex}`, `tri-${inputIndex}`, "tri-anchor")).toBe(
        `trim-${inputIndex} tri-${inputIndex} tri-anchor`,
      );
    }
    for (let round = 0; round < 3; round++) replaySequence();

    for (let inputIndex = 0; inputIndex < CACHE_ROTATION_INPUT_COUNT; inputIndex++) {
      expect(cn(`rot-${inputIndex}`, `rot-anchor-${inputIndex}`)).toBe(
        `rot-${inputIndex} rot-anchor-${inputIndex}`,
      );
    }
    for (let round = 0; round < 3; round++) replaySequence();

    for (let pass = 0; pass < 6; pass++) {
      replaySequence();
      for (let inputIndex = 0; inputIndex < CHURN_INPUT_COUNT; inputIndex++) {
        expect(cn(`churn-${pass}-${inputIndex}`, "seq-anchor")).toBe(
          `churn-${pass}-${inputIndex} seq-anchor`,
        );
      }
    }
    replaySequence();
  });

  it("verifies the full truthy sequence, not just the anchor", () => {
    const cn = createCn((config) => config);

    for (let round = 0; round < 3; round++) {
      expect(cn("lead-a", "mid-a", "shared-anchor")).toBe("lead-a mid-a shared-anchor");
      expect(cn("lead-b", "mid-b", "shared-anchor")).toBe("lead-b mid-b shared-anchor");
    }
    for (let round = 0; round < 3; round++) {
      expect(cn("lead-a", "mid-a", "shared-anchor")).toBe("lead-a mid-a shared-anchor");
      expect(cn("lead-a", "mid-b", "shared-anchor")).toBe("lead-a mid-b shared-anchor");
      expect(cn("lead-b", "mid-a", "shared-anchor")).toBe("lead-b mid-a shared-anchor");
    }
    for (let round = 0; round < 3; round++) {
      expect(cn("lead-a", "mid-a", "shared-anchor", null)).toBe("lead-a mid-a shared-anchor");
      expect(cn(false, "lead-a", "mid-a", "shared-anchor")).toBe("lead-a mid-a shared-anchor");
    }
  });

  it("rejects numeric args that alias a stale prediction's numeric slots", () => {
    // Ported PoCs: a stale prediction after trimBucket + a truthy NUMBER arg
    // would return another entry's bytes at each probe site (arity 2, 3, >=4)
    // if the identity compares were trusted as type guards.
    const entryProbeCn = createCn((config) => config) as StaleTrimCn;
    driveStaleTrimLayout(entryProbeCn, 2, 1);
    expect(entryProbeCn(1, "h1", 0, STALE_TRIM_ANCHOR)).toBe("1 h1 stale-anchor");

    const threeValueCn = createCn((config) => config) as StaleTrimCn;
    driveStaleTrimLayout(threeValueCn, 2, 1);
    expect(threeValueCn(1, "h1", STALE_TRIM_ANCHOR)).toBe("1 h1 stale-anchor");

    const twoValueCn = createCn((config) => config) as StaleTrimCn;
    driveStaleTrimLayout(twoValueCn, 1, 1);
    expect(twoValueCn(1, STALE_TRIM_ANCHOR)).toBe("1 stale-anchor");
  });

  it("stays byte-correct across seeded numeric-arg stale-probe attacks", () => {
    // The overlay entry's restLength slot is sized to the numeric attack value,
    // so an unfixed two-arg probe would return the overlay's rest string. Fixed
    // src must reject the numeric first arg and merge it as a class token.
    const random = createSeededRandom(0xf00dfeed);
    for (let round = 0; round < 40; round++) {
      const numericValue = 1 + Math.floor(random.getNext() * 8);
      const cn = createCn((config) => config) as StaleTrimCn;
      driveStaleTrimLayout(cn, 1, numericValue);
      expect(cn(numericValue, STALE_TRIM_ANCHOR)).toBe(`${numericValue} stale-anchor`);
    }
  });
});
