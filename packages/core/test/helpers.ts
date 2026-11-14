import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, type ToolContext } from "@kiln/shared";

export async function makeTempDir(prefix = "kiln-core-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTempDir(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

export function makeContext(cwd: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionID: "ses_test",
    cwd,
    workspaceRoot: cwd,
    signal: new AbortController().signal,
    logger: createLogger({ level: "silent" }),
    state: {},
    ...overrides,
  };
}

export function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
