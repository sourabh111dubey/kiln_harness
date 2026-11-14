import { describe, expect, it } from "vitest";
import { createId, ids, isPrefixedId } from "../src/ids";

describe("ids", () => {
  it("creates prefixed, sortable ids", () => {
    const id = createId("ses");
    expect(id).toMatch(/^ses_[0-9a-z]{8,}$/);
    expect(isPrefixedId(id, "ses")).toBe(true);
    expect(isPrefixedId(id, "msg")).toBe(false);
  });

  it("creates unique ids for every entity", () => {
    const values = [
      ids.session(),
      ids.message(),
      ids.part(),
      ids.toolCall(),
      ids.request(),
      ids.turn(),
    ];
    expect(new Set(values).size).toBe(values.length);
  });

  it("does not produce duplicate ids in a burst", () => {
    const values = new Set(Array.from({ length: 1_000 }, () => ids.session()));
    expect(values.size).toBe(1_000);
  });
});
