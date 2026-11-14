# Kilncraft

A production-grade, model-agnostic coding agent.

> **Status:** Core + P1 integrations complete. Some planned P1 tools remain (see
> "Remaining scope" in [plan.md](./plan.md#0-build-status)).

## Requirements

- Node.js >= 24
- pnpm 12
- git
- An API key for at least one provider (or a local Ollama server)

## Quickstart

Install globally or run with `npx`:

```sh
npm i -g @kilncraft/cli
kilncraft doctor
kilncraft
```

Or from this checkout:

```sh
pnpm install
pnpm build
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js --version
```

Docker:

```sh
docker build -t kilncraft .
docker run --rm -it -p 4096:4096 -v "$PWD:/work" kilncraft
```

Launch the interactive TUI (requires a TTY):

```sh
node packages/cli/dist/index.js
node packages/cli/dist/index.js "start by exploring src/"
```

Run a prompt non-interactively:

```sh
export ANTHROPIC_API_KEY="sk-ant-..."
node packages/cli/dist/index.js run "find the bug in src/index.ts" \
  --model anthropic/claude-sonnet-4-5 \
  --permission-mode acceptEdits
```

Headless runs cannot prompt for approval. Use `--permission-mode acceptEdits` to
allow workspace edits; shell commands still require a TUI approval or
`bypassPermissions`.

## Sessions

Sessions are persisted to `~/.kilncraft` (override with `KILNCRAFT_DATA_DIR`):

- `index.db` — SQLite index for sessions, messages, and events
- `sessions/<id>/events.jsonl` — append-only event mirror
- `audit.jsonl` — permission decisions (input is hashed, not stored verbatim)
- `sessions/<id>/checkpoints/` — pre-write file snapshots

```sh
kilncraft run "continue the refactor" --continue
kilncraft run "keep going" --session ses_...
kilncraft sessions list
kilncraft sessions show ses_...
kilncraft sessions search "needle"
kilncraft sessions export ses_... --format md
kilncraft sessions fork ses_...
kilncraft sessions compact ses_...
kilncraft sessions delete ses_...
kilncraft undo --session ses_...
kilncraft audit
```

Context compaction is automatic at ~80% of the model's context window: older
messages are summarized and the most recent turns are preserved. `sessions compact`
forces it for a stored session.

## Interactive TUI

`kilncraft` (with no subcommand) launches the Ink TUI. It streams assistant text,
renders diffs and markdown, shows tool status, and prompts for permissions.

Keys:

- `Enter` send · `Ctrl+J` newline · `Esc` interrupt · `Ctrl+C` clear/exit
- `↑`/`↓` prompt history
- `y` allow once · `t` always allow · `n` deny (permission modal)

Commands:

```
/help  /clear  /new  /sessions  /model [ref]  /compact
/cost  /context  /doctor  /exit
```

Themes: `KILNCRAFT_THEME=default|dim|highContrast`; `NO_COLOR=1` disables color.
`KILNCRAFT_DATA_DIR` relocates sessions and audit logs.

## Workspace

| Package                 | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `@kilncraft/shared`     | Events, schemas, errors, config, logging, telemetry, provider contracts  |
| `@kilncraft/core`       | Agent loop, providers, permissions, tools, sessions, compaction, plugins |
| `@kilncraft/cli`        | `kilncraft` command-line interface                                       |
| `@kilncraft/tui`        | Ink terminal UI (transcript, composer, diffs, modals)                    |
| `@kilncraft/server`     | HTTP/SSE/WebSocket daemon, session API, permission-resume flow           |
| `@kilncraft/sdk`        | Embed the agent in-process (no socket)                                   |
| `@kilncraft/mcp`        | MCP client, stdio server, Streamable HTTP server                         |
| `@kilncraft/plugin-sdk` | Plugin type definitions and `definePlugin`                               |
| `@kilncraft/sandbox`    | bwrap / seatbelt / Docker command wrapping                               |
| `@kilncraft/lsp`        | Language-server JSON-RPC client                                          |
| `@kilncraft/eval`       | Task runner and benchmark adapters                                       |

## Providers

| Provider id  | Env var                     | Notes                                                     |
| ------------ | --------------------------- | --------------------------------------------------------- |
| `anthropic`  | `ANTHROPIC_API_KEY`         | Messages API, streaming tool calls                        |
| `openai`     | `OPENAI_API_KEY`            | Chat Completions, OpenAI-compatible                       |
| `openrouter` | `OPENROUTER_API_KEY`        | OpenAI-compatible routing; `OPENROUTER_BASE_URL` override |
| `gemini`     | `GEMINI_API_KEY`            | `streamGenerateContent`                                   |
| `ollama`     | `OLLAMA_HOST`               | Local, OpenAI-compatible, no key required                 |
| `custom`     | `KILNCRAFT_CUSTOM_BASE_URL` | Any OpenAI-compatible endpoint                            |

Base URLs can be overridden with `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`,
`GEMINI_BASE_URL`, and `OLLAMA_HOST`.

## Scripts

| Command           | Description                     |
| ----------------- | ------------------------------- |
| `pnpm build`      | Build every package             |
| `pnpm typecheck`  | Type-check every package        |
| `pnpm test`       | Run the test suite              |
| `pnpm perf:check` | Fail on performance regression  |
| `pnpm lint`       | Biome lint + format check       |
| `pnpm schema`     | Regenerate `config.schema.json` |

## Server API

```sh
kilncraft serve --port 4096
```

The daemon exposes JSON + SSE:

```
GET    /health
GET    /info
GET    /models
GET    /tools
GET    /mcp/servers
POST   /mcp                           # MCP Streamable HTTP (stateless)
WS     /ws                            # JSON event bridge (token optional)
GET    /sessions
POST   /sessions
GET    /sessions/:id
DELETE /sessions/:id
GET    /sessions/:id/messages
GET    /sessions/:id/events          # SSE replay
POST   /sessions/:id/prompt          # SSE stream
POST   /sessions/:id/abort
POST   /sessions/:id/compact
POST   /sessions/:id/permissions/:requestID
GET    /openapi.json
```

Prompt events are streamed as `data: {"event": ...}`. When the agent asks for
permission, the stream emits `permission.requested`; resolve it with:

```sh
curl -X POST localhost:4096/sessions/<id>/permissions/<requestID> \
  -H 'content-type: application/json' -d '{"decision":"allow"}'
```

Set `KILNCRAFT_TOKEN` to require `Authorization: Bearer <token>` for remote access.
`GET /` serves a minimal browser page.

## SDK

```ts
import { createKilncraft } from "@kilncraft/sdk";

const kilncraft = createKilncraft({
  cwd: process.cwd(),
  model: "anthropic/claude-sonnet-4-5",
  permissionMode: "acceptEdits",
});

const session = await kilncraft.createSession({ title: "embed" });
const result = await kilncraft.prompt(session.id, "fix the failing test", {
  onEvent: (event) => console.log(event.type),
});
console.log(result.text, result.cost);
```

The SDK runs the core in-process with no socket and reuses the same session store,
plugins, permissions, and tools.

## MCP and plugins

```jsonc
{
  "mcp": {
    "servers": {
      "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
      "remote": {
        "url": "https://mcp.example.com",
        "headers": { "authorization": "Bearer {env:MCP_TOKEN}" }
      }
    }
  },
  "plugins": ["./plugins/my-plugin.ts"]
}
```

```sh
kilncraft mcp list
kilncraft mcp serve       # expose kilncraft tools over MCP stdio
```

A plugin exports a `Plugin` object with `hooks` (`session.start`,
`message.received`, `tool.before`, `tool.after`, `event`), `tools`, and `commands`.
See `examples/plugins/` and `@kilncraft/plugin-sdk`.

## Configuration

Configuration is JSONC. Precedence: defaults → `~/.kilncraft/config.json` →
`.kilncraft/config.json` → `KILNCRAFT_*` env vars → CLI flags.

```jsonc
{
  "$schema": "./config.schema.json",
  "model": "anthropic/claude-sonnet-4-5",
  "permissions": { "default": "ask" }
}
```

Run `kilncraft config path` to print the global config location and
`kilncraft config schema` to print the JSON schema.

## Security and release

- [SECURITY.md](./SECURITY.md) — threat model, reporting, hardening checklist.
- Sandbox adapters wrap bash with bubblewrap (Linux), sandbox-exec (macOS), or
  Docker; enable with `sandbox.enabled` in config.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — development workflow.
- [CHANGELOG.md](./CHANGELOG.md) — release notes.
- `pnpm perf:check` — performance budgets.
- `pnpm audit` — dependency audit.
- Docker: `docker build -t kilncraft .`

## CLI

```
kilncraft                            # interactive TUI
kilncraft "initial prompt"           # TUI with an initial prompt
kilncraft run [prompt...]            # non-interactive agent
kilncraft serve [--port 4096]        # HTTP/SSE daemon
kilncraft models list                # known models + configured providers
kilncraft sessions ...               # list/show/export/fork/search/compact/delete
kilncraft undo                       # restore the latest checkpoint
kilncraft audit                      # recent permission decisions
kilncraft mcp list|serve             # MCP servers / stdio tool server
kilncraft config path|schema|get     # configuration inspection
kilncraft doctor                     # environment diagnostics
```

Global options: `--model`, `--cwd`, `--agent`, `--permission-mode`, `--standalone`,
`--json`, `--verbose`. Run options: `--session`, `--continue`, `--output-format`.
