import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseDiff, truncateDiff } from "../src/diff";

describe("diff fuzz", () => {
  it("parses arbitrary diff text without throwing", () => {
    fc.assert(
      fc.property(fc.string(), (diff) => {
        expect(() => parseDiff(diff)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("bounds truncated diff output", () => {
    fc.assert(
      fc.property(fc.string(), (diff) => {
        const result = truncateDiff(diff, 10);
        expect(result.text.length).toBeLessThan(diff.length + 100);
      }),
      { numRuns: 200 },
    );
  });
});
