import { describe, expect, it } from "vitest";
import { createCn } from "./src/index.js";

// Directed staleness coverage for the successor-prediction chain: bucket trims shift entry
// positions and rotations drop buckets from the Maps, so a stale prediction record must always
// fail verification and fall back to a correct normal probe. Non-Tailwind class names are used so
// every expected output is just the truthy args joined with single spaces.

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

    // Learn the chain (round 1 inserts, round 2 records normal hits, round 3+ predicts).
    for (let round = 0; round < 4; round++) replaySequence();

    // Overflow the shared anchor buckets past ARG_CACHE_BUCKET_ENTRIES to force trimBucket,
    // shifting every surviving entry's position out from under its prediction record.
    for (let i = 0; i < 120; i++) {
      expect(cn(`trim-${i}`, "seq-anchor")).toBe(`trim-${i} seq-anchor`);
      expect(cn(`trim-${i}`, `tri-${i}`, "tri-anchor")).toBe(`trim-${i} tri-${i} tri-anchor`);
    }
    for (let round = 0; round < 3; round++) replaySequence();

    // Blow past ARG_CACHE_ROTATION_SLOTS several times over (also wrapping the entry-id space)
    // so predictions point at rotated-out buckets and stolen ids.
    for (let i = 0; i < 2500; i++) {
      expect(cn(`rot-${i}`, `rot-anchor-${i}`)).toBe(`rot-${i} rot-anchor-${i}`);
    }
    for (let round = 0; round < 3; round++) replaySequence();

    // Interleave trims with an actively predicted chain: each pass alternates one predicted-hit
    // sequence with inserts that keep trimming its bucket.
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
    // A learned successor with the right anchor but different rest args must not be trusted.
    for (let round = 0; round < 3; round++) {
      expect(cn("lead-a", "mid-a", "shared-anchor")).toBe("lead-a mid-a shared-anchor");
      expect(cn("lead-a", "mid-b", "shared-anchor")).toBe("lead-a mid-b shared-anchor");
      expect(cn("lead-b", "mid-a", "shared-anchor")).toBe("lead-b mid-a shared-anchor");
    }
    // Arity padding must reduce to the same truthy sequence with prediction active.
    for (let round = 0; round < 3; round++) {
      expect(cn("lead-a", "mid-a", "shared-anchor", null)).toBe("lead-a mid-a shared-anchor");
      expect(cn(false, "lead-a", "mid-a", "shared-anchor")).toBe("lead-a mid-a shared-anchor");
    }
  });
});
