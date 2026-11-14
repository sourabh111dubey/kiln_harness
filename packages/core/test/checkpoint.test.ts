import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CheckpointManager } from "../src/session/checkpoint";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "harness-checkpoint-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("checkpoint manager", () => {
  it("snapshots and restores a file", async () => {
    const dataDir = await tempDir();
    const workspace = await tempDir();
    const file = join(workspace, "a.txt");
    await writeFile(file, "original\n", "utf8");

    const manager = new CheckpointManager(dataDir);
    const checkpoint = manager.snapshot("ses_test", file);
    expect(checkpoint).toBeDefined();

    await writeFile(file, "changed\n", "utf8");
    expect(manager.list("ses_test")).toHaveLength(1);
    expect(manager.restoreLatest("ses_test")).toBe(1);
    expect(await readFile(file, "utf8")).toBe("original\n");
  });

  it("returns undefined for missing files and checkpoints", async () => {
    const manager = new CheckpointManager(await tempDir());
    expect(manager.snapshot("ses_test", "/tmp/does-not-exist")).toBeUndefined();
    expect(manager.latest("ses_test")).toBeUndefined();
    expect(manager.restoreLatest("ses_test")).toBe(0);
  });
});
