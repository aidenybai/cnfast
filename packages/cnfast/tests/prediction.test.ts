import { describe, expect, it } from "vitest";
import { createCn } from "./src/index.js";

const SEQUENCE_LENGTH = 10;

describe("cn: successor prediction staleness", () => {
  it("stays correct across learned chains, bucket trims, and cache rotation", () => {
    const cn = createCn((config) => config);

    const restArgs: string[] = [];
    for (let i = 0; i < SEQUENCE_LENGTH; i++) restArgs.push(`seq-${i}`);

    const replaySequence = (): void => {
      for (let i = 0; i < SEQUENCE_LENGTH; i++) {
        expect(cn(restArgs[i]!, "seq-anchor")).toBe(`seq-${i} seq-anchor`);
        expect(cn(restArgs[i]!, `tri-${i}`, "tri-anchor")).toBe(`seq-${i} tri-${i} tri-anchor`);
        expect(cn(restArgs[i]!, false, `var-${i}`, "var-anchor", null)).toBe(
          `seq-${i} var-${i} var-anchor`,
        );
      }
    };

    for (let round = 0; round < 4; round++) replaySequence();

    for (let i = 0; i < 120; i++) {
      expect(cn(`trim-${i}`, "seq-anchor")).toBe(`trim-${i} seq-anchor`);
      expect(cn(`trim-${i}`, `tri-${i}`, "tri-anchor")).toBe(`trim-${i} tri-${i} tri-anchor`);
    }
    for (let round = 0; round < 3; round++) replaySequence();

    for (let i = 0; i < 2500; i++) {
      expect(cn(`rot-${i}`, `rot-anchor-${i}`)).toBe(`rot-${i} rot-anchor-${i}`);
    }
    for (let round = 0; round < 3; round++) replaySequence();

    for (let pass = 0; pass < 6; pass++) {
      replaySequence();
      for (let i = 0; i < 60; i++) {
        expect(cn(`churn-${pass}-${i}`, "seq-anchor")).toBe(`churn-${pass}-${i} seq-anchor`);
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
