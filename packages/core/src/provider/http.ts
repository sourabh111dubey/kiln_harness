import { KilncraftError } from "@kilncraft/shared";

function mergeHeaders(input: RequestInit["headers"]): Headers {
  const headers = new Headers(input);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  return headers;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return body.slice(0, 800);
  } catch {
    return response.statusText;
  }
}

export async function openSse(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  const headers = mergeHeaders(init.headers);
  headers.set("accept", "text/event-stream");

  const response = await fetch(url, { ...init, headers, signal });
  if (!response.ok) {
    const body = await errorMessage(response);
    throw new KilncraftError("provider_error", `HTTP ${response.status} from ${url}: ${body}`, {
      details: { status: response.status, url },
      recoverable: response.status === 429 || response.status >= 500,
      hint: response.status === 401 ? "Check the provider API key." : undefined,
    });
  }
  return response;
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  const headers = mergeHeaders(init.headers);
  const response = await fetch(url, { ...init, headers, signal });
  if (!response.ok) {
    const body = await errorMessage(response);
    throw new KilncraftError("provider_error", `HTTP ${response.status} from ${url}: ${body}`, {
      details: { status: response.status, url },
      recoverable: response.status === 429 || response.status >= 500,
    });
  }
  return response.json();
}

function* dataLines(line: string): Generator<string> {
  const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (!clean.startsWith("data:")) return;
  const data = clean.slice(5).trimStart();
  if (data.length > 0) yield data;
}

export async function* sseData(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) {
    throw new KilncraftError("provider_error", "Streaming response has no body");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of frame.split("\n")) {
          yield* dataLines(line);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      for (const line of buffer.split("\n")) {
        yield* dataLines(line);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
