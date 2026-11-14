import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { formatDoctor, runDoctor } from "../src/commands/doctor";

const temporaryDirectories: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kiln-doctor-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("doctor", () => {
  it("reports environment checks", async () => {
    const directory = await makeTempDir();
    const result = await runDoctor({
      cwd: directory,
      globalPath: join(directory, "missing.json"),
      env: {},
    });

    const names = result.checks.map((check) => check.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Node.js",
        "Platform",
        "Config",
        "Git",
        "Ripgrep",
        "Sandbox",
        "Telemetry",
      ]),
    );
    expect(result.checks.find((check) => check.name === "Config")?.status).toBe("warn");
    expect(result.checks.find((check) => check.name === "Telemetry")?.detail).toContain("disabled");
  });

  it("formats checks without ANSI codes when NO_COLOR is set", async () => {
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      const directory = await makeTempDir();
      const result = await runDoctor({
        cwd: directory,
        globalPath: join(directory, "missing.json"),
        env: {},
      });
      const formatted = formatDoctor(result);
      expect(stripVTControlCharacters(formatted)).toBe(formatted);
      expect(formatted).toContain("Node.js");
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previous;
    }
  });
});
