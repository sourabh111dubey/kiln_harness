import { type Dirent, existsSync } from "node:fs";
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { HarnessError, type ToolOutput, toHarnessError } from "@harness/shared";
import { createTwoFilesPatch } from "diff";

export const DEFAULT_IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".harness",
  ".next",
  ".nuxt",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
]);

export const GLOB_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/.harness/**",
  "**/.next/**",
  "**/target/**",
  "**/vendor/**",
  "**/__pycache__/**",
  "**/.venv/**",
];

export function resolveWorkspacePath(cwd: string, inputPath: string): string {
  return resolve(cwd, inputPath);
}

export function isPathInside(cwd: string, target: string): boolean {
  const rel = relative(cwd, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertInsideWorkspace(cwd: string, target: string): void {
  if (!isPathInside(cwd, target)) {
    throw new HarnessError("permission_denied", `Path ${target} is outside the workspace ${cwd}`, {
      details: { cwd, target },
      recoverable: false,
    });
  }
}

export async function assertRealInside(cwd: string, target: string): Promise<void> {
  const realCwd = await realpath(cwd).catch(() => cwd);

  let realTarget: string;
  try {
    realTarget = await realpath(target);
  } catch {
    const realParent = await realpath(dirname(target)).catch(() => undefined);
    if (!realParent) return;
    realTarget = join(realParent, basename(target));
  }

  if (!isPathInside(realCwd, realTarget)) {
    throw new HarnessError(
      "permission_denied",
      `Path ${target} resolves outside the workspace ${cwd}`,
      { details: { cwd, target, realTarget }, recoverable: false },
    );
  }
}

export function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8_000).includes(0);
}

export async function readTextFile(path: string, maxBytes = 2_000_000): Promise<string> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch (error) {
    throw toHarnessError(error, "io_error");
  }

  if (!info.isFile()) {
    throw new HarnessError("io_error", `Not a file: ${path}`);
  }
  if (info.size > maxBytes) {
    throw new HarnessError("io_error", `File is too large: ${path} (${info.size} bytes)`, {
      details: { path, size: info.size, maxBytes },
    });
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (error) {
    throw toHarnessError(error, "io_error");
  }

  if (isBinary(buffer)) {
    throw new HarnessError("io_error", `File appears to be binary: ${path}`);
  }
  return buffer.toString("utf8");
}

export function lineNumbered(content: string, startLine = 1): string {
  return content
    .split("\n")
    .map((line, index) => `${String(startLine + index).padStart(5, " ")}\t${line}`)
    .join("\n");
}

export function truncateText(
  text: string,
  maxChars = 30_000,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n\n[output truncated at ${maxChars} characters]`,
    truncated: true,
  };
}

export function diffText(path: string, before: string, after: string): string {
  return createTwoFilesPatch(path, path, before, after, undefined, undefined, { context: 3 });
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.harness-tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, "utf8");
  try {
    await rename(temporary, path);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "EPERM" ||
      (error as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      const backup = `${path}.harness-bak-${process.pid}-${Date.now()}`;
      if (existsSync(path)) await rename(path, backup);
      try {
        await rename(temporary, path);
      } catch (renameError) {
        if (existsSync(backup)) await rename(backup, path);
        await rm(temporary, { force: true });
        throw renameError;
      }
      await rm(backup, { force: true });
      return;
    }
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

export async function* walkFiles(
  root: string,
  options: { maxDepth?: number; ignore?: Set<string> } = {},
): AsyncGenerator<string> {
  const ignore = new Set([...DEFAULT_IGNORE, ...(options.ignore ?? [])]);
  const maxDepth = options.maxDepth ?? 12;

  async function* walk(directory: string, depth: number): AsyncGenerator<string> {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        yield* walk(full, depth + 1);
      } else if (entry.isFile()) {
        yield relative(root, full);
      }
    }
  }

  yield* walk(root, 0);
}

export function globToRegExp(pattern: string): RegExp {
  const globstar = "__GLOBSTAR__";
  const globstarSlash = "__GLOBSTAR_SLASH__";
  const escaped = pattern
    .replace(/\*\*\//g, globstarSlash)
    .replace(/\*\*/g, globstar)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(new RegExp(globstarSlash, "g"), "(?:.*/)?")
    .replace(new RegExp(globstar, "g"), ".*");
  return new RegExp(`^${escaped}$`);
}

export function matchesGlob(value: string, pattern: string): boolean {
  try {
    return globToRegExp(pattern).test(value);
  } catch {
    return false;
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function toolOutputToText(output: ToolOutput): string {
  switch (output.kind) {
    case "text":
      return output.text;
    case "json":
      return JSON.stringify(output.value, null, 2);
    case "diff":
      return output.diff || "(no diff)";
    case "image":
      return `[image ${output.mime} attached]`;
    case "terminal": {
      const parts: string[] = [];
      if (output.stdout) parts.push(output.stdout);
      if (output.stderr) parts.push(output.stderr);
      if (output.exitCode !== 0) parts.push(`[exit code ${output.exitCode}]`);
      return parts.join("\n") || "(no output)";
    }
    case "structured":
      return JSON.stringify(output.value, null, 2);
  }
}
