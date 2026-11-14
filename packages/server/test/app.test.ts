import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultToolRegistry, ProviderRegistry } from "@kiln/core";
import type { ProviderAdapter, ProviderCapabilities, StreamEvent } from "@kiln/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createKilnApp } from "../src/app";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kiln-server-"));
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

async function makeApp(provider: FakeProvider, cwd: string, dataDir: string) {
  return createKilnApp({
    cwd,
    dataDir,
    env: { KILN_CONFIG_DIR: dataDir, KILN_DATA_DIR: dataDir },
    registry: new ProviderRegistry().register(provider),
    tools: createDefaultToolRegistry(),
  });
}

describe("kiln server", () => {
  it("serves health, info, tools, and models", async () => {
    const cwd = await tempDir();
    const dataDir = await tempDir();
    const { app, close } = await makeApp(new FakeProvider([]), cwd, dataDir);
    try {
      expect((await app.request("/health")).status).toBe(200);
      const info = (await (await app.request("/info")).json()) as { providers: string[] };
      expect(info.providers).toContain("fake");
      const tools = (await (await app.request("/tools")).json()) as Array<{ name: string }>;
      expect(tools.map((tool) => tool.name)).toContain("read");
      expect((await app.request("/openapi.json")).status).toBe(200);
    } finally {
      close();
    }
  });

  it("creates, lists, reads, and deletes sessions", async () => {
    const cwd = await tempDir();
    const dataDir = await tempDir();
    const { app, close } = await makeApp(new FakeProvider([]), cwd, dataDir);
    try {
      const created = (await (
        await app.request("/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, model: "fake/test" }),
        })
      ).json()) as { id: string };

      const listed = (await (await app.request("/sessions")).json()) as Array<{ id: string }>;
      expect(listed.some((session) => session.id === created.id)).toBe(true);

      const fetched = (await (await app.request(`/sessions/${created.id}`)).json()) as {
        session: { id: string };
      };
      expect(fetched.session.id).toBe(created.id);

      expect((await app.request(`/sessions/${created.id}`, { method: "DELETE" })).status).toBe(200);
      expect((await app.request(`/sessions/${created.id}`)).status).toBe(404);
    } finally {
      close();
    }
  });

  it("streams a prompt and returns the final answer", async () => {
    const cwd = await tempDir();
    const dataDir = await tempDir();
    const provider = new FakeProvider([
      [
        { type: "text-delta", text: "Hello from the server." },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const { app, close } = await makeApp(provider, cwd, dataDir);
    try {
      const created = (await (
        await app.request("/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, model: "fake/test" }),
        })
      ).json()) as { id: string };

      const response = await app.request(`/sessions/${created.id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      });
      const text = await response.text();
      expect(text).toContain("Hello from the server.");
      expect(text).toContain('"type":"done"');
    } finally {
      close();
    }
  });

  it("streams a permission request, resolves it over HTTP, and resumes", async () => {
    const cwd = await tempDir();
    const dataDir = await tempDir();
    const args = JSON.stringify({ path: "a.txt", content: "hello\n" });
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
    const { app, close } = await makeApp(provider, cwd, dataDir);
    try {
      const created = (await (
        await app.request("/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, model: "fake/test" }),
        })
      ).json()) as { id: string };

      const response = await app.request(`/sessions/${created.id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "write it" }),
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error("no stream");
      const decoder = new TextDecoder();
      let buffer = "";

      const nextFrame = async (): Promise<string | null> => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return null;
          buffer += decoder.decode(value, { stream: true });
          const boundary = buffer.indexOf("\n\n");
          if (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            return frame;
          }
        }
      };

      let requestID: string | undefined;
      for (let index = 0; index < 10; index++) {
        const frame = await nextFrame();
        if (!frame) break;
        const match = /"type":"permission.requested".*"requestID":"([^"]+)"/.exec(frame);
        if (match?.[1]) {
          requestID = match[1];
          break;
        }
      }
      expect(requestID).toBeDefined();

      const resolved = await app.request(`/sessions/${created.id}/permissions/${requestID}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "allow" }),
      });
      expect(resolved.status).toBe(200);

      let final = "";
      while (true) {
        const frame = await nextFrame();
        if (!frame) break;
        final += frame;
      }

      expect(final).toContain("Done.");
      expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("hello\n");
    } finally {
      close();
    }
  });
});
