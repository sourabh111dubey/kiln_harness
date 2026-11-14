import type { Hono } from "hono";
import { type WebSocket, WebSocketServer } from "ws";

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
      ws.send(JSON.stringify({ type: "hello", transport: "websocket" }));

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
      ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
      return;
    }

    try {
      switch (message.type) {
        case "list-sessions": {
          const response = await app.request("/sessions");
          ws.send(await response.text());
          break;
        }
        case "create-session": {
          const response = await app.request("/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(message.body ?? {}),
          });
          ws.send(await response.text());
          break;
        }
        case "resolve-permission": {
          const response = await app.request(
            `/sessions/${message.sessionID}/permissions/${message.requestID}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ decision: message.body?.decision ?? "deny" }),
            },
          );
          ws.send(await response.text());
          break;
        }
        case "abort": {
          const response = await app.request(`/sessions/${message.sessionID}/abort`, {
            method: "POST",
          });
          ws.send(await response.text());
          break;
        }
        case "prompt": {
          if (!message.sessionID || typeof message.prompt !== "string") {
            ws.send(JSON.stringify({ type: "error", message: "sessionID and prompt required" }));
            return;
          }
          const response = await app.request(`/sessions/${message.sessionID}/prompt`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              prompt: message.prompt,
              model: message.model,
              permissionMode: message.permissionMode,
            }),
          });

          if (!response.body) {
            ws.send(JSON.stringify({ type: "error", message: "no response stream" }));
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

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
                ws.send(
                  JSON.stringify({
                    type: "event",
                    data: dataLine.slice(5).trim(),
                  }),
                );
              }
              boundary = buffer.indexOf("\n\n");
            }
          }

          ws.send(JSON.stringify({ type: "done" }));
          break;
        }
        default:
          ws.send(
            JSON.stringify({ type: "error", message: `unknown message type: ${message.type}` }),
          );
      }
    } catch (error) {
      ws.send(
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
