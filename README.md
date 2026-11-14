# Kiln

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
npm i -g @kiln/cli
kiln doctor
kiln
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
docker build -t kiln .
docker run --rm -it -p 4096:4096 -v "$PWD:/work" kiln
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

Sessions are persisted to `~/.kiln` (override with `KILN_DATA_DIR`):

- `index.db` — SQLite index for sessions, messages, and events
- `sessions/<id>/events.jsonl` — append-only event mirror
- `audit.jsonl` — permission decisions (input is hashed, not stored verbatim)
- `sessions/<id>/checkpoints/` — pre-write file snapshots

```sh
kiln run "continue the refactor" --continue
kiln run "keep going" --session ses_...
kiln sessions list
kiln sessions show ses_...
kiln sessions search "needle"
kiln sessions export ses_... --format md
kiln sessions fork ses_...
kiln sessions compact ses_...
kiln sessions delete ses_...
kiln undo --session ses_...
kiln audit
```

Context compaction is automatic at ~80% of the model's context window: older
messages are summarized and the most recent turns are preserved. `sessions compact`
forces it for a stored session.

## Interactive TUI

`kiln` (with no subcommand) launches the Ink TUI. It streams assistant text,
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

Themes: `KILN_THEME=default|dim|highContrast`; `NO_COLOR=1` disables color.
`KILN_DATA_DIR` relocates sessions and audit logs.

## Workspace

| Package            | Purpose                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `@kiln/shared`     | Events, schemas, errors, config, logging, telemetry, provider contracts  |
| `@kiln/core`       | Agent loop, providers, permissions, tools, sessions, compaction, plugins |
| `@kiln/cli`        | `kiln` command-line interface                                            |
| `@kiln/tui`        | Ink terminal UI (transcript, composer, diffs, modals)                    |
| `@kiln/server`     | HTTP/SSE/WebSocket daemon, session API, permission-resume flow           |
| `@kiln/sdk`        | Embed the agent in-process (no socket)                                   |
| `@kiln/mcp`        | MCP client, stdio server, Streamable HTTP server                         |
| `@kiln/plugin-sdk` | Plugin type definitions and `definePlugin`                               |
| `@kiln/sandbox`    | bwrap / seatbelt / Docker command wrapping                               |
| `@kiln/lsp`        | Language-server JSON-RPC client                                          |
| `@kiln/eval`       | Task runner and benchmark adapters                                       |

## Providers

| Provider id  | Env var                | Notes                                                     |
| ------------ | ---------------------- | --------------------------------------------------------- |
| `anthropic`  | `ANTHROPIC_API_KEY`    | Messages API, streaming tool calls                        |
| `openai`     | `OPENAI_API_KEY`       | Chat Completions, OpenAI-compatible                       |
| `openrouter` | `OPENROUTER_API_KEY`   | OpenAI-compatible routing; `OPENROUTER_BASE_URL` override |
| `gemini`     | `GEMINI_API_KEY`       | `streamGenerateContent`                                   |
| `ollama`     | `OLLAMA_HOST`          | Local, OpenAI-compatible, no key required                 |
| `custom`     | `KILN_CUSTOM_BASE_URL` | Any OpenAI-compatible endpoint                            |

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
kiln serve --port 4096
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

Set `KILN_TOKEN` to require `Authorization: Bearer <token>` for remote access.
`GET /` serves a minimal browser page.

## SDK

```ts
import { createKiln } from "@kiln/sdk";

const kiln = createKiln({
  cwd: process.cwd(),
  model: "anthropic/claude-sonnet-4-5",
  permissionMode: "acceptEdits",
});

const session = await kiln.createSession({ title: "embed" });
const result = await kiln.prompt(session.id, "fix the failing test", {
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
kiln mcp list
kiln mcp serve       # expose kiln tools over MCP stdio
```

A plugin exports a `Plugin` object with `hooks` (`session.start`,
`message.received`, `tool.before`, `tool.after`, `event`), `tools`, and `commands`.
See `examples/plugins/` and `@kiln/plugin-sdk`.

## Configuration

Configuration is JSONC. Precedence: defaults → `~/.kiln/config.json` →
`.kiln/config.json` → `KILN_*` env vars → CLI flags.

```jsonc
{
  "$schema": "./config.schema.json",
  "model": "anthropic/claude-sonnet-4-5",
  "permissions": { "default": "ask" }
}
```

Run `kiln config path` to print the global config location and
`kiln config schema` to print the JSON schema.

## Security and release

- [SECURITY.md](./SECURITY.md) — threat model, reporting, hardening checklist.
- Sandbox adapters wrap bash with bubblewrap (Linux), sandbox-exec (macOS), or
  Docker; enable with `sandbox.enabled` in config.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — development workflow.
- [CHANGELOG.md](./CHANGELOG.md) — release notes.
- `pnpm perf:check` — performance budgets.
- `pnpm audit` — dependency audit.
- Docker: `docker build -t kiln .`

## CLI

```
kiln                            # interactive TUI
kiln "initial prompt"           # TUI with an initial prompt
kiln run [prompt...]            # non-interactive agent
kiln serve [--port 4096]        # HTTP/SSE daemon
kiln models list                # known models + configured providers
kiln sessions ...               # list/show/export/fork/search/compact/delete
kiln undo                       # restore the latest checkpoint
kiln audit                      # recent permission decisions
kiln mcp list|serve             # MCP servers / stdio tool server
kiln config path|schema|get     # configuration inspection
kiln doctor                     # environment diagnostics
```

Global options: `--model`, `--cwd`, `--agent`, `--permission-mode`, `--standalone`,
`--json`, `--verbose`. Run options: `--session`, `--continue`, `--output-format`.
