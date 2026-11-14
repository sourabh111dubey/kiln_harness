import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer } from "../src/app";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "harness-ws-"));
  directories.push(directory);
  return directory;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("websocket bridge", () => {
  it("serves session lists over /ws", async () => {
    const dataDir = await tempDir();
    const running = await startServer({
      port: 4_123,
      hostname: "127.0.0.1",
      dataDir,
      env: { HARNESS_CONFIG_DIR: dataDir, HARNESS_DATA_DIR: dataDir },
    });

    try {
      const socket = new WebSocket("ws://127.0.0.1:4123/ws");
      const messages: string[] = [];
      socket.on("message", (data) => messages.push(data.toString()));
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });

      socket.send(JSON.stringify({ type: "list-sessions" }));

      const start = Date.now();
      while (!messages.some((message) => message.includes("[]")) && Date.now() - start < 2_000) {
        await delay(20);
      }

      expect(messages[0] ?? "").toContain("hello");
      expect(messages.some((message) => message.includes("[]"))).toBe(true);

      socket.close();
      await delay(50);
    } finally {
      await running.close();
    }
  }, 10_000);
});
