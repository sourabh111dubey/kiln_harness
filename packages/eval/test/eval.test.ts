import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkExpectedFiles,
  parseJsonl,
  SweBenchAdapter,
  scoreResults,
  type TaskResult,
  TerminalBenchAdapter,
} from "../src/index";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kilncraft-eval-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("eval helpers", () => {
  it("checks expected file contents", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.txt"), "hello\n");
    const task = {
      id: "t1",
      prompt: "write",
      expectedFiles: { "a.txt": "hello\n", "missing.txt": "nope" },
    };

    expect(await checkExpectedFiles(task, cwd)).toEqual(["missing.txt: missing"]);
    expect(
      await checkExpectedFiles(
        { id: "t2", prompt: "ok", expectedFiles: { "a.txt": "hello\n" } },
        cwd,
      ),
    ).toEqual([]);
  });

  it("scores results", () => {
    const results: TaskResult[] = [
      {
        id: "a",
        passed: true,
        failures: [],
        text: "",
        cost: 0.1,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: "b",
        passed: false,
        failures: ["x"],
        text: "",
        cost: 0.2,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      },
    ];
    const score = scoreResults(results);
    expect(score.total).toBe(2);
    expect(score.passed).toBe(1);
    expect(score.failed).toBe(1);
    expect(score.rate).toBe(0.5);
    expect(score.cost).toBeCloseTo(0.3, 10);
  });

  it("maps benchmark rows", () => {
    const swe = new SweBenchAdapter().fromRows([
      { instance_id: "repo__1", problem_statement: "fix it", repo: "acme/repo" },
    ]);
    expect(swe[0]).toMatchObject({ id: "repo__1", tags: ["swe-bench-lite"] });
    expect(swe[0]?.prompt).toContain("fix it");

    const terminal = new TerminalBenchAdapter().fromRows([
      { instance_id: "t1", instruction: "run tests" },
    ]);
    expect(terminal[0]?.prompt).toBe("run tests");
  });

  it("parses JSONL safely", () => {
    expect(parseJsonl('{"a":1}\nnot json\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
