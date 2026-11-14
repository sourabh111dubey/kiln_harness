import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLog, hashInput, summarizeInput } from "../src/session/audit";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kilncraft-audit-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("audit log", () => {
  it("records and reads permission decisions", async () => {
    const directory = await tempDir();
    const log = new AuditLog(join(directory, "audit.jsonl"));

    log.record({
      sessionID: "ses_test",
      tool: "write",
      decision: "allow",
      cwd: "/tmp/project",
      inputHash: "abc",
      summary: "a.txt",
    });

    const entries = log.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      sessionID: "ses_test",
      tool: "write",
      decision: "allow",
      summary: "a.txt",
    });
    expect(entries[0]?.timestamp).toMatch(/^\d{4}-/);
  });

  it("returns an empty list when the log is missing", async () => {
    const log = new AuditLog(join(await tempDir(), "missing.jsonl"));
    expect(log.read()).toEqual([]);
  });

  it("hashes input deterministically", () => {
    expect(hashInput({ b: 2, a: 1 })).toBe(hashInput({ a: 1, b: 2 }));
    expect(hashInput({ a: 1 })).not.toBe(hashInput({ a: 2 }));
  });

  it("summarizes path and command inputs", () => {
    expect(summarizeInput({ path: "src/a.ts" })).toBe("src/a.ts");
    expect(summarizeInput({ command: "npm test" })).toBe("npm test");
    expect(summarizeInput("plain")).toBe('"plain"');
  });
});
