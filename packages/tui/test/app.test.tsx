import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderRegistry } from "@kilncraft/core";
import type { ProviderAdapter, ProviderCapabilities, StreamEvent } from "@kilncraft/shared";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { KilncraftApp } from "../src/KilncraftApp";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kilncraft-tui-"));
  directories.push(directory);
  return directory;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeout = 3_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("Timed out waiting for TUI update");
    await delay(20);
  }
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

  async listModels() {
    return [];
  }

  async *stream(): AsyncIterable<StreamEvent> {
    yield { type: "text-delta", text: "Hello from the TUI." };
    yield { type: "finish", reason: "stop" };
  }
}

class WriteProvider implements ProviderAdapter {
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

describe("TUI app", () => {
  it("renders the shell and handles slash commands", async () => {
    const dataDir = await tempDir();
    const env = { KILNCRAFT_CONFIG_DIR: dataDir, KILNCRAFT_DATA_DIR: dataDir };
    const registry = new ProviderRegistry().register(new FakeProvider());

    const { stdin, lastFrame } = render(
      <KilncraftApp
        env={env}
        dataDir={dataDir}
        model="fake/test"
        permissionMode="default"
        registry={registry}
      />,
    );

    await waitFor(() => (lastFrame() ?? "").includes("kilncraft"));
    await waitFor(() => (lastFrame() ?? "").includes("test"));

    stdin.write("/help");
    await delay(20);
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Commands:"));
  });

  it("sends a prompt and renders the streamed answer", async () => {
    const dataDir = await tempDir();
    const env = { KILNCRAFT_CONFIG_DIR: dataDir, KILNCRAFT_DATA_DIR: dataDir };
    const registry = new ProviderRegistry().register(new FakeProvider());

    const { stdin, lastFrame } = render(
      <KilncraftApp
        env={env}
        dataDir={dataDir}
        model="fake/test"
        permissionMode="default"
        registry={registry}
      />,
    );

    await waitFor(() => (lastFrame() ?? "").includes("kilncraft"));
    await waitFor(() => (lastFrame() ?? "").includes("ses_"));
    stdin.write("hello");
    await delay(20);
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Hello from the TUI."));
  });

  it("asks for permission, executes the tool, and continues", async () => {
    const cwd = await tempDir();
    const dataDir = await tempDir();
    const env = { KILNCRAFT_CONFIG_DIR: dataDir, KILNCRAFT_DATA_DIR: dataDir };
    const args = JSON.stringify({ path: "a.txt", content: "hello\n" });
    const provider = new WriteProvider([
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

    const { stdin, lastFrame } = render(
      <KilncraftApp
        cwd={cwd}
        env={env}
        dataDir={dataDir}
        model="fake/test"
        permissionMode="default"
        registry={new ProviderRegistry().register(provider)}
      />,
    );

    await waitFor(() => (lastFrame() ?? "").includes("kilncraft"));
    await waitFor(() => (lastFrame() ?? "").includes("ses_"));
    stdin.write("write it");
    await delay(20);
    stdin.write("\r");

    await waitFor(() => (lastFrame() ?? "").includes("Permission required"));
    await delay(100);
    stdin.write("y");
    await delay(100);

    await waitFor(() => (lastFrame() ?? "").includes("Done."));
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("hello\n");
  });
});
