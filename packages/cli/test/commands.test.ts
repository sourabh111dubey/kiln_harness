import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "@kilncraft/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../src/index";

const { startServerMock, startMcpStdioServerMock } = vi.hoisted(() => ({
  startServerMock: vi.fn(),
  startMcpStdioServerMock: vi.fn(),
}));

vi.mock("@kilncraft/server", () => ({
  startServer: startServerMock,
}));

vi.mock("@kilncraft/mcp", () => ({
  startMcpStdioServer: startMcpStdioServerMock,
}));

const directories: string[] = [];
let dataDir = "";
let configDir = "";
const previousEnv: Record<string, string | undefined> = {};

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function runCli(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}> {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.exitCode = 0;

  const program = createProgram();
  await program.parseAsync(["node", "kilncraft", ...args]);

  const result = {
    stdout: stdout.mock.calls.flat().join(""),
    stderr: stderr.mock.calls.flat().join(""),
    exitCode: process.exitCode,
  };

  stdout.mockRestore();
  stderr.mockRestore();
  return result;
}

beforeEach(async () => {
  dataDir = await makeTempDir("kilncraft-cli-data-");
  configDir = await makeTempDir("kilncraft-cli-config-");
  for (const key of ["KILNCRAFT_DATA_DIR", "KILNCRAFT_CONFIG_DIR"]) {
    previousEnv[key] = process.env[key];
    process.env[key] = key === "KILNCRAFT_DATA_DIR" ? dataDir : configDir;
  }
  startServerMock.mockReset();
  startServerMock.mockResolvedValue({
    url: "http://127.0.0.1:1234",
    close: async () => undefined,
  });
  startMcpStdioServerMock.mockReset();
  startMcpStdioServerMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("cli commands", () => {
  it("prints config path, schema, and values", async () => {
    const path = await runCli(["config", "path"]);
    expect(path.stdout).toContain("config.json");

    const schema = await runCli(["config", "schema"]);
    expect(schema.stdout).toContain("$schema");

    const value = await runCli(["config", "get", "agent"]);
    expect(value.stdout).toContain("build");
  });

  it("lists models and the default model", async () => {
    const list = await runCli(["models", "list"]);
    expect(list.stdout).toContain("anthropic/claude-sonnet-4-5");

    const fallback = await runCli(["models", "default"]);
    expect(fallback.stdout).toContain("undefined");
  });

  it("lists, shows, searches, exports, and deletes sessions", async () => {
    const empty = await runCli(["sessions", "list"]);
    expect(empty.stdout).toContain("(no sessions)");

    const store = new SessionStore({ dataDir });
    const session = store.create({ cwd: dataDir, model: "fake/test", title: "CLI session" });
    store.appendMessage(session.id, { role: "user", content: "needle" });
    store.close();

    const listed = await runCli(["sessions", "list"]);
    expect(listed.stdout).toContain(session.id);

    const shown = await runCli(["sessions", "show", session.id]);
    expect(shown.stdout).toContain("CLI session");

    const searched = await runCli(["sessions", "search", "needle"]);
    expect(searched.stdout).toContain(session.id);

    const exported = await runCli(["sessions", "export", session.id, "--format", "md"]);
    expect(exported.stdout).toContain("# CLI session");

    const exportedJson = await runCli(["sessions", "export", session.id]);
    expect(exportedJson.stdout).toContain('"session"');

    const compacted = await runCli(["sessions", "compact", session.id]);
    expect(compacted.stdout).toContain("Compacted");

    const forked = await runCli(["sessions", "fork", session.id]);
    expect(forked.stdout).toMatch(/^ses_/);

    const forkMissing = await runCli(["sessions", "fork", "ses_missing"]);
    expect(forkMissing.exitCode).toBe(1);
    expect(forkMissing.stderr).toContain("not found");

    const deleted = await runCli(["sessions", "delete", session.id]);
    expect(deleted.stdout).toContain("deleted");
  });

  it("reports missing sessions", async () => {
    for (const args of [
      ["sessions", "show", "ses_missing"],
      ["sessions", "export", "ses_missing"],
      ["sessions", "compact", "ses_missing"],
    ]) {
      const result = await runCli(args);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not found");
    }

    const deleted = await runCli(["sessions", "delete", "ses_missing"]);
    expect(deleted.stdout).toContain("not found");
  });

  it("lists MCP servers and starts the stdio server", async () => {
    const result = await runCli(["mcp", "list"]);
    expect(result.stdout).toContain("(no MCP servers configured)");

    const served = await runCli(["mcp", "serve", "--allow-destructive"]);
    expect(served.stderr).toContain("ready on stdio");
    expect(startMcpStdioServerMock).toHaveBeenCalledWith(expect.any(Array), {
      allowDestructive: true,
    });

    await runCli(["mcp", "serve"]);
    expect(startMcpStdioServerMock).toHaveBeenLastCalledWith(expect.any(Array), {
      allowDestructive: false,
    });
  });

  it("validates run input and permission modes", async () => {
    const noPrompt = await runCli(["run"]);
    expect(noPrompt.exitCode).toBe(2);
    expect(noPrompt.stderr).toContain("No prompt");

    const badMode = await runCli(["run", "hi", "--permission-mode", "nope"]);
    expect(badMode.exitCode).toBe(2);
    expect(badMode.stderr).toContain("Invalid permission mode");

    const badModel = await runCli(["run", "hi", "--model", "nope"]);
    expect(badModel.exitCode).toBe(1);
    expect(badModel.stderr).toContain("Invalid model reference");

    const noProvider = await runCli(["run", "hi", "--model", "anthropic/x"]);
    expect(noProvider.exitCode).toBe(1);
    expect(noProvider.stderr).toContain("Provider");
  });

  it("starts the server and validates the port", async () => {
    const started = await runCli(["serve", "--port", "0"]);
    expect(started.stdout).toContain("serving at");
    expect(startServerMock).toHaveBeenCalled();

    const result = await runCli(["serve", "--port", "99999"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Invalid port");
  });

  it("validates undo and prints audit entries", async () => {
    const undo = await runCli(["undo"]);
    expect(undo.exitCode).toBe(2);
    expect(undo.stderr).toContain("Provide --session");

    const audit = await runCli(["audit"]);
    expect(audit.stdout).toContain("(no audit entries)");
  });
});
