import { describe, expect, it } from "vitest";
import { initTelemetry, shutdownTelemetry, withSpan } from "../src/observability";

describe("observability", () => {
  it("runs a function inside a span", async () => {
    await expect(withSpan("test.span", async () => 42)).resolves.toBe(42);
  });

  it("records span errors and rethrows", async () => {
    await expect(
      withSpan("test.error", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("does not start telemetry when disabled", async () => {
    await expect(initTelemetry({ enabled: false })).resolves.toEqual({
      enabled: false,
      reason: "telemetry disabled",
    });
  });

  it("shutdown is safe when telemetry was never started", async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});
