import { describe, expect, it } from "vitest";
import { createCn } from "./src/index.js";

const SEQUENCE_LENGTH = 10;
const CACHE_TRIM_INPUT_COUNT = 120;
const CACHE_ROTATION_INPUT_COUNT = 2_500;
const CHURN_INPUT_COUNT = 60;

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
});
