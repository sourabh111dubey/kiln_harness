# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
semantic versioning.

## 1.0.0 — 2026-11-14

### Added

- **Agent core** — streaming, model-agnostic agent loop with parallel read-only
  tools, abort, turn caps, provider retries/fallback, cost accounting, and
  automatic context compaction.
- **Providers** — Anthropic, OpenAI, OpenAI-compatible (Ollama, vLLM, LM Studio,
  custom), and Gemini streaming adapters.
- **Tools** — `read`, `write`, `edit`, `glob`, `grep`, `ls`, `bash`, `todo_write`.
- **Permissions** — `default`, `acceptEdits`, `plan`, `bypassPermissions`, custom
  rules, dangerous-command detection, path confinement, and audit logging.
- **Sessions** — SQLite + JSONL event log, resume, continue, fork, export, search,
  checkpoints, undo, and retention hooks.
- **TUI** — Ink terminal UI with streaming transcript, markdown, diffs, composer,
  history, permission modal, session picker, status line, themes, and slash
  commands.
- **Server** — Hono HTTP/SSE daemon with session CRUD, prompt streaming, event
  replay, abort, compact, permission-resume flow, OpenAPI, optional bearer auth,
  and a minimal browser page.
- **SDK** — `@kiln/sdk` in-process embedding with sessions and streaming events.
- **Plugins** — `@kiln/plugin-sdk`, loader, and hooks for session start,
  messages, tool before/after, and events.
- **MCP** — client for stdio and Streamable HTTP, tool discovery/namespacing, and
  an MCP stdio server exposing kiln tools.
- **Tooling** — pnpm/Turbo monorepo, Biome, Vitest, changesets, fuzz tests,
  performance budgets, cross-platform CI, CodeQL, SBOM, Docker image, and release
  automation.

### Security

- Permission engine fails closed; deny beats allow.
- Writes are confined to the workspace; traversal is blocked.
- Secrets are redacted from logs, audit records, and tool output.
- MCP servers and plugins are untrusted by default.
- Optional bearer token for remote daemon access.

### Known limitations

- No OS-level sandbox on Windows (passthrough; Docker/WSL2 recommended); Linux
  and macOS have bubblewrap/sandbox-exec/Docker adapters.
- Git tools, web tools, `multi_edit`/`apply_patch`, memory/skill tools, and
  `ask_user` are not implemented yet.
- WebSocket is a JSON event bridge, not a full binary protocol.
- No MCP HTTP server (stdio server only) and no MCP OAuth.
- No plugin hot reload; plugins load at startup.
- Compaction is heuristic (character-based token estimate), not model-generated.
- Benchmark adapters (SWE-bench Lite, Terminal-Bench) and LSP integration are not
  included in 1.0.

## Unreleased

- OS sandbox adapters, LSP client, benchmark adapters, and WebSocket transport.
