import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createLogger,
  type ProviderAdapter,
  type ProviderCapabilities,
  type StreamEvent,
} from "@kiln/shared";
import { afterEach, describe, expect, it } from "vitest";
import { Agent, type AgentEvent } from "../src/agent/agent";
import { PermissionEngine } from "../src/permissions/engine";
import { createDefaultToolRegistry } from "../src/tools/registry";
import { makeTempDir, removeTempDir } from "./helpers";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await makeTempDir("kiln-agent-");
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(removeTempDir));
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

function agentFor(
  cwd: string,
  provider: FakeProvider,
  mode: "default" | "acceptEdits" | "plan" | "bypassPermissions" = "acceptEdits",
  maxTurns = 25,
): Agent {
  return new Agent({
    cwd,
    provider,
    model: "fake/test",
    tools: createDefaultToolRegistry(),
    permissions: new PermissionEngine({ mode, cwd }),
    logger: createLogger({ level: "silent" }),
    maxTurns,
  });
}

async function run(
  agent: Agent,
  prompt = "go",
): Promise<{ result: Awaited<ReturnType<Agent["prompt"]>>; events: AgentEvent[] }> {
  const events: AgentEvent[] = [];
  const result = await agent.prompt(prompt, {
    onEvent: (event) => {
      events.push(event);
    },
  });
  return { result, events };
}

function writeCall(path: string, content: string): StreamEvent[] {
  return [
    { type: "text-delta", text: "Writing. " },
    { type: "tool-call-start", callID: "call_1", tool: "write" },
    {
      type: "tool-call-delta",
      callID: "call_1",
      argsDelta: JSON.stringify({ path, content }),
    },
    { type: "tool-call-end", callID: "call_1" },
    { type: "finish", reason: "tool_calls" },
  ];
}

describe("agent loop", () => {
  it("executes a tool and continues until the model stops", async () => {
    const cwd = await tempDir();
    const provider = new FakeProvider([
      writeCall("a.txt", "hello\n"),
      [
        { type: "text-delta", text: "Done." },
        { type: "usage", usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 } },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const { result, events } = await run(agentFor(cwd, provider));

    expect(result.text).toBe("Done.");
    expect(result.toolCalls).toBe(1);
    expect(result.stopReason).toBe("stop");
    expect(result.usage.input).toBe(3);
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("hello\n");
    expect(events.some((event) => event.type === "tool.result" && event.decision === "allow")).toBe(
      true,
    );
  });

  it("denies writes in default mode and lets the model recover", async () => {
    const cwd = await tempDir();
    const provider = new FakeProvider([
      writeCall("a.txt", "hello\n"),
      [
        { type: "text-delta", text: "Could not write." },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const { result, events } = await run(agentFor(cwd, provider, "default"));

    expect(result.text).toBe("Could not write.");
    await expect(readFile(join(cwd, "a.txt"), "utf8")).rejects.toThrow();
    const denied = events.find((event) => event.type === "permission.denied");
    expect(denied).toBeDefined();
  });

  it("denies writes in plan mode", async () => {
    const cwd = await tempDir();
    const provider = new FakeProvider([
      writeCall("a.txt", "hello\n"),
      [
        { type: "text-delta", text: "Plan only." },
        { type: "finish", reason: "stop" },
      ],
    ]);

    await run(agentFor(cwd, provider, "plan"));
    await expect(readFile(join(cwd, "a.txt"), "utf8")).rejects.toThrow();
  });

  it("returns an error result for unknown tools", async () => {
    const cwd = await tempDir();
    const provider = new FakeProvider([
      [
        { type: "tool-call-start", callID: "call_1", tool: "nope" },
        { type: "tool-call-delta", callID: "call_1", argsDelta: "{}" },
        { type: "tool-call-end", callID: "call_1" },
        { type: "finish", reason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "Recovered." },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const { result, events } = await run(agentFor(cwd, provider));
    expect(result.text).toBe("Recovered.");
    const toolResult = events.find(
      (event) => event.type === "tool.result" && event.tool === "nope",
    );
    expect(toolResult).toBeDefined();
    if (toolResult?.type !== "tool.result") throw new Error("expected tool result");
    expect(toolResult.output).toMatchObject({ kind: "text" });
  });

  it("stops at the max turn limit", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.txt"), "hello\n");
    const readCall: StreamEvent[] = [
      { type: "tool-call-start", callID: "call_1", tool: "read" },
      { type: "tool-call-delta", callID: "call_1", argsDelta: '{"path":"a.txt"}' },
      { type: "tool-call-end", callID: "call_1" },
      { type: "finish", reason: "tool_calls" },
    ];
    const provider = new FakeProvider([readCall, readCall, readCall]);

    const { result } = await run(agentFor(cwd, provider, "acceptEdits", 2));
    expect(result.stopReason).toBe("max_turns");
    expect(result.toolCalls).toBe(2);
  });

  it("returns a recoverable tool error for invalid JSON", async () => {
    const cwd = await tempDir();
    const provider = new FakeProvider([
      [
        { type: "tool-call-start", callID: "call_1", tool: "read" },
        { type: "tool-call-delta", callID: "call_1", argsDelta: "{not json" },
        { type: "tool-call-end", callID: "call_1" },
        { type: "finish", reason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "Recovered." },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const { result, events } = await run(agentFor(cwd, provider));
    expect(result.text).toBe("Recovered.");
    const toolResult = events.find((event) => event.type === "tool.result");
    expect(toolResult).toBeDefined();
    if (toolResult?.type !== "tool.result") throw new Error("expected tool result");
    expect(toolResult.output).toMatchObject({ kind: "text" });
  });

  it("updates todos through the tool context", async () => {
    const cwd = await tempDir();
    const todos = [
      { content: "First", status: "completed" as const },
      { content: "Second", status: "pending" as const },
    ];
    const provider = new FakeProvider([
      [
        { type: "tool-call-start", callID: "call_1", tool: "todo_write" },
        {
          type: "tool-call-delta",
          callID: "call_1",
          argsDelta: JSON.stringify({ todos }),
        },
        { type: "tool-call-end", callID: "call_1" },
        { type: "finish", reason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "Planned." },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const agent = agentFor(cwd, provider);
    const { result } = await run(agent);
    expect(result.text).toBe("Planned.");
    expect(agent.getTodos()).toEqual(todos);
  });
});
