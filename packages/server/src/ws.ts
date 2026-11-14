import type { Hono } from "hono";
import { WebSocket, WebSocketServer } from "ws";

function safeSend(ws: WebSocket, payload: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(payload);
  } catch {
    // The client may have disconnected mid-stream.
  }
}

interface ClientMessage {
  type: string;
  sessionID?: string;
  requestID?: string;
  prompt?: string;
  model?: string;
  permissionMode?: string;
  body?: Record<string, unknown>;
}

export function attachWebSocket(
  server: NodeJS.EventEmitter,
  app: Hono,
  token?: string,
): () => void {
  const wss = new WebSocketServer({ noServer: true });

  const internalRequest = async (path: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    return app.request(path, { ...init, headers });
  };

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const header = request.headers.authorization;
    const queryToken = url.searchParams.get("token");
    if (token && header !== `Bearer ${token}` && queryToken !== token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      safeSend(ws, JSON.stringify({ type: "hello", transport: "websocket" }));

      ws.on("message", (data) => {
        void handleMessage(ws, data.toString());
      });
    });
  });

  async function handleMessage(ws: WebSocket, raw: string): Promise<void> {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      safeSend(ws, JSON.stringify({ type: "error", message: "invalid JSON" }));
      return;
    }

    try {
      switch (message.type) {
        case "list-sessions": {
          const response = await internalRequest("/sessions");
          safeSend(ws, await response.text());
          break;
        }
        case "create-session": {
          const response = await internalRequest("/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(message.body ?? {}),
          });
          safeSend(ws, await response.text());
          break;
        }
        case "resolve-permission": {
          const response = await internalRequest(
            `/sessions/${message.sessionID}/permissions/${message.requestID}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ decision: message.body?.decision ?? "deny" }),
            },
          );
          safeSend(ws, await response.text());
          break;
        }
        case "abort": {
          const response = await internalRequest(`/sessions/${message.sessionID}/abort`, {
            method: "POST",
          });
          safeSend(ws, await response.text());
          break;
        }
        case "prompt": {
          if (!message.sessionID || typeof message.prompt !== "string") {
            safeSend(
              ws,
              JSON.stringify({ type: "error", message: "sessionID and prompt required" }),
            );
            return;
          }
          const controller = new AbortController();
          const onClose = () => controller.abort();
          ws.on("close", onClose);

          const response = await internalRequest(`/sessions/${message.sessionID}/prompt`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              prompt: message.prompt,
              model: message.model,
              permissionMode: message.permissionMode,
            }),
            signal: controller.signal,
          });

          const contentType = response.headers.get("content-type") ?? "";
          if (!response.ok || !contentType.includes("text/event-stream")) {
            const body = await response.text();
            safeSend(
              ws,
              JSON.stringify({
                type: "error",
                message: `HTTP ${response.status}: ${body.slice(0, 300)}`,
              }),
            );
            ws.off("close", onClose);
            return;
          }

          if (!response.body) {
            safeSend(ws, JSON.stringify({ type: "error", message: "no response stream" }));
            ws.off("close", onClose);
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let boundary = buffer.indexOf("\n\n");
              while (boundary !== -1) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
                if (dataLine) {
                  safeSend(
                    ws,
                    JSON.stringify({
                      type: "event",
                      data: dataLine.slice(5).trim(),
                    }),
                  );
                }
                boundary = buffer.indexOf("\n\n");
              }
            }
          } finally {
            await reader.cancel().catch(() => undefined);
            ws.off("close", onClose);
          }

          safeSend(ws, JSON.stringify({ type: "done" }));
          break;
        }
        default:
          safeSend(
            ws,
            JSON.stringify({ type: "error", message: `unknown message type: ${message.type}` }),
          );
      }
    } catch (error) {
      safeSend(
        ws,
        JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return () => {
    for (const client of wss.clients) client.close();
    wss.close();
  };
}
