import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderRegistry, SessionStore } from "@kiln/core";
import type { ProviderAdapter, ProviderCapabilities, StreamEvent } from "@kiln/shared";
import { afterEach, describe, expect, it } from "vitest";
import { runPrompt } from "../src/run-prompt";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kiln-cli-run-"));
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

  async listModels() {
    return [];
  }

  async *stream(): AsyncIterable<StreamEvent> {
    yield { type: "text-delta", text: "Hello from fake." };
    yield {
      type: "usage",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    };
    yield { type: "finish", reason: "stop" };
  }
}

describe("runPrompt", () => {
  it("requires a model", async () => {
    const cwd = await tempDir();
    await expect(
      runPrompt({ prompt: "hi", cwd, env: { KILN_CONFIG_DIR: cwd } }),
    ).rejects.toMatchObject({ code: "invalid_argument" });
  });

  it("rejects malformed model references", async () => {
    const cwd = await tempDir();
    await expect(
      runPrompt({
        prompt: "hi",
        cwd,
        env: { KILN_CONFIG_DIR: cwd },
        model: "nope",
      }),
    ).rejects.toMatchObject({ code: "invalid_argument" });
  });

  it("reports when a provider is not configured", async () => {
    const cwd = await tempDir();
    await expect(
      runPrompt({
        prompt: "hi",
        cwd,
        env: { KILN_CONFIG_DIR: cwd },
        model: "anthropic/claude-sonnet-4-5",
      }),
    ).rejects.toMatchObject({ code: "provider_error" });
  });

  it("creates, persists, and resumes a session", async () => {
    const cwd = await tempDir();
    const dataDir = await tempDir();
    const registry = new ProviderRegistry().register(new FakeProvider());

    const first = await runPrompt({
      prompt: "first",
      cwd,
      env: { KILN_CONFIG_DIR: cwd },
      model: "fake/test",
      permissionMode: "default",
      registry,
      dataDir,
    });

    const store = new SessionStore({ dataDir });
    try {
      expect(first.text).toBe("Hello from fake.");
      expect(first.usage.input).toBe(1);
      expect(store.get(first.sessionID)).toBeDefined();
      const afterFirst = store.readMessages(first.sessionID).length;
      expect(afterFirst).toBeGreaterThan(0);

      const second = await runPrompt({
        prompt: "second",
        cwd,
        env: { KILN_CONFIG_DIR: cwd },
        model: "fake/test",
        permissionMode: "default",
        registry,
        dataDir,
        sessionID: first.sessionID,
      });

      expect(second.sessionID).toBe(first.sessionID);
      expect(store.readMessages(first.sessionID).length).toBeGreaterThan(afterFirst);
    } finally {
      store.close();
    }
  });

  it("continues the latest session in the working directory", async () => {
    const cwd = await tempDir();
    const dataDir = await tempDir();
    const registry = new ProviderRegistry().register(new FakeProvider());

    const first = await runPrompt({
      prompt: "first",
      cwd,
      env: { KILN_CONFIG_DIR: cwd },
      model: "fake/test",
      permissionMode: "default",
      registry,
      dataDir,
    });

    const continued = await runPrompt({
      prompt: "second",
      cwd,
      env: { KILN_CONFIG_DIR: cwd },
      model: "fake/test",
      permissionMode: "default",
      registry,
      dataDir,
      continueSession: true,
    });

    expect(continued.sessionID).toBe(first.sessionID);
  });
});
