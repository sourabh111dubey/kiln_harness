import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLogger,
  type ProviderAdapter,
  type ProviderCapabilities,
  type StreamEvent,
} from "@kiln/shared";
import { afterEach, describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent";
import { PermissionEngine } from "../src/permissions/engine";
import { AuditLog } from "../src/session/audit";
import { CheckpointManager } from "../src/session/checkpoint";
import { SessionStore } from "../src/session/store";
import { createDefaultToolRegistry } from "../src/tools/registry";

const directories: string[] = [];
const stores: SessionStore[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kiln-persist-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
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

function writeCall(path: string, content: string): StreamEvent[] {
  return [
    { type: "tool-call-start", callID: "call_1", tool: "write" },
    { type: "tool-call-delta", callID: "call_1", argsDelta: JSON.stringify({ path, content }) },
    { type: "tool-call-end", callID: "call_1" },
    { type: "finish", reason: "tool_calls" },
  ];
}

function agentFor(
  cwd: string,
  provider: FakeProvider,
  store: SessionStore,
  session: ReturnType<SessionStore["create"]>,
  extras: { audit?: AuditLog; checkpoints?: CheckpointManager } = {},
) {
  return new Agent({
    cwd,
    provider,
    model: "fake/test",
    tools: createDefaultToolRegistry(),
    permissions: new PermissionEngine({ mode: "acceptEdits", cwd }),
    logger: createLogger({ level: "silent" }),
    store,
    session,
    ...extras,
  });
}

describe("agent persistence", () => {
  it("persists messages, events, usage, and status", async () => {
    const dataDir = await tempDir();
    const cwd = await tempDir();
    const store = new SessionStore({ dataDir });
    stores.push(store);
    const session = store.create({ cwd, model: "fake/test", permissions: "acceptEdits" });

    const provider = new FakeProvider([
      writeCall("a.txt", "hello\n"),
      [
        { type: "text-delta", text: "Done." },
        { type: "usage", usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 } },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const agent = agentFor(cwd, provider, store, session);
    const result = await agent.prompt("write a file");

    expect(result.text).toBe("Done.");
    expect(store.readMessages(session.id).length).toBeGreaterThan(0);
    expect(store.readEvents(session.id).length).toBeGreaterThan(0);
    expect(store.get(session.id)?.status).toBe("idle");
    expect(store.get(session.id)?.tokens.input).toBe(3);
    expect(store.get(session.id)?.cost).toBeGreaterThanOrEqual(0);
  });

  it("resumes a session with its prior messages", async () => {
    const dataDir = await tempDir();
    const cwd = await tempDir();
    const store = new SessionStore({ dataDir });
    stores.push(store);
    const session = store.create({ cwd, model: "fake/test", permissions: "acceptEdits" });

    const first = new FakeProvider([
      writeCall("a.txt", "hello\n"),
      [
        { type: "text-delta", text: "Done." },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const agent1 = agentFor(cwd, first, store, session);
    await agent1.prompt("write a file");

    const before = store.readMessages(session.id).length;
    const second = new FakeProvider([
      [
        { type: "text-delta", text: "Continued." },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const resumed = store.get(session.id);
    if (!resumed) throw new Error("session disappeared");
    const agent2 = agentFor(cwd, second, store, resumed);
    expect(agent2.getMessages()).toHaveLength(before);

    const result = await agent2.prompt("continue");
    expect(result.text).toBe("Continued.");
    expect(store.readMessages(session.id).length).toBeGreaterThan(before);
  });

  it("snapshots files before writes and records audit entries", async () => {
    const dataDir = await tempDir();
    const cwd = await tempDir();
    const store = new SessionStore({ dataDir });
    stores.push(store);
    const session = store.create({ cwd, model: "fake/test", permissions: "acceptEdits" });
    const file = join(cwd, "a.txt");
    await writeFile(file, "old\n", "utf8");

    const checkpoints = new CheckpointManager(dataDir);
    const audit = new AuditLog(join(dataDir, "audit.jsonl"));
    const provider = new FakeProvider([
      writeCall("a.txt", "new\n"),
      [
        { type: "text-delta", text: "Done." },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const agent = agentFor(cwd, provider, store, session, { audit, checkpoints });
    await agent.prompt("overwrite");
    expect(await readFile(file, "utf8")).toBe("new\n");
    expect(checkpoints.list(session.id).length).toBeGreaterThan(0);

    await writeFile(file, "changed\n", "utf8");
    expect(checkpoints.restoreLatest(session.id)).toBe(1);
    expect(await readFile(file, "utf8")).toBe("old\n");
    expect(audit.read().some((entry) => entry.tool === "write" && entry.decision === "allow")).toBe(
      true,
    );
  });
});
