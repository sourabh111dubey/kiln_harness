import { afterEach, describe, expect, it } from "vitest";
import { bashTool } from "../src/tools/bash";
import { formatTodos, todoTool } from "../src/tools/todo";
import { makeContext, makeTempDir, removeTempDir } from "./helpers";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await makeTempDir("harness-shell-");
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(removeTempDir));
});

describe.skipIf(process.platform === "win32")("bash tool", () => {
  it("captures stdout and exit code", async () => {
    const cwd = await tempDir();
    const output = await bashTool.execute({ command: "printf hello" }, makeContext(cwd));

    expect(output).toMatchObject({ kind: "terminal", stdout: "hello", exitCode: 0 });
  });

  it("captures stderr and non-zero exit codes", async () => {
    const cwd = await tempDir();
    const output = await bashTool.execute({ command: "printf oops >&2; exit 3" }, makeContext(cwd));

    expect(output).toMatchObject({ kind: "terminal", stderr: "oops", exitCode: 3 });
  });

  it("times out long commands", async () => {
    const cwd = await tempDir();
    const output = await bashTool.execute({ command: "sleep 5", timeout: 100 }, makeContext(cwd));

    expect(output.kind).toBe("terminal");
    if (output.kind !== "terminal") throw new Error("expected terminal output");
    expect(output.stderr).toContain("timed out");
    expect(output.exitCode).not.toBe(0);
  });

  it("refuses commands outside the workspace", async () => {
    const cwd = await tempDir();
    await expect(
      bashTool.execute({ command: "pwd", cwd: "../outside" }, makeContext(cwd)),
    ).rejects.toThrow("outside the workspace");
  });
});

describe("todo tool", () => {
  it("stores and formats the checklist", async () => {
    const cwd = await tempDir();
    const context = makeContext(cwd);
    const todos = [
      { content: "First", status: "completed" as const },
      { content: "Second", status: "in_progress" as const },
      { content: "Third", status: "pending" as const },
    ];

    const output = await todoTool.execute({ todos }, context);
    if (output.kind !== "text") throw new Error("expected text output");

    expect(output.text).toContain("[x] First");
    expect(output.text).toContain("[~] Second");
    expect(output.text).toContain("[ ] Third");
    expect(context.state.todos).toEqual(todos);
    expect(formatTodos([])).toBe("(no todos)");
  });
});
