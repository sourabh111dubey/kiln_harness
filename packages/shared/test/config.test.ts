import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configJsonSchema,
  deepMerge,
  defaultConfig,
  loadConfig,
  mergeConfigs,
} from "../src/config";

const temporaryDirectories: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "harness-config-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeProjectConfig(directory: string, contents: string): Promise<string> {
  const path = join(directory, ".harness", "config.json");
  await mkdir(join(directory, ".harness"), { recursive: true });
  await writeFile(path, contents, "utf8");
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("config", () => {
  it("parses defaults", () => {
    expect(defaultConfig.agent).toBe("build");
    expect(defaultConfig.permissions.default).toBe("default");
    expect(defaultConfig.sandbox).toEqual({ enabled: true, network: false });
    expect(defaultConfig.telemetry.enabled).toBe(false);
  });

  it("merges global, project, and env sources in order", async () => {
    const directory = await makeTempDir();
    const globalPath = join(directory, "global.json");
    const projectPath = await writeProjectConfig(
      directory,
      JSON.stringify({ model: "project/model" }),
    );

    await writeFile(globalPath, JSON.stringify({ model: "global/model", agent: "plan" }));

    const loaded = await loadConfig({
      cwd: directory,
      globalPath,
      env: { HARNESS_PERMISSION_MODE: "acceptEdits" },
    });

    expect(loaded.config.model).toBe("project/model");
    expect(loaded.config.agent).toBe("plan");
    expect(loaded.config.permissions.default).toBe("acceptEdits");
    expect(loaded.sources).toEqual([globalPath, projectPath]);
  });

  it("accepts JSONC comments and trailing commas", async () => {
    const directory = await makeTempDir();
    await writeProjectConfig(directory, '{\n  // model override\n  "model": "acme/model",\n}\n');

    const loaded = await loadConfig({
      cwd: directory,
      globalPath: join(directory, "missing.json"),
    });
    expect(loaded.config.model).toBe("acme/model");
  });

  it("rejects invalid JSON", async () => {
    const directory = await makeTempDir();
    await writeProjectConfig(directory, "{ nope");

    await expect(
      loadConfig({ cwd: directory, globalPath: join(directory, "missing.json") }),
    ).rejects.toMatchObject({ code: "invalid_config" });
  });

  it("ignores security-sensitive project config fields", async () => {
    const directory = await makeTempDir();
    await writeProjectConfig(
      directory,
      JSON.stringify({
        model: "project/model",
        permissions: { default: "bypassPermissions" },
        sandbox: { enabled: false },
        plugins: ["./evil.ts"],
      }),
    );

    const loaded = await loadConfig({
      cwd: directory,
      globalPath: join(directory, "missing.json"),
    });

    expect(loaded.config.model).toBe("project/model");
    expect(loaded.config.permissions.default).toBe("default");
    expect(loaded.config.sandbox.enabled).toBe(true);
    expect(loaded.config.plugins).toEqual([]);
  });

  it("applies every supported environment override", async () => {
    const directory = await makeTempDir();
    const loaded = await loadConfig({
      cwd: directory,
      globalPath: join(directory, "missing.json"),
      env: {
        HARNESS_MODEL: "env/model",
        HARNESS_SMALL_MODEL: "env/small",
        HARNESS_AGENT: "plan",
        HARNESS_PERMISSION_MODE: "bypassPermissions",
        HARNESS_TELEMETRY: "true",
      },
    });

    expect(loaded.config.model).toBe("env/model");
    expect(loaded.config.smallModel).toBe("env/small");
    expect(loaded.config.agent).toBe("plan");
    expect(loaded.config.permissions.default).toBe("bypassPermissions");
    expect(loaded.config.telemetry.enabled).toBe(true);
  });

  it("rejects invalid permission modes in trusted global config", async () => {
    const directory = await makeTempDir();
    const globalPath = join(directory, "global.json");
    await writeFile(globalPath, JSON.stringify({ permissions: { default: "nope" } }), "utf8");

    await expect(loadConfig({ cwd: directory, globalPath })).rejects.toMatchObject({
      code: "invalid_config",
    });
  });

  it("reports unreadable config paths", async () => {
    const directory = await makeTempDir();
    const configPath = join(directory, ".harness", "config.json");
    await mkdir(configPath, { recursive: true });

    await expect(
      loadConfig({ cwd: directory, globalPath: join(directory, "missing.json") }),
    ).rejects.toMatchObject({ code: "io_error" });
  });

  it("deep merges plain objects but replaces arrays", () => {
    const merged = deepMerge(
      { permissions: { default: "default", rules: [{ tool: "bash" }] }, plugins: ["a"] },
      { permissions: { default: "plan" }, plugins: ["b"] },
    );
    expect(merged).toEqual({
      permissions: { default: "plan", rules: [{ tool: "bash" }] },
      plugins: ["b"],
    });
    expect(mergeConfigs({ a: 1 }, { b: 2 }, { a: 3 })).toEqual({ a: 3, b: 2 });
  });

  it("exports a JSON schema for editors", () => {
    expect(configJsonSchema).toMatchObject({ type: "object" });
  });
});
