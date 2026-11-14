import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultToolRegistry, ProviderRegistry } from "@harness/core";
import type { ProviderAdapter, ProviderCapabilities, StreamEvent } from "@harness/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness } from "../src/index";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "harness-sdk-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class FakeProvider implements ProviderAdapter {
  readonly id = "fake";
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    toolCalls: true,
    vision: false,
    reasoning: false,
    promptCache: false,
  };

  constructor(private readonly responses: StreamEvent[][]) {}

  async listModels() {
    return [];
  }

  async *stream(): AsyncIterable<StreamEvent> {
    const events = this.responses.shift() ?? [{ type: "finish" as const, reason: "stop" }];
    for (const event of events) yield event;
  }
}

describe("harness SDK", () => {
  it("creates a session, prompts, and resumes", async () => {
    const cwd = await tempDir();
    const dataDir = await tempDir();
    const provider = new FakeProvider([
      [
        { type: "text-delta", text: "First." },
        { type: "finish", reason: "stop" },
      ],
      [
        { type: "text-delta", text: "Second." },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const harness = createHarness({
      cwd,
      dataDir,
      env: { HARNESS_CONFIG_DIR: dataDir, HARNESS_DATA_DIR: dataDir },
      model: "fake/test",
      registry: new ProviderRegistry().register(provider),
      tools: createDefaultToolRegistry(),
    });

    try {
      const session = await harness.createSession({ title: "SDK test" });
      const first = await harness.prompt(session.id, "first");
      expect(first.text).toBe("First.");
      expect(first.sessionID).toBe(session.id);

      const before = harness.store.readMessages(session.id).length;
      const second = await harness.prompt(session.id, "second");
      expect(second.text).toBe("Second.");
      expect(harness.store.readMessages(session.id).length).toBeGreaterThan(before);
      expect(harness.listSessions({ cwd }).some((entry) => entry.id === session.id)).toBe(true);
      expect(harness.getSession(session.id)?.title).toBe("SDK test");
      expect(harness.exportSession(session.id, "md")).toContain("# SDK test");
    } finally {
      harness.close();
    }
  });

  it("supports custom permission approval and executes tools", async () => {
    const cwd = await tempDir();
    const dataDir = await tempDir();
    const args = JSON.stringify({ path: "sdk.txt", content: "from sdk\n" });
    const provider = new FakeProvider([
      [
        { type: "tool-call-start", callID: "call_w", tool: "write" },
        { type: "tool-call-delta", callID: "call_w", argsDelta: args },
        { type: "tool-call-end", callID: "call_w" },
        { type: "finish", reason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "Done." },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const harness = createHarness({
      cwd,
      dataDir,
      env: { HARNESS_CONFIG_DIR: dataDir, HARNESS_DATA_DIR: dataDir },
      model: "fake/test",
      permissionMode: "default",
      registry: new ProviderRegistry().register(provider),
      tools: createDefaultToolRegistry(),
      askPermission: async () => "allow",
    });

    try {
      const session = await harness.createSession();
      const result = await harness.prompt(session.id, "write it");
      expect(result.text).toBe("Done.");
      expect(result.toolCalls).toBe(1);
      expect(await readFile(join(cwd, "sdk.txt"), "utf8")).toBe("from sdk\n");
    } finally {
      harness.close();
    }
  });

  it("requires a model", async () => {
    const cwd = await tempDir();
    const dataDir = await tempDir();
    const harness = createHarness({
      cwd,
      dataDir,
      env: { HARNESS_CONFIG_DIR: dataDir, HARNESS_DATA_DIR: dataDir },
    });
    try {
      await expect(harness.createSession()).rejects.toMatchObject({ code: "invalid_argument" });
    } finally {
      harness.close();
    }
  });
});
