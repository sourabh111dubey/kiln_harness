import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KilncraftError } from "@kilncraft/shared";
import { afterEach, describe, expect, it } from "vitest";
import { editTool } from "../src/tools/edit";
import { readTool } from "../src/tools/read";
import { writeTool } from "../src/tools/write";
import { makeContext, makeTempDir, removeTempDir } from "./helpers";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await makeTempDir("kilncraft-files-");
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(removeTempDir));
});

describe("file tools", () => {
  it("reads numbered lines with offset and limit", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.txt"), "one\ntwo\nthree\nfour\n");

    const output = await readTool.execute({ path: "a.txt" }, makeContext(cwd));
    expect(output.kind).toBe("text");
    if (output.kind !== "text") throw new Error("expected text output");
    expect(output.text).toContain("one");
    expect(output.text).toContain("two");

    const sliced = await readTool.execute({ path: "a.txt", offset: 2, limit: 1 }, makeContext(cwd));
    if (sliced.kind !== "text") throw new Error("expected text output");
    expect(sliced.text).toContain("three");
    expect(sliced.text).not.toContain("one");
  });

  it("rejects missing files and paths outside the workspace", async () => {
    const cwd = await tempDir();
    await expect(
      readTool.execute({ path: "missing.txt" }, makeContext(cwd)),
    ).rejects.toBeInstanceOf(KilncraftError);
    await expect(readTool.execute({ path: "../x" }, makeContext(cwd))).rejects.toBeInstanceOf(
      KilncraftError,
    );
  });

  it("writes a new file atomically and returns a diff", async () => {
    const cwd = await tempDir();
    const output = await writeTool.execute(
      { path: "src/new.ts", content: "export const value = 1;\n" },
      makeContext(cwd),
    );

    expect(output.kind).toBe("diff");
    if (output.kind !== "diff") throw new Error("expected diff output");
    expect(output.files).toEqual([{ path: "src/new.ts", status: "added" }]);
    expect(await readFile(join(cwd, "src", "new.ts"), "utf8")).toBe("export const value = 1;\n");
  });

  it("overwrites an existing file and marks it modified", async () => {
    const cwd = await tempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "old\n");

    const output = await writeTool.execute(
      { path: "src/a.ts", content: "new\n" },
      makeContext(cwd),
    );
    if (output.kind !== "diff") throw new Error("expected diff output");
    expect(output.files).toEqual([{ path: "src/a.ts", status: "modified" }]);
    expect(await readFile(join(cwd, "src", "a.ts"), "utf8")).toBe("new\n");
  });

  it("replaces a unique string", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "hello world\n");

    const output = await editTool.execute(
      { path: "a.ts", oldString: "world", newString: "there" },
      makeContext(cwd),
    );

    expect(output.kind).toBe("diff");
    expect(await readFile(join(cwd, "a.ts"), "utf8")).toBe("hello there\n");
  });

  it("refuses ambiguous edits and reports missing text", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "foo foo\n");

    const ambiguous = await editTool.execute(
      { path: "a.ts", oldString: "foo", newString: "bar" },
      makeContext(cwd),
    );
    if (ambiguous.kind !== "text") throw new Error("expected text output");
    expect(ambiguous.text).toContain("2 occurrences");

    const missing = await editTool.execute(
      { path: "a.ts", oldString: "nope", newString: "bar" },
      makeContext(cwd),
    );
    if (missing.kind !== "text") throw new Error("expected text output");
    expect(missing.text).toContain("Could not find");
  });

  it("normalizes CRLF edits", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "hello\r\nworld\r\n");

    const output = await editTool.execute(
      { path: "a.ts", oldString: "hello\nworld", newString: "hi\nthere" },
      makeContext(cwd),
    );

    expect(output.kind).toBe("diff");
    expect(await readFile(join(cwd, "a.ts"), "utf8")).toBe("hi\nthere\n");
  });

  it.skipIf(process.platform === "win32")("blocks symlinks that escape the workspace", async () => {
    const outside = await tempDir();
    const inside = await tempDir();
    await writeFile(join(outside, "secret.txt"), "secret\n");
    await symlink(join(outside, "secret.txt"), join(inside, "link.txt"));

    await expect(readTool.execute({ path: "link.txt" }, makeContext(inside))).rejects.toMatchObject(
      { code: "permission_denied" },
    );
  });

  it("supports replaceAll", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "foo foo\n");

    await editTool.execute(
      { path: "a.ts", oldString: "foo", newString: "bar", replaceAll: true },
      makeContext(cwd),
    );
    expect(await readFile(join(cwd, "a.ts"), "utf8")).toBe("bar bar\n");
  });
});
