import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { formatDoctor, runDoctor } from "../src/commands/doctor";

const temporaryDirectories: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kilncraft-doctor-"));
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

  it("reports valid config, invalid config, and telemetry opt-in", async () => {
    const validDir = await makeTempDir();
    const globalPath = join(validDir, "global.json");
    await writeFile(globalPath, JSON.stringify({ model: "acme/model" }), "utf8");

    const valid = await runDoctor({
      cwd: validDir,
      globalPath,
      env: { KILNCRAFT_TELEMETRY: "1" },
    });
    expect(valid.checks.find((check) => check.name === "Config")?.status).toBe("ok");
    expect(valid.checks.find((check) => check.name === "Telemetry")?.detail).toContain("enabled");

    const invalidDir = await makeTempDir();
    const invalidPath = join(invalidDir, "global.json");
    await writeFile(invalidPath, "{ nope", "utf8");
    const invalid = await runDoctor({ cwd: invalidDir, globalPath: invalidPath, env: {} });
    expect(invalid.checks.find((check) => check.name === "Config")?.status).toBe("fail");
    expect(formatDoctor(invalid)).toContain("✗");
    expect(formatDoctor(valid)).toContain("✓");
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
