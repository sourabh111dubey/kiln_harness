import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultToolRegistry, ProviderRegistry } from "@kiln/core";
import type { ProviderAdapter, ProviderCapabilities, StreamEvent } from "@kiln/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createKiln } from "../src/index";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kiln-sdk-"));
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

describe("kiln SDK", () => {
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
    const kiln = createKiln({
      cwd,
      dataDir,
      env: { KILN_CONFIG_DIR: dataDir, KILN_DATA_DIR: dataDir },
      model: "fake/test",
      registry: new ProviderRegistry().register(provider),
      tools: createDefaultToolRegistry(),
    });

    try {
      const session = await kiln.createSession({ title: "SDK test" });
      const first = await kiln.prompt(session.id, "first");
      expect(first.text).toBe("First.");
      expect(first.sessionID).toBe(session.id);

      const before = kiln.store.readMessages(session.id).length;
      const second = await kiln.prompt(session.id, "second");
      expect(second.text).toBe("Second.");
      expect(kiln.store.readMessages(session.id).length).toBeGreaterThan(before);
      expect(kiln.listSessions({ cwd }).some((entry) => entry.id === session.id)).toBe(true);
      expect(kiln.getSession(session.id)?.title).toBe("SDK test");
      expect(kiln.exportSession(session.id, "md")).toContain("# SDK test");
    } finally {
      kiln.close();
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
    const kiln = createKiln({
      cwd,
      dataDir,
      env: { KILN_CONFIG_DIR: dataDir, KILN_DATA_DIR: dataDir },
      model: "fake/test",
      permissionMode: "default",
      registry: new ProviderRegistry().register(provider),
      tools: createDefaultToolRegistry(),
      askPermission: async () => "allow",
    });

    try {
      const session = await kiln.createSession();
      const result = await kiln.prompt(session.id, "write it");
      expect(result.text).toBe("Done.");
      expect(result.toolCalls).toBe(1);
      expect(await readFile(join(cwd, "sdk.txt"), "utf8")).toBe("from sdk\n");
    } finally {
      kiln.close();
    }
  });

  it("requires a model", async () => {
    const cwd = await tempDir();
    const dataDir = await tempDir();
    const kiln = createKiln({
      cwd,
      dataDir,
      env: { KILN_CONFIG_DIR: dataDir, KILN_DATA_DIR: dataDir },
    });
    try {
      await expect(kiln.createSession()).rejects.toMatchObject({ code: "invalid_argument" });
    } finally {
      kiln.close();
    }
  });
});
