import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { globTool } from "../src/tools/glob";
import { grepTool } from "../src/tools/grep";
import { lsTool } from "../src/tools/ls";
import { makeContext, makeTempDir, removeTempDir } from "./helpers";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await makeTempDir("harness-search-");
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(removeTempDir));
});

describe("search tools", () => {
  it("finds files by glob and ignores node_modules", async () => {
    const cwd = await tempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await mkdir(join(cwd, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "export {};\n");
    await writeFile(join(cwd, "src", "b.js"), "export {};\n");
    await writeFile(join(cwd, "node_modules", "pkg", "ignored.ts"), "export {};\n");

    const output = await globTool.execute({ pattern: "**/*.ts" }, makeContext(cwd));
    if (output.kind !== "text") throw new Error("expected text output");
    expect(output.text).toContain("src/a.ts");
    expect(output.text).not.toContain("node_modules");
    expect(output.text).not.toContain("src/b.js");
  });

  it("searches contents case-insensitively with line numbers", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.txt"), "foo bar\nbaz FOO\nnothing\n");

    const output = await grepTool.execute({ pattern: "foo" }, makeContext(cwd));
    if (output.kind !== "text") throw new Error("expected text output");
    expect(output.text).toContain("a.txt:1");
    expect(output.text).toContain("a.txt:2");

    const sensitive = await grepTool.execute(
      { pattern: "foo", caseSensitive: true },
      makeContext(cwd),
    );
    if (sensitive.kind !== "text") throw new Error("expected text output");
    expect(sensitive.text).toContain("a.txt:1");
    expect(sensitive.text).not.toContain("a.txt:2");
  });

  it("reports no matches and invalid regexes", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.txt"), "hello\n");

    const none = await grepTool.execute({ pattern: "zzz" }, makeContext(cwd));
    if (none.kind !== "text") throw new Error("expected text output");
    expect(none.text).toContain("No matches found");

    const invalid = await grepTool.execute({ pattern: "[" }, makeContext(cwd));
    if (invalid.kind !== "text") throw new Error("expected text output");
    expect(invalid.text).toContain("Invalid regular expression");
  });

  it("lists a directory tree up to the requested depth", async () => {
    const cwd = await tempDir();
    await mkdir(join(cwd, "src", "nested"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "export {};\n");
    await writeFile(join(cwd, "src", "nested", "deep.ts"), "export {};\n");

    const shallow = await lsTool.execute({ depth: 1 }, makeContext(cwd));
    if (shallow.kind !== "text") throw new Error("expected text output");
    expect(shallow.text).toContain("src/");
    expect(shallow.text).toContain("a.ts");
    expect(shallow.text).not.toContain("deep.ts");

    const deep = await lsTool.execute({ depth: 3 }, makeContext(cwd));
    if (deep.kind !== "text") throw new Error("expected text output");
    expect(deep.text).toContain("deep.ts");
  });
});
