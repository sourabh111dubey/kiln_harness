import { join } from "node:path";
import {
  AuditLog,
  CheckpointManager,
  compactMessages,
  modelInfoFor,
  resolveDataDir,
  SessionStore,
} from "@kiln/core";
import { parseModelRef } from "@kiln/shared";
import type { Command } from "commander";

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`kiln: ${message}\n`);
  process.exitCode = 1;
}

export function registerSessionCommands(program: Command): void {
  const sessions = program.command("sessions").description("Manage persisted sessions");

  sessions
    .command("list")
    .description("List recent sessions")
    .action(() => {
      try {
        const store = new SessionStore();
        const records = store.list({ limit: 50 });
        if (records.length === 0) {
          process.stdout.write("(no sessions)\n");
          return;
        }
        for (const record of records) {
          process.stdout.write(
            `${record.id}\t${record.status}\t${record.model}\t${record.cwd}\t$${record.cost.toFixed(4)}\t${record.updatedAt}\n`,
          );
        }
      } catch (error) {
        fail(error);
      }
    });

  sessions
    .command("show <id>")
    .description("Show a session and its recent messages")
    .action((id: string) => {
      try {
        const store = new SessionStore();
        const record = store.get(id);
        if (!record) {
          process.stderr.write(`Session ${id} not found.\n`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
        const messages = store.readMessages(id).slice(-5);
        for (const message of messages) {
          process.stdout.write(`\n### ${message.role}\n${message.content}\n`);
        }
      } catch (error) {
        fail(error);
      }
    });

  sessions
    .command("export <id>")
    .description("Export a session")
    .option("--format <format>", "json | md", "json")
    .action((id: string, options: { format?: string }) => {
      try {
        const store = new SessionStore();
        const format = options.format === "md" ? "md" : "json";
        process.stdout.write(`${store.export(id, format)}\n`);
      } catch (error) {
        fail(error);
      }
    });

  sessions
    .command("search <query>")
    .description("Search session messages")
    .action((query: string) => {
      try {
        const store = new SessionStore();
        const results = store.search(query);
        if (results.length === 0) {
          process.stdout.write("(no matches)\n");
          return;
        }
        for (const result of results) {
          process.stdout.write(
            `${result.sessionID}\t${result.role}\t${result.content.replace(/\n/g, " ")}\n`,
          );
        }
      } catch (error) {
        fail(error);
      }
    });

  sessions
    .command("fork <id>")
    .description("Copy a session into a new session")
    .action((id: string) => {
      try {
        const store = new SessionStore();
        const original = store.get(id);
        if (!original) {
          process.stderr.write(`Session ${id} not found.\n`);
          process.exitCode = 1;
          return;
        }
        const fork = store.create({
          cwd: original.cwd,
          model: original.model,
          agent: original.agent,
          title: `${original.title} (fork)`,
          parentID: original.id,
          permissions: original.permissions,
          metadata: original.metadata,
        });
        for (const message of store.readMessages(id)) store.appendMessage(fork.id, message);
        for (const event of store.readEvents(id)) store.appendEvent(fork.id, event);
        process.stdout.write(`${fork.id}\n`);
      } catch (error) {
        fail(error);
      }
    });

  sessions
    .command("delete <id>")
    .description("Delete a session")
    .action((id: string) => {
      try {
        const store = new SessionStore();
        process.stdout.write(store.delete(id) ? "deleted\n" : "not found\n");
      } catch (error) {
        fail(error);
      }
    });

  sessions
    .command("compact <id>")
    .description("Compact a stored session's context")
    .action((id: string) => {
      try {
        const store = new SessionStore();
        const record = store.get(id);
        if (!record) {
          process.stderr.write(`Session ${id} not found.\n`);
          process.exitCode = 1;
          return;
        }
        const parsed = parseModelRef(record.model);
        const info = parsed ? modelInfoFor(parsed.provider, parsed.model) : undefined;
        const result = compactMessages(store.readMessages(id), {
          contextWindow: info?.contextWindow ?? 128_000,
          keepRecent: 6,
        });
        store.replaceMessages(id, result.messages);
        process.stdout.write(
          `Compacted ${result.omitted} message(s); ${result.tokensBefore} -> ${result.tokensAfter} estimated tokens.\n`,
        );
      } catch (error) {
        fail(error);
      }
    });

  program
    .command("undo")
    .description("Restore the latest checkpoint for a session")
    .option("--session <id>", "Session id")
    .action((options: { session?: string }) => {
      try {
        if (!options.session) {
          process.stderr.write("Provide --session <id>.\n");
          process.exitCode = 2;
          return;
        }
        const manager = new CheckpointManager(resolveDataDir());
        const restored = manager.restoreLatest(options.session);
        if (restored === 0) {
          process.stderr.write(`No checkpoint found for session ${options.session}.\n`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(`Restored ${restored} file(s).\n`);
      } catch (error) {
        fail(error);
      }
    });

  program
    .command("audit")
    .description("Show recent permission decisions")
    .option("--limit <n>", "Number of entries", "20")
    .action((options: { limit?: string }) => {
      const limit = Number.parseInt(options.limit ?? "20", 10);
      const log = new AuditLog(join(resolveDataDir(), "audit.jsonl"));
      const entries = log.read(Number.isFinite(limit) ? limit : 20);
      if (entries.length === 0) {
        process.stdout.write("(no audit entries)\n");
        return;
      }
      for (const entry of entries) {
        process.stdout.write(
          `${entry.timestamp}\t${entry.decision}\t${entry.tool}\t${entry.sessionID}\t${entry.summary}\n`,
        );
      }
    });
}
