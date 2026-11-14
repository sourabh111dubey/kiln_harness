import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertInsideWorkspace,
  atomicWrite,
  diffText,
  escapeRegExp,
  fileExists,
  globToRegExp,
  isBinary,
  isPathInside,
  lineNumbered,
  matchesGlob,
  resolveWorkspacePath,
  toolOutputToText,
  truncateText,
  walkFiles,
} from "../src/tools/common";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kilncraft-common-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("tool utilities", () => {
  it("resolves and confines paths", () => {
    const cwd = "/tmp/workspace";
    expect(resolveWorkspacePath(cwd, "src/a.ts")).toBe(resolve(cwd, "src/a.ts"));
    expect(isPathInside(cwd, resolve(cwd, "src"))).toBe(true);
    expect(isPathInside(cwd, resolve(cwd, "../other"))).toBe(false);
    expect(() => assertInsideWorkspace(cwd, resolve(cwd, "../other"))).toThrow(
      "outside the workspace",
    );
  });

  it("formats line numbers and truncates output", () => {
    expect(lineNumbered("a\nb", 1)).toBe("    1\ta\n    2\tb");
    const truncated = truncateText("x".repeat(20), 10);
    expect(truncated.truncated).toBe(true);
    expect(truncated.text).toContain("truncated at 10");
  });

  it("creates a unified diff", () => {
    const diff = diffText("a.ts", "one\n", "two\n");
    expect(diff).toContain("--- a.ts");
    expect(diff).toContain("+++ a.ts");
    expect(diff).toContain("-one");
    expect(diff).toContain("+two");
  });

  it("writes atomically and reports existence", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "nested", "file.txt");
    await atomicWrite(path, "content");
    expect(await readFile(path, "utf8")).toBe("content");
    expect(await fileExists(path)).toBe(true);
    expect(await fileExists(join(cwd, "missing"))).toBe(false);
  });

  it("walks files and skips ignored directories", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "a");
    await writeFile(join(cwd, "node_modules", "x.ts"), "x").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(cwd, "node_modules"), { recursive: true });
      await writeFile(join(cwd, "node_modules", "x.ts"), "x");
    });

    const files: string[] = [];
    for await (const file of walkFiles(cwd)) files.push(file);
    expect(files).toContain("a.ts");
    expect(files).not.toContain(join("node_modules", "x.ts"));
  });

  it("converts glob patterns", () => {
    expect(matchesGlob("src/a.ts", "src/*.ts")).toBe(true);
    expect(matchesGlob("src/nested/a.ts", "src/*.ts")).toBe(false);
    expect(matchesGlob("src/nested/a.ts", "src/**/*.ts")).toBe(true);
    expect(globToRegExp("a?").test("ab")).toBe(true);
    expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
  });

  it("detects binary buffers", () => {
    expect(isBinary(Buffer.from([0x61, 0x00, 0x62]))).toBe(true);
    expect(isBinary(Buffer.from("hello"))).toBe(false);
  });

  it("renders every tool output kind", () => {
    expect(toolOutputToText({ kind: "text", text: "hello" })).toBe("hello");
    expect(toolOutputToText({ kind: "json", value: { a: 1 } })).toContain('"a": 1');
    expect(toolOutputToText({ kind: "diff", diff: "patch", files: [] })).toBe("patch");
    expect(toolOutputToText({ kind: "image", mime: "image/png", data: "x" })).toContain(
      "image/png",
    );
    expect(
      toolOutputToText({ kind: "terminal", stdout: "out", stderr: "err", exitCode: 2 }),
    ).toContain("[exit code 2]");
    expect(toolOutputToText({ kind: "structured", schema: "x", value: { a: 1 } })).toContain(
      '"a": 1',
    );
  });
});
