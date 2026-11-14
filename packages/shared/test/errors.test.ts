import { describe, expect, it } from "vitest";
import { errors, isKilncraftError, KilncraftError, toKilncraftError } from "../src/errors";

describe("errors", () => {
  it("carries code, details, and hint", () => {
    const error = new KilncraftError("invalid_argument", "bad value", {
      details: { field: "model" },
      hint: "Pass a model id.",
    });
    expect(error.code).toBe("invalid_argument");
    expect(error.details).toEqual({ field: "model" });
    expect(error.hint).toBe("Pass a model id.");
    expect(error.toJSON()).toMatchObject({ code: "invalid_argument", message: "bad value" });
  });

  it("preserves an existing kilncraft error", () => {
    const original = new KilncraftError("aborted", "cancelled");
    expect(toKilncraftError(original)).toBe(original);
    expect(isKilncraftError(original)).toBe(true);
  });

  it("wraps native errors", () => {
    const cause = new Error("boom");
    const wrapped = toKilncraftError(cause, "tool_error");
    expect(wrapped.code).toBe("tool_error");
    expect(wrapped.message).toBe("boom");
    expect(wrapped.cause).toBe(cause);
  });

  it("wraps non-error values", () => {
    const wrapped = toKilncraftError("nope");
    expect(wrapped.code).toBe("internal_error");
    expect(wrapped.message).toBe("nope");
  });

  it("exposes typed error factories", () => {
    expect(errors.invalidArgument("bad").code).toBe("invalid_argument");
    expect(errors.invalidConfig("bad", "hint").hint).toBe("hint");
    expect(errors.notImplemented("Agent").message).toContain("Agent");
    expect(errors.providerError("slow", new Error("cause")).recoverable).toBe(true);
    expect(errors.toolError("bash", "failed", { exitCode: 1 }).details).toEqual({ exitCode: 1 });
    expect(errors.permissionDenied("no").code).toBe("permission_denied");
    expect(errors.sessionNotFound("ses_missing").details).toEqual({ sessionID: "ses_missing" });
    expect(errors.aborted().code).toBe("aborted");
  });
});
