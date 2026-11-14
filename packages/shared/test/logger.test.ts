import { describe, expect, it } from "vitest";
import { createLogger, redactValue } from "../src/logger";

describe("logger", () => {
  it("creates a logger with the requested level", () => {
    const logger = createLogger({ level: "silent", name: "test" });
    expect(logger.level).toBe("silent");
  });

  it("redacts API keys and bearer tokens", () => {
    expect(redactValue("key sk-abcdefgh1234")).toContain("[REDACTED]");
    expect(redactValue("Authorization: Bearer abcdefgh1234")).toContain("[REDACTED]");
    expect(redactValue("nothing to redact")).toBe("nothing to redact");
  });

  it("uses the KILN_LOG_LEVEL fallback", () => {
    const previous = process.env.KILN_LOG_LEVEL;
    process.env.KILN_LOG_LEVEL = "error";
    try {
      expect(createLogger().level).toBe("error");
    } finally {
      if (previous === undefined) delete process.env.KILN_LOG_LEVEL;
      else process.env.KILN_LOG_LEVEL = previous;
    }
  });
});
