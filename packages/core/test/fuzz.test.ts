import { kilnEventSchema } from "@kiln/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { globToRegExp, truncateText } from "../src/index";

describe("fuzz", () => {
  it("never throws while converting glob patterns", () => {
    fc.assert(
      fc.property(fc.string(), (pattern) => {
        expect(() => globToRegExp(pattern)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("bounds truncation output", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = truncateText(text, 100);
        expect(result.text.length).toBeLessThanOrEqual(160);
      }),
      { numRuns: 200 },
    );
  });

  it("parses arbitrary objects without throwing", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.anything()), (value) => {
        expect(() => kilnEventSchema.safeParse(value)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });
});
