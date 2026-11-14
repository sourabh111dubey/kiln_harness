import { describe, expect, it } from "vitest";
import { parseDiff, truncateDiff } from "../src/diff";

const diff = ["--- a.txt", "+++ a.txt", "@@ -1,2 +1,2 @@", "-old", "+new", " same"].join("\n");

describe("diff parsing", () => {
  it("parses hunks and line numbers", () => {
    const lines = parseDiff(diff);
    expect(lines[0]).toMatchObject({ type: "meta", text: "--- a.txt" });
    expect(lines[2]).toMatchObject({ type: "meta" });
    expect(lines[3]).toMatchObject({ type: "remove", text: "old", oldLine: 1 });
    expect(lines[4]).toMatchObject({ type: "add", text: "new", newLine: 1 });
    expect(lines[5]).toMatchObject({ type: "context", text: "same", oldLine: 2, newLine: 2 });
  });

  it("truncates long diffs", () => {
    const long = Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n");
    const truncated = truncateDiff(long, 3);
    expect(truncated.truncated).toBe(true);
    expect(truncated.text).toContain("7 more lines");
  });
});
