import { describe, expect, it } from "vitest";
import { findServerForPath, LspClient, LspManager, type LspServerConfig } from "../src/index";

const servers: Record<string, LspServerConfig> = {
  typescript: {
    command: "typescript-language-server",
    args: ["--stdio"],
    languageId: "typescript",
    extensions: [".ts", ".tsx"],
  },
  python: {
    command: "pyright-langserver",
    args: ["--stdio"],
    languageId: "python",
    extensions: [".py"],
  },
};

describe("LSP manager", () => {
  it("finds a server by extension", () => {
    expect(findServerForPath(servers, "src/a.ts")?.key).toBe("typescript");
    expect(findServerForPath(servers, "src/a.py")?.key).toBe("python");
    expect(findServerForPath(servers, "src/a.rs")).toBeUndefined();
  });

  it("reports missing servers instead of crashing", async () => {
    const manager = new LspManager(servers, process.cwd());
    await expect(manager.diagnosticsFor("src/a.rs")).rejects.toMatchObject({
      code: "tool_error",
    });
  });

  it("starts with no diagnostics", () => {
    const typescript = servers.typescript;
    if (!typescript) throw new Error("missing typescript fixture");
    const client = new LspClient(typescript, process.cwd());
    expect(client.diagnosticsFor("src/a.ts")).toEqual([]);
    expect(client.diagnosticUris).toEqual([]);
  });
});
