import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, type Plugin } from "@kilncraft/shared";
import { afterEach, describe, expect, it } from "vitest";
import { loadPlugins, PluginHost } from "../src/plugin/host";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kilncraft-plugin-"));
  directories.push(directory);
  return directory;
}

const context = {
  cwd: "/tmp/workspace",
  dataDir: "/tmp/data",
  logger: createLogger({ level: "silent" }),
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("plugin host", () => {
  it("runs hooks and exposes plugin tools", async () => {
    const events: string[] = [];
    const plugin: Plugin = {
      id: "demo",
      hooks: {
        "session.start": async () => {
          events.push("start");
        },
        "tool.after": async (_context, payload) => ({
          kind: "text",
          text: `after:${payload.output.kind}`,
        }),
        event: async () => {
          events.push("event");
        },
      },
      tools: [],
    };
    const host = new PluginHost([plugin], context);

    await host.sessionStart({ sessionID: "ses_1", cwd: "/tmp", model: "a/b" });
    const output = await host.toolAfter({
      sessionID: "ses_1",
      call: { id: "call_1", name: "read", input: {} },
      output: { kind: "text", text: "before" },
    });
    await host.emit({ type: "session.archived", sessionID: "ses_1" });

    expect(events).toEqual(["start", "event"]);
    expect(output).toEqual({ kind: "text", text: "after:text" });
  });

  it("blocks tools from a tool.before hook", async () => {
    const host = new PluginHost(
      [
        {
          id: "blocker",
          hooks: {
            "tool.before": () => "block",
          },
        },
      ],
      context,
    );

    expect(
      await host.toolBefore({
        sessionID: "ses_1",
        call: { id: "call_1", name: "bash", input: { command: "rm -rf /" } },
      }),
    ).toBe("block");
  });

  it("loads a plugin module from disk", async () => {
    const directory = await tempDir();
    const file = join(directory, "plugin.mjs");
    await writeFile(file, 'export default { id: "file-plugin" };\n', "utf8");

    const host = await loadPlugins([file], { ...context, cwd: directory });
    expect(host.plugins.map((plugin) => plugin.id)).toEqual(["file-plugin"]);
  });
});
