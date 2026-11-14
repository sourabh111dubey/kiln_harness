import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  type ChatMessage,
  emptyUsage,
  HarnessError,
  type HarnessEvent,
  harnessEventSchema,
  ids,
  isPrefixedId,
  type Session,
  toHarnessError,
} from "@harness/shared";

const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
const DatabaseSync = sqlite.DatabaseSync;

export interface CreateSessionInput {
  cwd: string;
  model: string;
  agent?: string;
  title?: string;
  parentID?: string;
  permissions?: Session["permissions"];
  metadata?: Record<string, unknown>;
}

export interface SessionFilter {
  cwd?: string;
  limit?: number;
}

export interface SearchResult {
  sessionID: string;
  messageID: string;
  role: string;
  content: string;
}

export type ExportFormat = "json" | "md";

interface SessionRow {
  id: string;
  title: string;
  cwd: string;
  model: string;
  agent: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  status: string;
  permissions: string;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  cost: number;
  metadata: string;
}

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HARNESS_DATA_DIR ? resolve(env.HARNESS_DATA_DIR) : join(homedir(), ".harness");
}

function now(): string {
  return new Date().toISOString();
}

function defaultTitle(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? "session";
}

export class SessionStore {
  readonly dataDir: string;
  private readonly db: InstanceType<typeof DatabaseSync>;

  constructor(options: { dataDir?: string } = {}) {
    this.dataDir = options.dataDir ? resolve(options.dataDir) : resolveDataDir();
    mkdirSync(this.dataDir, { recursive: true });
    this.db = new DatabaseSync(join(this.dataDir, "index.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cwd TEXT NOT NULL,
        model TEXT NOT NULL,
        agent TEXT NOT NULL,
        parent_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL,
        permissions TEXT NOT NULL,
        tokens_input INTEGER NOT NULL DEFAULT 0,
        tokens_output INTEGER NOT NULL DEFAULT 0,
        tokens_cache_read INTEGER NOT NULL DEFAULT 0,
        tokens_cache_write INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, seq);
    `);
  }

  create(input: CreateSessionInput): Session {
    const timestamp = now();
    const session: Session = {
      id: ids.session(),
      title: input.title ?? defaultTitle(input.cwd),
      cwd: resolve(input.cwd),
      model: input.model,
      agent: input.agent ?? "build",
      parentID: input.parentID,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "idle",
      tokens: emptyUsage(),
      cost: 0,
      permissions: input.permissions ?? "default",
      metadata: input.metadata ?? {},
    };

    this.db
      .prepare(
        `INSERT INTO sessions (
          id, title, cwd, model, agent, parent_id, created_at, updated_at,
          status, permissions, tokens_input, tokens_output, tokens_cache_read,
          tokens_cache_write, cost, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.title,
        session.cwd,
        session.model,
        session.agent,
        session.parentID ?? null,
        session.createdAt,
        session.updatedAt,
        session.status,
        session.permissions,
        session.tokens.input,
        session.tokens.output,
        session.tokens.cacheRead,
        session.tokens.cacheWrite,
        session.cost,
        JSON.stringify(session.metadata),
      );

    return session;
  }

  get(id: string): Session | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | SessionRow
      | undefined;
    return row ? this.rowToSession(row) : undefined;
  }

  list(filter: SessionFilter = {}): Session[] {
    const limit = filter.limit ?? 50;
    const rows = filter.cwd
      ? (this.db
          .prepare("SELECT * FROM sessions WHERE cwd = ? ORDER BY updated_at DESC LIMIT ?")
          .all(filter.cwd, limit) as unknown as SessionRow[])
      : (this.db
          .prepare("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?")
          .all(limit) as unknown as SessionRow[]);
    return rows.map((row) => this.rowToSession(row));
  }

  update(id: string, patch: Partial<Session>): Session | undefined {
    const current = this.get(id);
    if (!current) return undefined;

    const merged: Session = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now(),
    };

    this.db
      .prepare(
        `UPDATE sessions SET
          title = ?, cwd = ?, model = ?, agent = ?, parent_id = ?, updated_at = ?,
          status = ?, permissions = ?, tokens_input = ?, tokens_output = ?,
          tokens_cache_read = ?, tokens_cache_write = ?, cost = ?, metadata = ?
        WHERE id = ?`,
      )
      .run(
        merged.title,
        merged.cwd,
        merged.model,
        merged.agent,
        merged.parentID ?? null,
        merged.updatedAt,
        merged.status,
        merged.permissions,
        merged.tokens.input,
        merged.tokens.output,
        merged.tokens.cacheRead,
        merged.tokens.cacheWrite,
        merged.cost,
        JSON.stringify(merged.metadata),
        merged.id,
      );

    return merged;
  }

  appendMessage(sessionID: string, message: ChatMessage): void {
    const seq = this.nextSequence("messages", sessionID);
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "INSERT INTO messages (id, session_id, seq, role, content, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          ids.message(),
          sessionID,
          seq,
          message.role,
          message.content,
          JSON.stringify(message),
          now(),
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  readMessages(sessionID: string): ChatMessage[] {
    const rows = this.db
      .prepare("SELECT data FROM messages WHERE session_id = ? ORDER BY seq ASC")
      .all(sessionID) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as ChatMessage);
  }

  replaceMessages(sessionID: string, messages: ChatMessage[]): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionID);
      messages.forEach((message, index) => {
        this.db
          .prepare(
            "INSERT INTO messages (id, session_id, seq, role, content, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            ids.message(),
            sessionID,
            index + 1,
            message.role,
            message.content,
            JSON.stringify(message),
            now(),
          );
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  appendEvent(sessionID: string, event: HarnessEvent): void {
    if (!isPrefixedId(sessionID, "ses")) {
      throw new HarnessError("invalid_argument", `Invalid session id: ${sessionID}`);
    }
    const seq = this.nextSequence("events", sessionID);
    this.db
      .prepare(
        "INSERT INTO events (session_id, seq, type, data, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(sessionID, seq, event.type, JSON.stringify(event), now());

    const directory = join(this.dataDir, "sessions", sessionID);
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  }

  readEvents(sessionID: string): HarnessEvent[] {
    const rows = this.db
      .prepare("SELECT data FROM events WHERE session_id = ? ORDER BY seq ASC")
      .all(sessionID) as Array<{ data: string }>;
    const events: HarnessEvent[] = [];
    for (const row of rows) {
      const parsed = harnessEventSchema.safeParse(JSON.parse(row.data));
      if (parsed.success) events.push(parsed.data);
    }
    return events;
  }

  search(query: string, limit = 20): SearchResult[] {
    const rows = this.db
      .prepare(
        "SELECT session_id, id, role, content FROM messages WHERE content LIKE ? ORDER BY seq DESC LIMIT ?",
      )
      .all(`%${query}%`, limit) as Array<{
      session_id: string;
      id: string;
      role: string;
      content: string;
    }>;

    return rows.map((row) => ({
      sessionID: row.session_id,
      messageID: row.id,
      role: row.role,
      content: row.content.slice(0, 500),
    }));
  }

  export(sessionID: string, format: ExportFormat = "json"): string {
    const session = this.get(sessionID);
    if (!session) {
      throw new HarnessError("session_not_found", `Session ${sessionID} was not found`, {
        details: { sessionID },
      });
    }

    const messages = this.readMessages(sessionID);
    const events = this.readEvents(sessionID);

    if (format === "json") {
      return JSON.stringify({ session, messages, events }, null, 2);
    }

    const lines = [
      `# ${session.title}`,
      "",
      `- id: ${session.id}`,
      `- cwd: ${session.cwd}`,
      `- model: ${session.model}`,
      `- status: ${session.status}`,
      `- created: ${session.createdAt}`,
      `- updated: ${session.updatedAt}`,
      `- cost: $${session.cost.toFixed(6)}`,
      "",
      "## Messages",
      "",
    ];

    for (const message of messages) {
      lines.push(`### ${message.role}`, "", message.content || "(no text)", "");
      for (const call of message.toolCalls ?? []) {
        lines.push(`- tool call: \`${call.name}\` \`${call.id}\``, "");
      }
    }

    return lines.join("\n");
  }

  delete(sessionID: string): boolean {
    const existing = this.get(sessionID);
    if (!existing) return false;

    this.db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionID);
    this.db.prepare("DELETE FROM events WHERE session_id = ?").run(sessionID);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionID);
    rmSync(join(this.dataDir, "sessions", sessionID), { recursive: true, force: true });
    return true;
  }

  sessionDirectory(sessionID: string): string {
    return join(this.dataDir, "sessions", sessionID);
  }

  close(): void {
    this.db.close();
  }

  private nextSequence(table: "messages" | "events", sessionID: string): number {
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM ${table} WHERE session_id = ?`)
      .get(sessionID) as { seq: number } | undefined;
    return Number(row?.seq ?? 0) + 1;
  }

  private rowToSession(row: SessionRow): Session {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch (error) {
      throw toHarnessError(error, "internal_error");
    }

    return {
      id: row.id,
      title: row.title,
      cwd: row.cwd,
      model: row.model,
      agent: row.agent,
      parentID: row.parent_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status as Session["status"],
      tokens: {
        input: Number(row.tokens_input),
        output: Number(row.tokens_output),
        cacheRead: Number(row.tokens_cache_read),
        cacheWrite: Number(row.tokens_cache_write),
      },
      cost: Number(row.cost),
      permissions: row.permissions as Session["permissions"],
      metadata,
    };
  }
}

export function sessionExists(store: SessionStore, sessionID: string): boolean {
  return store.get(sessionID) !== undefined;
}

export function readSessionFile(
  store: SessionStore,
  sessionID: string,
  filename: string,
): string | undefined {
  const safeName = basename(filename);
  if (safeName !== filename || safeName === "." || safeName === "..") {
    throw new HarnessError("invalid_argument", `Invalid session file name: ${filename}`);
  }
  const path = join(store.sessionDirectory(sessionID), safeName);
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8");
}

export function writeSessionFile(
  store: SessionStore,
  sessionID: string,
  filename: string,
  contents: string,
): void {
  const safeName = basename(filename);
  if (safeName !== filename || safeName === "." || safeName === "..") {
    throw new HarnessError("invalid_argument", `Invalid session file name: ${filename}`);
  }
  const directory = store.sessionDirectory(sessionID);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, safeName), contents, "utf8");
}
