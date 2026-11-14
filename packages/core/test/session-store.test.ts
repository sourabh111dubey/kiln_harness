import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ChatMessage, KilncraftEvent } from "@kilncraft/shared";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "../src/session/store";

const directories: string[] = [];
const stores: SessionStore[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kilncraft-store-"));
  directories.push(directory);
  return directory;
}

function makeStore(dataDir: string): SessionStore {
  const store = new SessionStore({ dataDir });
  stores.push(store);
  return store;
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const userMessage: ChatMessage = { role: "user", content: "hello" };
const assistantMessage: ChatMessage = { role: "assistant", content: "hi" };

describe("session store", () => {
  it("creates, reads, updates, and lists sessions", async () => {
    const store = makeStore(await tempDir());
    const session = store.create({ cwd: resolve("/tmp/project"), model: "fake/test" });

    expect(session.id).toMatch(/^ses_/);
    expect(session.title).toBe("project");
    expect(session.status).toBe("idle");
    expect(store.get(session.id)?.cwd).toBe(resolve("/tmp/project"));

    const updated = store.update(session.id, { title: "Renamed", status: "running" });
    expect(updated?.title).toBe("Renamed");
    expect(updated?.status).toBe("running");
    expect(store.list({ cwd: resolve("/tmp/project") })).toHaveLength(1);
  });

  it("persists messages and events", async () => {
    const store = makeStore(await tempDir());
    const session = store.create({ cwd: resolve("/tmp/project"), model: "fake/test" });

    store.appendMessage(session.id, userMessage);
    store.appendMessage(session.id, assistantMessage);
    expect(store.readMessages(session.id)).toEqual([userMessage, assistantMessage]);

    const event: KilncraftEvent = { type: "turn.start", turn: 1, prompt: "hello" };
    store.appendEvent(session.id, event);
    expect(store.readEvents(session.id)).toEqual([event]);
  });

  it("replaces messages during compaction", async () => {
    const store = makeStore(await tempDir());
    const session = store.create({ cwd: resolve("/tmp/project"), model: "fake/test" });
    store.appendMessage(session.id, userMessage);
    store.appendMessage(session.id, assistantMessage);

    store.replaceMessages(session.id, [assistantMessage]);
    expect(store.readMessages(session.id)).toEqual([assistantMessage]);
  });

  it("searches message content", async () => {
    const store = makeStore(await tempDir());
    const session = store.create({ cwd: resolve("/tmp/project"), model: "fake/test" });
    store.appendMessage(session.id, { role: "user", content: "needle in a haystack" });

    const results = store.search("needle");
    expect(results).toHaveLength(1);
    expect(results[0]?.sessionID).toBe(session.id);
    expect(results[0]?.content).toContain("needle");
  });

  it("exports JSON and markdown", async () => {
    const store = makeStore(await tempDir());
    const session = store.create({
      cwd: resolve("/tmp/project"),
      model: "fake/test",
      title: "Demo",
    });
    store.appendMessage(session.id, userMessage);
    store.appendMessage(session.id, assistantMessage);

    const json = JSON.parse(store.export(session.id)) as {
      session: { id: string };
      messages: ChatMessage[];
    };
    expect(json.session.id).toBe(session.id);
    expect(json.messages).toHaveLength(2);

    const markdown = store.export(session.id, "md");
    expect(markdown).toContain("# Demo");
    expect(markdown).toContain("hello");
    expect(markdown).toContain("hi");
  });

  it("deletes a session", async () => {
    const store = makeStore(await tempDir());
    const session = store.create({ cwd: resolve("/tmp/project"), model: "fake/test" });
    store.appendMessage(session.id, userMessage);

    expect(store.delete(session.id)).toBe(true);
    expect(store.get(session.id)).toBeUndefined();
    expect(store.delete(session.id)).toBe(false);
  });
});
