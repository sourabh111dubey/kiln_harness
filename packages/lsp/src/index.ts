import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  KilnError,
  type LspDiagnosticLike,
  type LspManagerLike,
  type LspSymbolLike,
} from "@kiln/shared";
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";

export interface LspServerConfig {
  command: string;
  args?: string[];
  languageId: string;
  extensions: string[];
}

interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: LspDiagnosticLike[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new KilnError("io_error", `${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toUri(path: string): string {
  return pathToFileURL(path).href;
}

function fromUri(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

export class LspClient {
  private connection?: MessageConnection;
  private child?: ChildProcessWithoutNullStreams;
  private readonly diagnostics = new Map<string, LspDiagnosticLike[]>();
  private readonly open = new Set<string>();
  private version = 0;

  constructor(
    private readonly config: LspServerConfig,
    private readonly root: string,
  ) {}

  async start(): Promise<void> {
    const child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.root,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    if (!child.stdout || !child.stdin) {
      child.kill();
      throw new KilnError("io_error", `LSP server ${this.config.command} has no stdio`);
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new KilnError("io_error", `LSP server ${this.config.command} failed to spawn`));
      }, 5_000);
      child.once("spawn", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    this.child = child;
    child.stderr?.resume();

    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    this.connection = connection;

    connection.onClose(() => {
      this.connection = undefined;
    });

    connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: PublishDiagnosticsParams) => {
        this.diagnostics.set(params.uri, params.diagnostics ?? []);
      },
    );

    connection.listen();

    try {
      await withTimeout(
        connection.sendRequest("initialize", {
          processId: process.pid,
          rootUri: toUri(this.root),
          capabilities: {
            textDocument: {
              synchronization: { dynamicRegistration: true },
              publishDiagnostics: { relatedInformation: true },
            },
            workspace: { configuration: true, workspaceFolders: true },
          },
          workspaceFolders: [{ uri: toUri(this.root), name: "workspace" }],
        }),
        10_000,
        "LSP initialize",
      );
      await connection.sendNotification("initialized", {});
    } catch (error) {
      await this.shutdown().catch(() => undefined);
      throw error;
    }
  }

  async didOpen(path: string, text: string): Promise<void> {
    if (!this.connection) return;
    const uri = toUri(path);
    this.version++;

    if (this.open.has(uri)) {
      await this.connection.sendNotification("textDocument/didChange", {
        textDocument: { uri, version: this.version },
        contentChanges: [{ text }],
      });
    } else {
      await this.connection.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: this.config.languageId,
          version: this.version,
          text,
        },
      });
      this.open.add(uri);
    }

    const deadline = Date.now() + 2_000;
    while (!this.diagnostics.has(uri) && Date.now() < deadline) {
      await delay(50);
    }
  }

  diagnosticsFor(path: string): LspDiagnosticLike[] {
    return this.diagnostics.get(toUri(path)) ?? [];
  }

  async symbolsFor(path: string): Promise<LspSymbolLike[]> {
    if (!this.connection) return [];
    try {
      const result = await this.connection.sendRequest("textDocument/documentSymbol", {
        textDocument: { uri: toUri(path) },
      });
      return Array.isArray(result) ? (result as LspSymbolLike[]) : [];
    } catch {
      return [];
    }
  }

  async shutdown(): Promise<void> {
    if (!this.connection) return;
    const connection = this.connection;
    this.connection = undefined;
    try {
      await withTimeout(connection.sendRequest("shutdown"), 2_000, "LSP shutdown");
      await withTimeout(connection.sendNotification("exit"), 1_000, "LSP exit");
    } catch {
      // The server may already be gone.
    } finally {
      connection.dispose();
      this.child?.kill();
    }
  }

  get rootPath(): string {
    return this.root;
  }

  get diagnosticUris(): string[] {
    return [...this.diagnostics.keys()].map(fromUri);
  }
}

export function findServerForPath(
  servers: Record<string, LspServerConfig>,
  path: string,
): { key: string; config: LspServerConfig } | undefined {
  const extension = extname(path).toLowerCase();
  for (const [key, config] of Object.entries(servers)) {
    const extensions = config.extensions.map((entry) => entry.toLowerCase());
    if (extensions.includes(extension)) return { key, config };
  }
  return undefined;
}

export class LspManager implements LspManagerLike {
  private readonly clients = new Map<string, Promise<LspClient>>();

  constructor(
    private readonly servers: Record<string, LspServerConfig>,
    private readonly root: string,
  ) {}

  private async clientFor(path: string): Promise<LspClient> {
    const match = findServerForPath(this.servers, path);
    if (!match) {
      throw new KilnError("tool_error", `No LSP server configured for ${path}`, {
        hint: "Add an lsp.servers entry for this file extension.",
      });
    }

    const existing = this.clients.get(match.key);
    if (existing) return existing;

    const client = new LspClient(match.config, this.root);
    const started = client.start().then(() => client);
    this.clients.set(match.key, started);
    try {
      return await started;
    } catch (error) {
      this.clients.delete(match.key);
      throw error;
    }
  }

  async diagnosticsFor(path: string): Promise<LspDiagnosticLike[]> {
    const client = await this.clientFor(path);
    const text = await readFile(path, "utf8");
    await client.didOpen(path, text);
    return client.diagnosticsFor(path);
  }

  async symbolsFor(path: string): Promise<LspSymbolLike[]> {
    const client = await this.clientFor(path);
    const text = await readFile(path, "utf8");
    await client.didOpen(path, text);
    return client.symbolsFor(path);
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.clients.values()].map((client) =>
        client.then((instance) => instance.shutdown()).catch(() => undefined),
      ),
    );
    this.clients.clear();
  }
}
