import { describe, expect, it } from "vitest";
import { kilnEventSchema } from "../src/events";
import { ids } from "../src/ids";
import { sessionSchema } from "../src/schemas";

function makeSession() {
  return {
    id: ids.session(),
    title: "Test session",
    cwd: "/tmp/project",
    model: "anthropic/claude-sonnet-4-5",
    agent: "build",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "idle" as const,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    permissions: "default" as const,
    metadata: {},
  };
}

describe("events", () => {
  it("round-trips a session.created event", () => {
    const session = makeSession();
    const event = { type: "session.created" as const, session };
    const parsed = kilnEventSchema.parse(event);
    expect(parsed).toEqual(event);
    expect(sessionSchema.parse(session).id).toBe(session.id);
  });

  it("accepts a partial session.updated patch", () => {
    const parsed = kilnEventSchema.parse({
      type: "session.updated",
      patch: { title: "Renamed" },
    });
    expect(parsed.type).toBe("session.updated");
  });

  it("rejects unknown event types", () => {
    expect(() => kilnEventSchema.parse({ type: "nope" })).toThrow();
  });

  it("rejects malformed ids", () => {
    expect(() => kilnEventSchema.parse({ type: "session.archived", sessionID: "bad" })).toThrow();
  });
});
