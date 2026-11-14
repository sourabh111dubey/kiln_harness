import { describe, expect, it } from "vitest";
import { errors, HarnessError, isHarnessError, toHarnessError } from "../src/errors";

describe("errors", () => {
  it("carries code, details, and hint", () => {
    const error = new HarnessError("invalid_argument", "bad value", {
      details: { field: "model" },
      hint: "Pass a model id.",
    });
    expect(error.code).toBe("invalid_argument");
    expect(error.details).toEqual({ field: "model" });
    expect(error.hint).toBe("Pass a model id.");
    expect(error.toJSON()).toMatchObject({ code: "invalid_argument", message: "bad value" });
  });

  it("preserves an existing harness error", () => {
    const original = new HarnessError("aborted", "cancelled");
    expect(toHarnessError(original)).toBe(original);
    expect(isHarnessError(original)).toBe(true);
  });

  it("wraps native errors", () => {
    const cause = new Error("boom");
    const wrapped = toHarnessError(cause, "tool_error");
    expect(wrapped.code).toBe("tool_error");
    expect(wrapped.message).toBe("boom");
    expect(wrapped.cause).toBe(cause);
  });

  it("wraps non-error values", () => {
    const wrapped = toHarnessError("nope");
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
