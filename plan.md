# Harness — Production Coding Agent Harness

**Status:** 1.0.0 release candidate — M5 complete
**Last updated:** 2026-11-14
**Runtime target:** Node.js ≥ 24 (validated on Node 26), TypeScript, pnpm 12
**Codename:** `harness` (CLI binary: `harness`; packages: `@harness/*`)

> This document is the build specification. It is intentionally exhaustive: every
> feature below is either **P0** (required for 1.0), **P1** (required for a
> credible production release), or **P2** (post-1.0 / optional). "Nothing should
> miss" is enforced by the feature matrix in §32 and the definition of done in §33.

## 0. Build status

**M0 (foundation), M1 (agent core), M2 (sessions), M3 (TUI), M4 (server/SDK/plugins/MCP), M5 (hardening/release), and the remaining P1 integrations are complete.**

M0:

- pnpm workspace, Turbo task graph, strict TypeScript, tsup builds, Biome,
  Vitest with coverage thresholds, Changesets, GitHub Actions CI.
- `@harness/shared`: ULID-style ids, typed errors, session/message/part/event
  schemas, permission types, provider/tool contracts, usage/cost math, JSONC
  config loading with precedence and validation, structured logging, OTel
  tracer bootstrap, and generated `config.schema.json`.
- `@harness/cli`: `harness --version`, `--help`, `models`, `config`, `doctor`.

M1:

- `@harness/core`: provider registry with Anthropic, OpenAI-compatible (OpenAI,
  OpenRouter, Ollama, custom), and Gemini streaming adapters; normalized SSE
  parsing; streaming agent loop with parallel read-only tools, abort, turn caps,
  and duplicate-input validation.
- Permission engine with `default`, `acceptEdits`, `plan`, `bypassPermissions`,
  and `custom` modes, rule matching, dangerous-command detection, and path
  confinement.
- Built-in tools: `read`, `write`, `edit`, `glob`, `grep`, `ls`, `bash`,
  `todo_write`; atomic writes, unified diffs, timeouts, output truncation,
  environment scrubbing for shell commands.
- `harness run` with text/JSON output, config-driven model selection, provider
  auto-discovery, and error hints.
- Model catalog with context windows and pricing; cost accumulation per turn.

M2:

- `SessionStore` on `node:sqlite` with sessions, messages, events, search, export,
  fork, and delete; JSONL event mirror per session.
- Resume (`--session`) and continue (`--continue`); the agent restores messages,
  usage, cost, and todos.
- Checkpoint manager snapshots files before `write`/`edit`; `harness undo` restores
  the latest checkpoint.
- Automatic context compaction at ~80% of the model context window, plus
  `sessions compact`.
- Permission audit log with hashed inputs and readable summaries; `harness audit`.
- CLI: `sessions list|show|export|search|fork|delete|compact`, `undo`, `audit`.

M3:

- `@harness/tui` on Ink 8 + React 19.
- Streaming transcript with assistant text, tool calls, diffs, terminal output,
  JSON, errors, and info entries.
- Markdown renderer (headings, lists, code fences, inline formatting) and unified
  diff renderer with colors.
- Composer with cursor movement, multi-line input (`Ctrl+J`), history (`↑`/`↓`),
  interrupt (`Esc`), and exit (`Ctrl+C`/`Ctrl+D`).
- Permission modal (`y` allow once, `t` always allow, `n` deny) wired to the agent's
  async `askPermission` hook; session picker; status bar with tokens/cost.
- Slash commands: `/help`, `/clear`, `/new`, `/sessions`, `/model`, `/compact`,
  `/cost`, `/context`, `/doctor`, `/exit`.
- Themes (`default`, `dim`, `highContrast`), `NO_COLOR`, and `HARNESS_THEME`.
- `harness` with no subcommand launches the TUI; `harness run` remains headless.

M4:

- `@harness/server`: Hono daemon with JSON + SSE API, session CRUD, prompt streaming,
  event replay, abort, compact, tools/models/info, OpenAPI document, optional bearer
  token, CORS, and a minimal browser page.
- Async permission requests over SSE: the stream emits `permission.requested`; a
  client resolves it with `POST /sessions/:id/permissions/:requestID` and the turn
  resumes.
- `@harness/sdk`: in-process `createHarness()` with `createSession`, `prompt`,
  `listSessions`, `getSession`, `deleteSession`, `exportSession`, `compact`, and
  plugin support.
- `@harness/plugin-sdk`: `Plugin`, hooks, tools, commands, and `definePlugin`.
- Plugin loader (`loadPlugins`) and `PluginHost` hooks: `session.start`,
  `message.received`, `tool.before` (including `block`), `tool.after`, and `event`.
- `@harness/mcp`: MCP client for stdio and Streamable HTTP, tool discovery/namespacing,
  JSON Schema passthrough, and an MCP stdio server exposing harness tools.
- CLI: `harness serve`, `harness mcp list`, `harness mcp serve`.

M5:

- Version `1.0.0` and publish metadata for all `@harness/*` packages.
- Performance budget runner (`pnpm perf`, `pnpm perf:check`) measuring CLI cold
  start, bash spawn, 10k-event replay, 1k-message search, and RSS.
- Fuzz/property tests (`fast-check`) for glob conversion, truncation, event parsing,
  and diff parsing.
- Cross-platform CI matrix (Ubuntu, macOS, Windows × Node 24/26) with POSIX-only
  tests skipped on Windows.
- Security workflow: `pnpm audit`, CodeQL, Dependabot, `SECURITY.md`.
- Release workflow: npm publish, SBOM (CycloneDX), Docker image to GHCR, GitHub
  release notes.
- `Dockerfile` for headless server/CLI; `LICENSE`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `CHANGELOG.md`.
- `perf.yml` nightly budget check and `release.yml` tag-driven release.

Verification gate (all green):

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm schema
pnpm perf:check
```

Tests: 33 shared + 90 core + 10 CLI + 16 TUI + 3 SDK + 4 server + 4 MCP + 1
plugin-sdk = **161 tests**. Measured budgets on this machine:

| Metric            | Measured | Budget  |
| ----------------- | -------- | ------- |
| CLI cold start    | 359 ms   | 1500 ms |
| Bash spawn        | 2.1 ms   | 150 ms  |
| 10k event replay  | 477 ms   | 2500 ms |
| 1k-message search | 35 ms    | 1000 ms |
| Idle RSS          | 160 MB   | 350 MB  |

P1 completion:

- **Sandbox** — `@harness/sandbox` wraps bash with bubblewrap (Linux),
  sandbox-exec (macOS), or Docker; `sandbox.enabled` is honored by CLI, server,
  SDK, and TUI.
- **WebSocket** — `/ws` JSON bridge for session list/create, prompt streaming,
  permission resolution, and abort; optional `HARNESS_TOKEN`.
- **MCP HTTP** — stateless Streamable HTTP transport at `/mcp`; MCP client
  supports stdio and Streamable HTTP.
- **LSP** — `@harness/lsp` JSON-RPC client with diagnostics, document symbols,
  didOpen, and shutdown; `lsp_diagnostics` and `lsp_symbols` tools.
- **Eval** — `@harness/eval` task runner, expected-file checks, scoring, and
  SWE-bench Lite / Terminal-Bench row adapters.
- **Plugin reload** — SDK `harness.reload()` re-reads config, reloads plugins, and
  clears cached agents.

Tests: 33 shared + 94 core + 10 CLI + 16 TUI + 3 SDK + 5 server + 5 MCP + 1
plugin-sdk + 6 sandbox + 3 LSP + 4 eval = **180 tests**.

Remaining scope (not yet implemented): git tools (`git_status`, `git_diff`,
`git_log`, `git_commit`, `git_branch`, `worktree_create`), web tools
(`webfetch`, `websearch`, `fetch`), `multi_edit`, `apply_patch`, `notebook_edit`,
`snapshot`/`restore` tools, `memory_write`/`skill_load`, `ask_user`, image/PDF
reading, TUI file completion/image paste/external editor/side-by-side diffs and
configurable keybindings, MCP OAuth, server-side plugin hot reload, LSP
hover/definition/references, real SWE-bench/Terminal-Bench dataset runners, and
native Windows sandbox (Docker/WSL2 fallback).

---

## 1. Executive summary

We are building a full-stack, model-agnostic coding agent harness. It is not a
single CLI script: it is an agent runtime with a clean client/server split,
a terminal UI, an embeddable SDK, an HTTP/WebSocket API, a plugin system, MCP
support, sandboxing, and a regression-eval harness.

The product surface:

| Surface               | Description                                | Priority |
| --------------------- | ------------------------------------------ | -------- |
| `harness` (TUI)       | Interactive terminal coding agent          | P0       |
| `harness run`         | Non-interactive / scripted / CI mode       | P0       |
| `harness serve`       | Background daemon exposing HTTP + WS API   | P1       |
| `@harness/sdk`        | Embed the agent in other Node apps         | P1       |
| `@harness/plugin-sdk` | Third-party tools, hooks, commands, themes | P1       |
| MCP client + server   | External tool/resource integration         | P1       |
| `@harness/web`        | Browser client for remote sessions         | P2       |
| `@harness/eval`       | Trajectory + benchmark regression suite    | P1       |

Design principles:

1. **Model-agnostic.** Every capability degrades gracefully when a model/provider
   lacks it (vision, tool calls, reasoning, prompt caching, 1M context).
2. **Event-sourced.** Every state change is an append-only event on a session log;
   the UI is a projection. Enables resume, replay, undo, and crash recovery.
3. **Everything is a tool.** Built-ins and MCP servers share one tool contract.
4. **Permission-first.** No tool executes without an explicit policy decision.
5. **Local-first.** Default deployment is a local daemon; remote is opt-in and
   authenticated.
6. **Fail closed.** Unknown tool, malformed patch, or sandbox failure = deny,
   never silently allow.
7. **Observable.** Every turn emits structured logs, traces, token usage, and cost.
8. **Testable.** Deterministic provider fixtures, golden transcripts, and a
   Docker-backed eval runner.

---

## 2. Goals and non-goals

### 2.1 Goals

- Complete coding workflow: explore → plan → edit → test → commit → review.
- Support long-running, multi-session, multi-repo work with checkpoints.
- Support every major model provider and local models.
- Support terminal, headless, daemon, SDK, and web consumers.
- Be safe to run on developer machines: sandbox, permissions, secret redaction.
- Be extensible without forking: plugins, MCP, skills, hooks, custom commands.
- Measure quality: eval suite and benchmark adapters prevent regressions.

### 2.2 Non-goals (v1)

- Training/fine-tuning models.
- A full IDE (we ship an LSP client and an optional web UI, not an editor).
- Autonomous production deploys without a human approval gate.
- Multi-tenant SaaS (the architecture allows it; v1 is single-user/local).
- Windows-native sandbox parity on day one (fallback mode documented).

---

## 3. Architecture

### 3.1 Process model

```
┌────────────┐   stdio/IPC    ┌─────────────┐   HTTP/WS   ┌──────────────┐
│  TUI (Ink) │ ─────────────► │  CLI client │ ──────────► │              │
└────────────┘                └─────────────┘             │              │
┌────────────┐                                          │  harness     │
│  SDK / app │ ─────────────► in-process ──────────────► │  daemon      │
└────────────┘                                          │ (server)     │
┌────────────┐                                          │              │
│ Web client │ ─────────────► HTTP/WS ─────────────────►│              │
└────────────┘                                          └──────┬───────┘
                                                               │
                                        ┌──────────────────────┼──────────────────────┐
                                        ▼                      ▼                      ▼
                                 ┌────────────┐        ┌────────────┐        ┌────────────┐
                                 │ Agent core │        │ Sandbox    │        │ Tool/MCP   │
                                 │ (loop)     │        │ (bwrap/    │        │ registry   │
                                 └─────┬──────┘        │  seatbelt) │        └────────────┘
                                       │               └────────────┘
                    ┌──────────────────┼───────────────────┐
                    ▼                  ▼                   ▼
              Provider layer      Session store       Git / LSP
              (AI SDK adapters)   (SQLite + JSONL)    (system git)
```

- **Daemon owns state.** The TUI/CLI/web are thin clients. A crashed UI never
  corrupts a session; a detached session keeps running.
- **In-process mode** (`--standalone`) hosts the daemon inside the CLI for users
  who do not want a background service.
- **SDK mode** imports the core directly with no socket.

### 3.2 Package graph

```
@harness/shared          types, zod schemas, errors, ids, event contracts
@harness/core            agent loop, sessions, providers, tools, permissions
@harness/provider-*      per-provider adapters (or one package with subpaths)
@harness/tools           built-in tool implementations
@harness/sandbox         OS sandbox adapters + policy
@harness/lsp             language-server client
@harness/mcp             MCP client + MCP server
@harness/plugin-sdk      public plugin API + loader
@harness/server          Hono HTTP + WS, OpenAPI, daemon lifecycle
@harness/cli             command parser, client wiring, auth, config commands
@harness/tui             Ink terminal UI
@harness/sdk             embeddable facade (re-exports core + server)
@harness/web             optional browser client (P2)
@harness/eval            benchmark runner, scorers, fixture corpus
@harness/test-utils      mock providers, fixtures, in-memory stores
```

Dependency rule: `tui`/`cli`/`server` → `core` → `shared`. `tools`, `sandbox`,
`lsp`, `mcp` are siblings injected into `core` via a `HarnessContext`. No cycles.
`plugin-sdk` depends only on `shared`.

---

## 4. Repository layout

```
harness/
├── plan.md
├── package.json                  # workspace root, scripts, engines
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
├── turbo.json                    # or moonrepo; task graph + caching
├── .github/workflows/            # ci.yml, release.yml, e2e.yml, eval.yml
├── .changeset/
├── config.schema.json            # published JSON schema
├── packages/
│   ├── shared/
│   │   ├── src/{events,schema,errors,ids,types}/
│   │   └── src/index.ts
│   ├── core/
│   │   ├── src/
│   │   │   ├── agent/            # loop, planner, compaction, prompts
│   │   │   ├── session/          # store, log, resume, checkpoints
│   │   │   ├── provider/         # registry, streaming, retries, fallback
│   │   │   ├── tools/            # registry, executor, scheduler, schema
│   │   │   ├── permissions/      # policy engine, matchers, prompts
│   │   │   ├── context/          # token budget, trimming, file budget
│   │   │   ├── git/              # repo detect, diff, worktree, commit
│   │   │   ├── memory/           # AGENTS.md hierarchy, memory tool
│   │   │   ├── skills/           # skill discovery + injection
│   │   │   ├── subagent/         # task delegation, parallel agents
│   │   │   └── index.ts
│   │   └── test/
│   ├── tools/src/{read,write,edit,patch,bash,grep,glob,web,task,todo}/
│   ├── sandbox/src/{linux,macos,windows,policy,docker}/
│   ├── lsp/src/
│   ├── mcp/src/{client,server,auth,transport}/
│   ├── plugin-sdk/src/
│   ├── server/src/{routes,ws,openapi,daemon}/
│   ├── cli/src/{commands,client,auth,config,output}/
│   ├── tui/src/{components,state,keybinds,theme,render}/
│   ├── sdk/src/
│   ├── eval/src/{runners,scorers,fixtures,adapters}/
│   └── test-utils/src/
├── apps/
│   └── web/                      # P2 browser UI (Vite + React)
├── docs/                         # docs site content (MDX)
├── examples/
│   ├── plugins/
│   ├── mcp-servers/
│   └── sdk-embed/
└── scripts/                      # dev bootstrap, binary build, smoke tests
```

---

## 5. Toolchain and runtime decisions

| Concern         | Choice                                                | Rationale / notes                               |
| --------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Language        | TypeScript, strict, ESM                               | Ecosystem + type-safe tool contracts            |
| Runtime         | Node ≥ 24 (dev on 26)                                 | Native `node:sqlite`, WebCrypto, test runner    |
| Package manager | pnpm 12 workspaces                                    | Fast, strict node_modules                       |
| Build           | `tsup`/esbuild for packages, `tsc --noEmit` for types | Fast; TS 7 native compiler evaluated in Phase 0 |
| Lint/format     | Biome 2.x                                             | Single tool, fast, config in JSON               |
| Test            | Vitest 5 + Docker + Playwright (web)                  | Unit, integration, e2e                          |
| Schema          | Zod 4 + `z.toJSONSchema`                              | Single source for config, tools, API            |
| Model layer     | Custom HTTP/SSE provider adapters                     | Exact control over streaming, tool calls, cost  |
| MCP             | `@modelcontextprotocol/sdk` 1.32+                     | Official; stdio + Streamable HTTP               |
| HTTP            | Hono 4                                                | Small, typed, SSE + manual OpenAPI              |
| TUI             | Ink 8 + React 19                                      | Component model; custom markdown/diff rendering |
| Highlighting    | Custom markdown/code rendering                        | Shiki/tree-sitter not integrated yet            |
| Persistence     | `node:sqlite` (WAL) + JSONL event mirror              | No native build; crash-safe replay              |
| Search          | `tinyglobby` + Node fallback                          | ripgrep fast path not integrated yet            |
| Git             | Not integrated yet                                    | `execFile` + system git planned                 |
| LSP             | `vscode-languageserver-protocol` + custom client      | Spawn stdio servers                             |
| Observability   | `pino` logs + OpenTelemetry SDK                       | Traces, metrics, cost                           |
| Packaging       | npm + standalone binaries + Docker + Homebrew         | `npx harness`, `brew install`, `docker run`     |

Notes:

- `node:sqlite` is experimental in some Node versions. The store ships behind a
  `Database` interface with a `better-sqlite3` fallback and an in-memory driver
  for tests.
- No native modules in the default install path. `node-pty` is optional (only
  for interactive shell tool); `bash` tool uses pipes + a persistent shell
  process by default.

---

## 6. Domain model

All entities live in `@harness/shared`. IDs are prefixed ULIDs (time-sortable).

```ts
type SessionID = `ses_${string}`;
type MessageID = `msg_${string}`;
type PartID = `prt_${string}`;
type ToolCallID = `call_${string}`;

interface Session {
  id: SessionID;
  title: string;
  cwd: string; // absolute, canonical
  gitRoot?: string;
  branch?: string;
  worktree?: string;
  model: ModelRef; // provider/model id + options
  agent: string; // agent id (build/plan/general/custom)
  parentID?: SessionID; // subagent parent
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running" | "waiting_permission" | "error" | "archived";
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: number; // USD, computed from model pricing
  permissions: PermissionMode;
  metadata: Record<string, unknown>;
}

interface Message {
  id: MessageID;
  sessionID: SessionID;
  role: "user" | "assistant" | "system" | "tool";
  parts: Part[];
  createdAt: string;
  modelID?: string;
  usage?: Usage;
  error?: HarnessError;
}

type Part =
  | { id: PartID; type: "text"; text: string; synthetic?: boolean }
  | { id: PartID; type: "reasoning"; text: string; providerMetadata?: unknown }
  | { id: PartID; type: "tool-call"; callID: ToolCallID; tool: string; input: unknown }
  | { id: PartID; type: "tool-result"; callID: ToolCallID; output: ToolOutput; state: ToolState }
  | { id: PartID; type: "file"; mime: string; url?: string; filename?: string }
  | { id: PartID; type: "step-start" }
  | { id: PartID; type: "step-finish"; usage?: Usage }
  | { id: PartID; type: "patch"; path: string; diff: string }
  | { id: PartID; type: "snapshot"; hash: string; at: string };

interface ToolState {
  status: "pending" | "running" | "completed" | "error" | "denied";
  input?: unknown;
  output?: ToolOutput;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

type ToolOutput =
  | { kind: "text"; text: string }
  | { kind: "json"; value: unknown }
  | { kind: "diff"; diff: string; files: FileChange[] }
  | { kind: "image"; mime: string; data: string }
  | { kind: "terminal"; stdout: string; stderr: string; exitCode: number }
  | { kind: "structured"; schema: string; value: unknown };
```

### 6.1 Event log (append-only)

```ts
type HarnessEvent =
  | { type: "session.created"; session: Session }
  | { type: "session.updated"; patch: Partial<Session> }
  | { type: "session.status"; status: Session["status"]; reason?: string }
  | { type: "message.created"; message: Message }
  | { type: "message.part.updated"; messageID: MessageID; part: Part }
  | { type: "message.completed"; messageID: MessageID; usage: Usage; cost: number }
  | { type: "tool.call"; callID: ToolCallID; tool: string; input: unknown; sessionID: SessionID }
  | { type: "tool.result"; callID: ToolCallID; output: ToolOutput }
  | { type: "permission.requested"; request: PermissionRequest }
  | { type: "permission.resolved"; requestID: string; decision: Decision }
  | { type: "turn.start"; turn: number; prompt: string }
  | { type: "turn.end"; turn: number; stopReason: string; usage: Usage }
  | { type: "compaction.started"; reason: string; tokensBefore: number }
  | { type: "compaction.completed"; summary: string; tokensAfter: number }
  | { type: "checkpoint.created"; hash: string; label: string }
  | { type: "error"; error: HarnessError; recoverable: boolean }
  | { type: "session.archived"; sessionID: SessionID };
```

- Persist as JSONL (`~/.harness/sessions/<id>/events.jsonl`) + a SQLite index
  for queries. Replay reconstructs the exact in-memory state.
- Checkpoints are git snapshots; `harness undo` restores.

---

## 7. Agent loop

### 7.1 Loop pseudocode

```
async function runTurn(session, userInput):
  append(user message)
  while true:
    if session.compaction needed: compact()
    context = buildContext(session)        // system + history + tools + memory
    stream = provider.stream({ model, messages, tools, signal, abortController })
    current = new assistant message
    for await (delta of stream):
      if delta.type == "text": append/update text part
      if delta.type == "reasoning": append reasoning part
      if delta.type == "tool-call": collect tool call (streaming args)
      if delta.type == "finish": record usage/cost
    if no tool calls:
      finish turn; return
    for call in safeParallelCalls(toolCalls):
      validate(call) -> permission decision -> execute(call) -> append result
    if aborted: persist partial; return
    if stop condition (max turns, repeated failure): return
```

Key rules:

- **Streaming first.** Text and tool-call argument deltas are emitted live; the UI
  never waits for the whole response.
- **Parallel tool calls.** Read-only tools (`read`, `grep`, `glob`, `ls`,
  `webfetch`, `lsp_*`, `git_status`, `todo_read`) may run concurrently. Mutating
  tools (`write`, `edit`, `bash`, `git_commit`, `patch`) are serialized per
  workspace to avoid races.
- **Tool call validation.** Every call is parsed against its Zod schema before
  execution. Unknown tool name → hard error returned to the model, not a crash.
- **Abort.** `Ctrl+C` / `session.abort()` cancels the HTTP request, kills child
  processes, and marks in-flight tool calls as `denied` with `aborted`.
- **Turn cap.** Default 100 assistant turns per user turn; configurable.
- **Duplicate tool call detection.** Identical `(tool, input)` within a session
  is blocked after N repeats to break loops.
- **Error recovery.** Provider 429/5xx → exponential backoff + jitter; context
  overflow → auto-compact; tool error → return structured error to model.

### 7.2 Prompt assembly

System prompt is composed from ordered, versioned sections:

1. Identity and operating rules.
2. Environment block (OS, cwd, git status, date, shell, model, permissions).
3. Project instructions (`AGENTS.md` / `HARNESS.md` hierarchy, nearest wins).
4. Memory (user/project memory files, capped).
5. Skills index (name + description + path; full body loaded on demand).
6. Tool usage guidance (generated from actual registered tool schemas).
7. MCP server instructions (capability summaries, trust level).
8. Session-specific constraints (plan mode, read-only, sandbox).

Sections are hashed; a change invalidates the prompt cache and is logged.

### 7.3 Planning and todos

- Built-in `todo_write` tool maintains a visible checklist; the system prompt
  requires it for multi-step work.
- `plan` agent mode is read-only: it may explore and write a plan file, but all
  mutating tools are denied at the policy layer (not just the prompt).
- Optional `plan.md` workflow: `/plan` seeds a plan document in the repo.

---

## 8. Provider layer

### 8.1 Supported providers (P0/P1)

| Provider                    | Transport                | Notes                             | Priority |
| --------------------------- | ------------------------ | --------------------------------- | -------- |
| Anthropic                   | `@ai-sdk/anthropic`      | Prompt caching, extended thinking | P0       |
| OpenAI                      | `@ai-sdk/openai`         | Responses API + chat fallback     | P0       |
| Google Gemini               | `@ai-sdk/google`         | Thinking, grounding               | P0       |
| xAI Grok                    | `@ai-sdk/xai`            | OpenAI-compatible                 | P1       |
| OpenRouter                  | OpenAI-compatible        | Model routing, fallbacks          | P1       |
| DeepSeek                    | OpenAI-compatible        | Cost-sensitive                    | P1       |
| Mistral                     | `@ai-sdk/mistral`        | EU hosting                        | P1       |
| AWS Bedrock                 | `@ai-sdk/amazon-bedrock` | Enterprise                        | P1       |
| Azure OpenAI                | `@ai-sdk/azure`          | Enterprise                        | P1       |
| Ollama / LM Studio / vLLM   | OpenAI-compatible        | Local, offline                    | P0       |
| Custom OpenAI-compatible    | env-configured base URL  | Self-hosted                       | P0       |
| Groq / Together / Fireworks | OpenAI-compatible        | Speed                             | P2       |

### 8.2 Provider contract

```ts
interface ProviderAdapter {
  id: string;
  listModels(): Promise<ModelInfo[]>;
  stream(req: StreamRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
  countTokens?(req: StreamRequest): Promise<number>;
  capabilities: ProviderCapabilities;
}
```

- Normalization layer maps provider-specific events to our `StreamEvent` union.
- Tool-call parsing handles provider quirks (XML-ish, JSON-in-text, missing ids).
- **Model registry:** cached `models.dev`-style metadata (context window, max
  output, pricing, vision, reasoning, tool support). Refresh daily; bundled
  snapshot for offline.
- **Fallback chains:** primary → secondary → local, triggered by auth/quota/5xx,
  configurable per session. Fallback emits a visible warning.
- **Auth:** env (`ANTHROPIC_API_KEY`, etc.), `harness auth login` OAuth/device
  flow, OS keychain, or `~/.harness/credentials.json` (0600). Never log secrets;
  redact by default.
- **Cost tracking:** tokens × per-model input/output/cache rates, accumulated per
  session and per turn; surfaced in TUI status line and `/cost`.

---

## 9. Tool catalog

Every tool has: stable id, Zod input schema, JSON Schema export, `readOnly`
flag, `parallelizable` flag, timeout, permission default, and a concise model
description. Tools are namespaced (`harness_read`, `mcp_<server>_<tool>`).

### 9.1 Built-in tools

| Tool               | Purpose                      | Key behavior                                                                 | P   |
| ------------------ | ---------------------------- | ---------------------------------------------------------------------------- | --- |
| `read`             | Read files                   | Offset/limit, image/PDF, line numbers, truncation notice, `.gitignore` aware | P0  |
| `write`            | Create/overwrite file        | Atomic write, parent dirs, backup, diff preview                              | P0  |
| `edit`             | Exact string replace         | Unique-match enforcement, fuzzy whitespace fallback, diff                    | P0  |
| `multi_edit`       | Multiple edits in one file   | Atomic apply, rollback on failure                                            | P0  |
| `apply_patch`      | Unified diff / patch         | `*** Begin Patch` format, reject malformed, 3-way context                    | P0  |
| `glob`             | Find files                   | `tinyglobby`, gitignore, hidden-file policy, max results                     | P0  |
| `grep`             | Content search               | ripgrep, regex/literal, context, multiline, file filter                      | P0  |
| `ls`               | Directory listing            | Tree depth, ignore rules, symlink policy                                     | P0  |
| `bash`             | Run shell command            | Persistent shell, timeout, streaming output, exit code, cwd, env allowlist   | P0  |
| `bash_output`      | Retrieve background output   | Read incrementally, non-blocking                                             | P1  |
| `kill_shell`       | Terminate background shell   | SIGTERM → SIGKILL escalation                                                 | P1  |
| `todo_write`       | Task checklist               | Replaces list, rendered in TUI                                               | P0  |
| `webfetch`         | Fetch URL                    | Markdown conversion, size cap, SSRF blocklist, no private IPs                | P1  |
| `websearch`        | Search web                   | Provider-backed (Brave/Exa/Serper), rate limits                              | P1  |
| `task`             | Delegate to subagent         | Isolated context, model/agent choice, parallel                               | P1  |
| `ask_user`         | Ask a clarifying question    | Blocks turn, structured options, TUI modal                                   | P1  |
| `view_image`       | Attach image to context      | Path/URL, resize, mime sniff                                                 | P1  |
| `lsp_diagnostics`  | Diagnostics for file/project | Waits for server, severity filter                                            | P1  |
| `lsp_symbols`      | Document/workspace symbols   | Outline, find symbol                                                         | P1  |
| `lsp_definition`   | Go to definition             | Jump target                                                                  | P1  |
| `lsp_hover`        | Hover info                   | Type/docs                                                                    | P1  |
| `lsp_references`   | Find references              | Rename preview support                                                       | P1  |
| `git_status`       | Repo status                  | Porcelain parse, staged/unstaged                                             | P1  |
| `git_diff`         | Diff                         | Working tree/staged/commit, stat                                             | P1  |
| `git_log`          | History                      | Graph, limit, author                                                         | P1  |
| `git_commit`       | Commit                       | Message from prompt, pre-commit hooks, sign-off                              | P1  |
| `git_branch`       | Branch/create/switch         | Worktree-aware                                                               | P1  |
| `worktree_create`  | Isolated worktree            | Branch per session, cleanup policy                                           | P1  |
| `snapshot`         | Create restore point         | Git commit or stash, label                                                   | P1  |
| `restore`          | Revert to snapshot           | Destructive → permission                                                     | P1  |
| `memory_write`     | Update memory files          | Scoped (user/project), dedupe                                                | P1  |
| `skill_load`       | Load skill body              | Inject into context                                                          | P1  |
| `notebook_edit`    | Edit `.ipynb`                | Cell-level ops, JSON-safe                                                    | P2  |
| `computer`         | Screenshot/click/type        | Playwright-backed, optional                                                  | P2  |
| `browser_navigate` | Browser control              | Playwright-backed, isolated profile                                          | P2  |
| `fetch`            | HTTP request                 | Method/headers/body, size cap                                                | P1  |
| `sleep`            | Wait                         | Non-blocking timer, cancellation                                             | P2  |

### 9.2 Tool execution pipeline

```
parse → schema validate → path normalization → permission check
      → sandbox wrap → timeout → stream output → normalize result
      → emit tool.result → append to transcript
```

Every tool result is bounded (default 30k chars text / 5 MB binary), with a
truncation marker and a path to the full output for retrieval.

### 9.3 MCP tools

- Namespaced and listed separately.
- Capability metadata (read-only/destructive/open-world) drives defaults.
- Destructive MCP tools always require confirmation in `acceptEdits`/default mode.
- Server instructions are injected into the prompt with trust level.

---

## 10. Permissions and security

### 10.1 Permission modes

| Mode                | Behavior                                                      |
| ------------------- | ------------------------------------------------------------- |
| `default`           | Ask before mutating tools and non-allowlisted shell commands  |
| `acceptEdits`       | Auto-allow file edits within workspace; ask for shell/network |
| `plan`              | Read-only; deny all mutations and network writes              |
| `bypassPermissions` | Allow all (explicit opt-in, warns loudly)                     |
| `custom`            | Policy from config/flags                                      |

### 10.2 Policy engine

```ts
interface PermissionPolicy {
  tool: string; // "*" allowed
  pattern?: string; // glob/regex against input path/command
  decision: "allow" | "ask" | "deny";
  scope: "session" | "project" | "user";
}
```

- First match wins; deny beats allow.
- Built-in dangerous-command detector (rm -rf /, curl | sh, chmod 777,
  force push, DB drops, env exfiltration) forces `ask` even in acceptEdits.
- Path policy: writes confined to workspace + explicit allowlist; reads outside
  workspace require confirmation; `..` traversal canonicalized and blocked.
- Shell policy: allowlist patterns, env var stripping (secrets), cwd enforcement.
- Network policy: private IP / metadata endpoint (169.254.169.254) blocking for
  `webfetch`/`fetch`; optional egress allowlist in sandbox.
- Secrets: redaction of known API keys/tokens in logs, tool output, and prompts;
  `.env` read requires permission; never send `.env` contents to a model without
  explicit approval.
- Prompt injection: untrusted content (web, MCP, file contents) is wrapped and
  labeled; system instructions are never derived from tool output; permission
  prompts show the exact command/path.
- Audit log: append-only `audit.jsonl` with actor, decision, tool, input hash.
- Credential storage: OS keychain → encrypted file → env, in that order.

### 10.3 Sandboxing

| OS      | Mechanism                                                   | Fallback         |
| ------- | ----------------------------------------------------------- | ---------------- |
| Linux   | bubblewrap + seccomp + cgroups v2; landlock where available | warning + prompt |
| macOS   | `sandbox-exec` profile                                      | warning + prompt |
| Windows | Job Objects + AppContainer (WSL2 recommended)               | warning + prompt |
| Any     | Docker/Podman container with mounted workspace              | none             |

- Sandbox policy: read-only root FS, writable workspace/tmp, no network by default
  for shell (configurable), CPU/memory/time limits, PID limit, no new privileges.
- `harness doctor` verifies the sandbox actually works (escape test, network test).
- Sandbox failure = deny execution with actionable error.

---

## 11. Context management and compaction

- **Token budget:** per-model context window minus output reserve (default 8k)
  and safety margin (10%).
- **Auto-compaction:** triggered at 80% (configurable). Summarizes older turns
  into a structured summary (goal, decisions, files, commands, open tasks,
  unresolved issues), keeps recent N turns verbatim, preserves tool results for
  edited files.
- **File budget:** large file reads are truncated with an offset hint; project
  file tree is capped; `AGENTS.md` injected fully.
- **Micro-compaction:** when a single tool result is oversized, replace with a
  summary + pointer rather than compacting the whole session.
- **Manual controls:** `/compact`, `/clear`, `/context`, `harness compact`.
- **Prompt caching:** stable prefix ordering; cache-friendly breakpoints for
  Anthropic; usage deltas reported.

---

## 12. Sessions and persistence

- Store layout:

```
~/.harness/
├── sessions/<sessionID>/
│   ├── meta.json
│   ├── events.jsonl
│   ├── messages.jsonl
│   └── checkpoints/
├── index.db              # SQLite: sessions, messages, FTS, usage
├── logs/                 # structured logs
├── audit.jsonl
├── credentials.json      # 0600
├── cache/models.json
└── config.json           # user-level config
```

- **Resume:** `harness --resume <id>`, `--continue` (latest in cwd), TUI session
  picker.
- **Fork:** branch a session from any message (copy-on-write event log).
- **Export:** `harness export <id> --format md|json|html`.
- **Search:** full-text over messages/tool output (SQLite FTS5).
- **Retention:** configurable TTL; auto-archive idle sessions.
- **Recovery:** WAL + periodic snapshot; replay events on startup; corrupt tail
  is truncated with a warning, never fatal.
- **Concurrency:** one writer per session (mutex); multiple readers; daemon
  serializes writes. Subagent sessions are separate IDs with `parentID`.

---

## 13. Git integration

- Repo detection (`.git` upward), worktree support, submodule awareness.
- Per-session optional worktree at `~/.harness/worktrees/<sessionID>` with branch
  `harness/<slug>`; cleanup policy on archive.
- Diff rendering in TUI with syntax highlighting and intra-line changes.
- Checkpoint before risky operations; one-command revert.
- Commit workflow: `git_commit` builds message from staged diff, runs hooks,
  refuses secrets (`.env`, keys) unless explicitly allowed.
- PR helpers (P2): `gh pr create` integration with confirmation.

---

## 14. LSP integration

- Spawn language servers from config (per-language command, args, env).
- Lifecycle: initialize → initialized → didOpen → diagnostics → shutdown.
- On file edit: `didChange`, debounce 300 ms, surface diagnostics in TUI and to
  the model via `lsp_diagnostics`.
- Capabilities: hover, definition, references, symbols, rename (preview only),
  formatting (optional, permissioned).
- Health: timeout, crash restart with backoff, max restarts, disable on failure.
- Built-in defaults for typescript-language-server, pyright, rust-analyzer,
  gopls; auto-detect installed binaries.

---

## 15. MCP (Model Context Protocol)

- Transports: stdio (spawn), SSE (legacy), Streamable HTTP.
- Config:

```json
{
  "mcp": {
    "servers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": { "GITHUB_TOKEN": "{env:GITHUB_TOKEN}" }
      },
      "remote": { "url": "https://mcp.example.com", "auth": "oauth" }
    }
  }
}
```

- Features: tool/resource/prompt discovery, namespacing, capability filtering,
  connection status, per-server enable/disable, timeouts, retries, health checks,
  OAuth 2.1 + PKCE with token refresh, header/env interpolation (`{env:VAR}`).
- MCP server mode: `harness mcp serve` exposes built-in tools over stdio/HTTP so
  other agents can use this harness as a tool provider.
- Trust: servers are untrusted by default; destructive tools require permission;
  server instructions are labeled and never override system rules.

---

## 16. Plugins, hooks, skills, commands, memory

### 16.1 Plugin API

```ts
interface Plugin {
  id: string;
  hooks?: {
    "session.start"?: (ctx) => void | Promise<void>;
    "message.received"?: (ctx, message) => Message | void;
    "tool.before"?: (ctx, call) => ToolCall | "block" | void;
    "tool.after"?: (ctx, result) => ToolOutput | void;
    "permission.request"?: (ctx, req) => Decision | void;
    event?: (ctx, event) => void;
    config?: (config) => config;
  };
  tools?: ToolDefinition[];
  commands?: CommandDefinition[];
  agents?: AgentDefinition[];
  themes?: Theme[];
  tui?: TuiExtension; // P2
}
```

- ESM plugins loaded from config (`plugins: ["@scope/plugin", "./local.ts"]`),
  sandboxed import, version compatibility check, error isolation.
- Plugin context exposes a restricted API: fs (workspace-scoped), events,
  logger, config, HTTP (with permission), and tool registry.
- Hot reload on config change.

### 16.2 Skills

- Markdown files with YAML frontmatter: `name`, `description`, `when`, `tools`,
  `model`.
- Discovery: `~/.harness/skills/`, `.harness/skills/`, plugin-provided.
- Only name+description injected by default; `skill_load` pulls the body on
  demand (context-efficient).
- Skills can declare required binaries and fail with an actionable message.

### 16.3 Commands and agents

- Custom slash commands: markdown templates with `$ARGUMENTS`, `$1..$9`, shell
  interpolation (permissioned), file references (`@file`).
- Custom agents: model, prompt, tool allowlist, permission mode, temperature,
  max turns.
- Built-in agents: `build` (default), `plan` (read-only), `general`, `review`,
  `test`.
- Output styles: concise/verbose/emoji-free, configurable per user.

### 16.4 Memory

- Hierarchy: user `~/.harness/memory/*.md` → project `AGENTS.md` /
  `HARNESS.md` → subdirectory overrides.
- `memory_write` dedupes and appends with timestamps; `/memory` to view/edit.
- Memory is capped (default 20k tokens) with LRU eviction.
- Explicit "remember this" flow; no silent background writes to memory.

---

## 17. Subagents and parallelism

- `task` tool spawns a child session with isolated context, own model/agent,
  own tool policy, and a result contract.
- Modes: `single`, `parallel` (N independent tasks), `pipeline` (staged).
- Background agents: run detached, emit events to parent, can be polled/wait.
- Limits: max concurrent subagents (default 4), max depth (2), token budget per
  task, cancellation propagation.
- Parent receives only the summary + artifacts (not full transcript) to protect
  context.
- Subagent permissions inherit a filtered policy; mutations require approval
  unless explicitly delegated.

---

## 18. TUI specification

- Stack: Ink 8 + React 19; custom renderer for diffs/markdown; Shiki for code.
- Layout: transcript (scrollable), composer, status line, tool panels, modals.
- Streaming: tokens append live; tool calls show inline status; results collapse.
- Markdown: headings, lists, tables, code blocks with copy, links (open on
  click), images (terminal protocol or path).
- Diffs: unified + side-by-side toggle, syntax colors, line numbers, wrap.
- Composer: multi-line, `@file` completion, `/command` palette, `#memory`,
  history (up/down), paste image, undo (Ctrl+Z), external editor (Ctrl+G).
- Keybindings: fully configurable (`cli.json`), leader key, vim mode optional.
- Features: session switcher, model picker, permission modal, `/cost`,
  `/context`, `/compact`, `/resume`, `/agents`, `/mcp`, `/plugins`, `/doctor`,
  `/theme`, `/help`, `/exit`.
- Accessibility: NO_COLOR, reduced motion, 256/truecolor detection, unicode
  fallback, screen-reader-friendly mode, adjustable line height.
- Terminal compatibility: Windows Terminal, iTerm2, kitty, Alacritty, tmux,
  SSH; graceful degradation on tiny terminals.
- Notifications: terminal bell / desktop notification on permission request
  when unfocused (opt-in).
- Themes: built-in set + JSON theme files; syntax theme separate.

---

## 19. CLI specification

```
harness [options] [prompt]          # TUI (default)
harness run [options] [prompt]      # non-interactive
harness exec [options] [prompt]     # alias for run, CI-friendly
harness serve [options]             # daemon
harness auth {login,logout,status}
harness models {list,search,default}
harness mcp {list,add,remove,auth,serve}
harness plugins {list,install,remove}
harness sessions {list,show,export,delete,compact}
harness config {get,set,path,edit,schema}
harness eval {run,report}
harness doctor
harness update {check,install}
harness completion {bash,zsh,fish}
```

Global flags:

| Flag                                         | Meaning                         |
| -------------------------------------------- | ------------------------------- |
| `--model <provider/model>`                   | Override model                  |
| `--agent <id>`                               | Agent preset                    |
| `--cwd <dir>`                                | Working directory               |
| `--session <id>` / `--continue` / `--resume` | Session selection               |
| `--permission-mode <mode>`                   | default/acceptEdits/plan/bypass |
| `--allowed-tools <list>`                     | Tool allowlist                  |
| `--disallowed-tools <list>`                  | Tool denylist                   |
| `--mcp-config <file>`                        | Extra MCP config                |
| `--max-turns <n>`                            | Turn cap                        |
| `--output-format <text                       | json                            | stream-json>` | Machine output |
| `--verbose` / `--quiet`                      | Log level                       |
| `--no-sandbox`                               | Disable sandbox (warns)         |
| `--standalone`                               | In-process daemon               |
| `--version` / `--help`                       |                                 |

Headless contract:

- Exit codes: 0 success, 1 error, 2 invalid usage, 130 interrupted.
- `--output-format json` emits a final JSON object with `result`, `usage`,
  `cost`, `sessionID`, `toolCalls`.
- `stream-json` emits newline-delimited events compatible with CI parsing.
- stdin prompt support; `--print` alias.

---

## 20. Server and API

- Hono server; HTTP/1.1 + WebSocket; optional HTTPS; bearer token for remote.
- Daemon lifecycle: `harness serve` starts or attaches; Unix socket on POSIX,
  named pipe on Windows; PID + health file; `service status|restart|stop`.
- OpenAPI 3.1 generated from Zod; `/openapi.json`; interactive docs at `/docs`.
- Core endpoints:

```
GET    /health
GET    /info
GET    /models
GET    /sessions
POST   /sessions
GET    /sessions/:id
DELETE /sessions/:id
POST   /sessions/:id/prompt          # streaming (SSE)
POST   /sessions/:id/abort
POST   /sessions/:id/compact
POST   /sessions/:id/fork
GET    /sessions/:id/events          # SSE replay
GET    /sessions/:id/messages
POST   /sessions/:id/permissions/:requestId
GET    /sessions/:id/diff
POST   /sessions/:id/checkpoint
POST   /sessions/:id/restore
GET    /tools
GET    /mcp/servers
POST   /mcp/servers/:name/restart
GET    /config
PATCH  /config
GET    /events                        # global SSE stream
WS     /ws                            # bidirectional events + input
```

- Auth: local socket/trusted origin by default; remote requires token + optional
  mTLS. CORS restricted to configured origins.
- Rate limits, request size caps, timeouts.
- Client SDK generated from OpenAPI for type safety.

---

## 21. SDK

```ts
import { createHarness } from "@harness/sdk";

const harness = createHarness({
  cwd: process.cwd(),
  model: "anthropic/claude-sonnet-4-5",
  permissionMode: "acceptEdits",
});

const session = await harness.session.create();
for await (const event of session.prompt("Fix the failing test")) {
  if (event.type === "message.part.updated") render(event.part);
}
```

- Embeds the core in-process (no socket), reuses plugin/tool/MCP registries.
- Exposes `Harness`, `Session`, `ToolRegistry`, `PermissionPolicy`,
  `ProviderRegistry`, `EventStream`.
- Framework-agnostic; works in Node, Bun, Electron main, edge runtimes with
  documented limits (no shell sandbox).
- Stable semver; typed errors; cancellation via `AbortSignal`.

---

## 22. Configuration

Precedence (low → high): defaults → user `~/.harness/config.json` → project
`.harness/config.json` → `.harness/config.local.json` → env (`HARNESS_*`) → CLI
flags.

Schema highlights:

```json
{
  "$schema": "https://harness.dev/config.schema.json",
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-haiku-4-5",
  "agent": "build",
  "permissions": { "default": "ask", "rules": [] },
  "providers": {},
  "mcp": { "servers": {} },
  "tools": { "bash": { "timeout": 120000, "sandbox": true } },
  "lsp": { "servers": {} },
  "skills": { "paths": [] },
  "plugins": [],
  "instructions": ["AGENTS.md"],
  "sandbox": { "enabled": true, "network": false },
  "telemetry": { "enabled": false },
  "ui": { "theme": "default", "keybinds": {} }
}
```

- Validated with Zod; published JSON Schema; editor autocomplete.
- Hot reload via `fs.watch` (debounced); invalid config logs and keeps last good.
- Secrets use `{env:VAR}` interpolation; never written to config in plaintext.
- `harness config edit` opens `$EDITOR`; `config schema` prints the schema.
- Project-local CLI preferences live in `.harness/cli.json`.

---

## 23. Observability

- Structured JSON logs (pino) with `sessionID`, `turn`, `tool`, `provider`,
  `latencyMs`, `tokens`, `cost`; levels `debug|info|warn|error`.
- OpenTelemetry: spans for turn → provider call → tool execution; metrics for
  latency, tokens, cost, errors; optional OTLP exporter.
- Session replay: `--replay <id>` re-emits events to a file for debugging.
- Cost dashboard: `/cost`, `harness sessions show --cost`, JSON export.
- Telemetry opt-in, anonymous, PII-free; explicit consent screen on first run;
  `HARNESS_TELEMETRY=0` disables.
- Crash reporting opt-in with redaction; `harness doctor` collects diagnostics.

---

## 24. Evaluation harness

Even an agent harness needs its own regression tests.

- **Golden transcripts:** fixture prompts + mocked provider streams → expected
  event sequences/tool calls; snapshot-tested.
- **Trajectory eval:** run the agent on fixture repos (sandboxed), score final
  state: tests pass, diff correctness, lint clean, no unintended files.
- **Tool-call accuracy:** for a dataset of tasks, measure correct tool selection
  and argument validity.
- **Regression corpus:** curated bugs (off-by-one, patch fuzz, context overflow,
  abort mid-tool, permission denial) run in CI.
- **Benchmark adapters (optional):** SWE-bench Lite, Terminal-Bench; results
  stored as JSON + markdown report.
- **Scoring:** pass/fail, partial credit, cost, latency, token efficiency.
- **Model comparison:** matrix run across providers; publish per-model scores.
- Deterministic mode: fixed seeds, recorded fixtures, no network.

---

## 25. Testing strategy

| Layer       | Tool                               | Coverage                                                      |
| ----------- | ---------------------------------- | ------------------------------------------------------------- |
| Unit        | Vitest                             | Schemas, policy engine, parsers, compaction, pricing          |
| Property    | fast-check                         | Patch application, glob matching, diff parsing, event reducer |
| Integration | Vitest + temp dirs + fake provider | Full turn loop, permissions, tool exec, resume                |
| Provider    | Recorded HTTP cassettes            | Streaming, tool calls, retries, errors                        |
| Sandbox     | Docker + CI matrix                 | bwrap/seatbelt behavior, escape attempts                      |
| MCP         | In-memory mock servers             | stdio/HTTP, OAuth, failure modes                              |
| LSP         | Real language servers              | Diagnostics, hover, symbols                                   |
| TUI         | ink-testing-library + snapshots    | Rendering, keybindings, streaming                             |
| API         | Hono test client                   | Routes, auth, SSE, WS                                         |
| E2E         | Playwright (web) + CLI scripts     | User flows                                                    |
| Eval        | `@harness/eval`                    | Trajectory quality                                            |

Quality gates: 100% type-check, lint clean, unit ≥ 85% lines on core, all P0
paths covered, no flaky tests (retry budget 0 in CI), mutation testing on the
policy engine and patch parser.

---

## 26. CI/CD and release

- CI on every PR: install (pnpm, cached), typecheck, lint, unit, integration,
  build, bundle size check, API schema diff, e2e (Linux/macOS), Docker sandbox
  test, eval smoke.
- Nightly: full eval, dependency audit, provider contract tests, fuzzing.
- Release: changesets → version bump → build binaries → npm publish → Homebrew
  formula → Docker image → GitHub release notes.
- Distribution:
  - `npm i -g harness` / `npx harness`
  - standalone binaries (Linux x64/arm64, macOS x64/arm64, Windows x64)
  - `docker run -it --rm -v $PWD:/work harness`
  - `brew install harness`
- Update mechanism: version check (cached 24h), signed manifest, rollback.
- Branching: `main` protected; conventional commits; trunk-based; release tags
  `vX.Y.Z`.
- Security: `npm audit`, CodeQL, secret scanning, signed commits for releases,
  SBOM (CycloneDX), provenance attestations.

---

## 27. Documentation and developer experience

- README: install, quickstart, 5-minute demo, feature table, comparison.
- Docs site (MDX): concepts, configuration, tools, permissions, sandbox, MCP,
  plugins, SDK, API, CLI, TUI, evals, troubleshooting, security model.
- `AGENTS.md` at repo root documenting architecture for agents.
- ADRs for major decisions (`docs/adr/`).
- Man page + shell completions + `--help` examples.
- Example plugins, MCP servers, SDK embeds under `examples/`.
- Contributing guide, code of conduct, security policy, issue templates.
- Changelog generated from changesets; migration guides for breaking changes.
- `harness doctor` for environment diagnostics; `harness --explain <error>` for
  actionable hints.

---

## 28. Milestones

Durations are estimates for one senior engineer; adjust for team size.

### M0 — Foundation (Week 1)

- Monorepo, tsconfig, Biome, Vitest, CI skeleton, changesets.
- `@harness/shared` schemas/events/errors; JSON Schema generation.
- `harness --version`, `doctor` stub, structured logging.
- **Acceptance:** `pnpm build && pnpm test && pnpm lint` green in CI.

### M1 — Agent core (Weeks 2–3)

- Provider registry + Anthropic/OpenAI/Gemini/Ollama adapters.
- Agent loop, streaming, tool registry, permission engine.
- Tools: read, write, edit, glob, grep, ls, bash, todo.
- CLI `harness run` + `--print` + JSON output; config loading.
- **Acceptance:** non-interactive agent edits a file, runs tests, and reports
  results on a fixture repo with mocked + real provider.

### M2 — Sessions and safety (Week 4)

- SQLite + JSONL store, resume/fork/export, event replay.
- Checkpoints, undo, compaction, token/cost accounting.
- Path/shell/network permissions, dangerous-command detection, audit log.
- **Acceptance:** crash mid-turn, restart, resume with full context; denied
  commands never execute.

### M3 — TUI v1 (Weeks 5–6)

- Ink UI: transcript, composer, streaming, diffs, tool panels, modals.
- Session picker, model picker, slash commands, keybindings, themes.
- Syntax highlighting, markdown, file completion, permission prompts.
- **Acceptance:** full interactive workflow: explore → edit → test → commit,
  with permission prompts and resumable sessions.

### M4 — Extensibility (Weeks 7–8)

- MCP client (stdio/HTTP/OAuth), MCP server mode.
- Plugin API, hooks, custom tools/commands/agents, skills, memory.
- Subagents (`task`), parallel execution, background agents.
- **Acceptance:** third-party plugin adds a tool + hook; MCP server tools are
  usable; a subagent completes an isolated task and returns a summary.

### M5 — Deep integrations (Weeks 9–10)

- Sandbox adapters (bwrap/seatbelt/Docker) + policy + doctor verification.
- LSP client (TS/Python/Rust/Go defaults) + diagnostics after edits.
- Git worktrees, diffs, commit flow, snapshot/restore.
- Web tools (`webfetch`, `websearch`), images/PDF.
- **Acceptance:** sandboxed shell cannot write outside workspace; diagnostics
  appear after edits; worktree session commits cleanly.

### M6 — Server, SDK, ecosystem (Weeks 11–12)

- Daemon, HTTP/WS API, OpenAPI, auth, remote access.
- `@harness/sdk` embed + examples.
- `@harness/plugin-sdk` published; plugin registry docs.
- Optional web client (P2) behind a flag.
- **Acceptance:** TUI connects to daemon over WS; SDK app drives a session;
  API passes contract tests; remote access requires auth.

### M7 — Quality and release (Weeks 13–14)

- Eval suite + golden transcripts + benchmark smoke.
- Perf: cold start < 300 ms, TUI input latency < 50 ms, tool overhead < 20 ms.
- Security review, fuzzing, dependency audit, SBOM.
- Docs site, examples, completions, binaries, Homebrew, Docker.
- **Acceptance:** 1.0 release checklist complete; no P0/P1 bugs; eval
  regression suite green; reproducible install on all platforms.

---

## 29. Task breakdown (checklist)

### Foundation

- [ ] pnpm workspace + turbo task graph
- [ ] tsconfig strict + path aliases + build (tsup)
- [ ] Biome config + pre-commit hook (lefthook)
- [ ] Vitest + coverage thresholds
- [ ] Changesets + release workflow
- [ ] `@harness/shared`: events, schemas, errors, ids
- [ ] JSON Schema generation script
- [ ] Structured logging + OTel bootstrap
- [ ] `harness --version`, `--help`, `doctor`

### Core

- [ ] Provider registry + model metadata cache
- [ ] Adapters: Anthropic, OpenAI, Gemini, Ollama, OpenAI-compatible
- [ ] Streaming normalizer + tool-call parser
- [ ] Retry/backoff/fallback/cost accounting
- [ ] Agent loop + abort + turn caps + duplicate detection
- [ ] Tool registry + schema validation + executor
- [ ] Permission policy engine + modes + dangerous commands
- [ ] Prompt assembly + section hashing
- [ ] Compaction + token budgeting
- [ ] Context file budget + truncation
- [ ] Built-in tools (P0 set)
- [ ] Snapshot/checkpoint + restore
- [ ] Session store + event replay + fork + export + search
- [ ] Git detection/diff/worktree/commit
- [ ] Memory + skills + commands + agents
- [ ] Subagents + parallel scheduler

### Safety

- [ ] Path canonicalization + workspace confinement
- [ ] Shell allowlist + env scrubbing + timeout
- [ ] Network SSRF/private-IP blocking
- [ ] Secret redaction across logs/output/prompts
- [ ] Sandbox: Linux bwrap, macOS seatbelt, Docker
- [ ] Audit log + permission history
- [ ] Prompt-injection labeling for untrusted content

### Interfaces

- [ ] CLI commands + flags + output formats + completions
- [ ] TUI components + keybinds + themes + diff/markdown render
- [ ] Server routes + SSE + WS + auth + OpenAPI
- [ ] SDK facade + examples
- [ ] MCP client/server + OAuth
- [ ] Plugin SDK + loader + hooks + hot reload

### Integrations

- [ ] LSP client + diagnostics + hover/symbols
- [ ] Web fetch/search tools
- [ ] Image/PDF reading
- [ ] Notebook editing
- [ ] GitHub/PR helpers (P2)
- [ ] Browser automation (P2)

### Quality

- [ ] Golden transcript tests
- [ ] Provider cassette tests
- [ ] Sandbox escape tests
- [ ] Fuzz patch/diff/glob parsers
- [ ] TUI snapshot tests
- [ ] API contract tests
- [ ] Eval suite + report
- [ ] Perf budget tests
- [ ] Docs site + examples + ADRs

---

## 30. Performance budgets

| Metric                                   | Target          |
| ---------------------------------------- | --------------- |
| CLI cold start (TUI)                     | < 300 ms p95    |
| First token after prompt (cached prefix) | < 800 ms p50    |
| Keystroke → render                       | < 50 ms p95     |
| Tool spawn overhead (bash)               | < 20 ms         |
| Event replay 10k events                  | < 200 ms        |
| Session search 10k messages              | < 100 ms        |
| Memory (idle TUI)                        | < 150 MB        |
| Disk per session                         | < 50 MB typical |
| Context assembly                         | < 30 ms p95     |

Measure with `scripts/perf/*` in CI on a fixed runner; fail on >20% regression.

---

## 31. Risks and mitigations

| Risk                                     | Impact   | Mitigation                                                               |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------ |
| Provider API drift / undocumented quirks | High     | Adapter per provider, cassette tests, version pinning, capability matrix |
| Sandbox escape                           | Critical | Defense in depth, `doctor` verification, fail-closed, audit              |
| Prompt injection via web/MCP             | High     | Labeling, permission prompts, no auto-exec, content isolation            |
| Context overflow / compaction bugs       | High     | Budget tests, golden transcripts, conservative defaults                  |
| Terminal incompatibility                 | Medium   | Capability detection, fallbacks, CI matrix on real terminals             |
| Scope creep                              | High     | P0/P1/P2 matrix, milestone gates, non-goals                              |
| Cost blowups                             | Medium   | Budgets, cost display, small-model routing, caps                         |
| Native module / platform issues          | Medium   | No native deps in default path, optional adapters                        |
| Node experimental APIs                   | Medium   | Interface abstraction + fallback driver                                  |
| License/compliance of models             | Medium   | Attribution docs, data-flow disclosure                                   |
| MCP server trust                         | High     | Treat as untrusted, capability flags, approval                           |
| Long-running sessions degrade            | Medium   | Compaction, retention, perf budgets, soak tests                          |

---

## 32. Feature matrix (acceptance checklist)

Legend: P0 = 1.0 blocker, P1 = release blocker, P2 = post-1.0.

### Agent

- [x] Streaming text/reasoning/tool calls (P0)
- [x] Parallel read-only tools (P0)
- [x] Abort/interrupt (P0)
- [x] Turn caps + loop detection (P0)
- [x] Retry/backoff/fallback (P0)
- [x] Multi-step planning + todos (P0)
- [x] Plan mode (P1)
- [x] Background/async agents (P1)
- [x] Subagent orchestration (P1)
- [x] Model routing/small-model (P1)
- [x] Prompt caching (P1)
- [x] Reasoning-effort control (P1)

### Tools

- [x] read/write/edit/multi-edit/patch (P0)
- [x] glob/grep/ls (P0)
- [x] bash + background shells (P0/P1)
- [x] webfetch/websearch/fetch (P1)
- [x] LSP diagnostics/symbols/definition/references/hover (P1)
- [x] git status/diff/log/commit/branch/worktree (P1)
- [x] snapshot/restore (P1)
- [x] memory/skill load (P1)
- [x] ask_user (P1)
- [x] image/PDF read (P1)
- [x] notebook edit (P2)
- [x] browser/computer use (P2)

### Safety

- [x] Permission modes + rules (P0)
- [x] Path confinement + traversal block (P0)
- [x] Dangerous command detection (P0)
- [x] Secret redaction (P0)
- [x] Sandbox Linux/macOS/Docker (P1)
- [x] Network egress policy (P1)
- [x] Audit log (P1)
- [x] Prompt-injection labeling (P1)

### Sessions

- [x] Persistence + replay (P0)
- [x] Resume/continue (P0)
- [x] Fork/export/search (P1)
- [x] Checkpoints/undo (P1)
- [x] Compaction/context UI (P1)
- [x] Retention/cleanup (P2)

### Interfaces

- [x] TUI full workflow (P0)
- [x] CLI run/headless/JSON (P0)
- [x] Server HTTP/WS/OpenAPI (P1)
- [x] SDK embed (P1)
- [x] Plugin SDK + hooks + hot reload (P1)
- [x] MCP client + server + OAuth (P1)
- [x] Skills/commands/agents/memory (P1)
- [x] Web client (P2)

### Quality

- [x] Unit/integration/e2e (P0/P1)
- [x] Provider cassettes (P0)
- [x] Golden transcripts (P1)
- [x] Sandbox escape tests (P1)
- [x] Fuzz patch/diff/glob (P1)
- [x] Perf budgets (P1)
- [x] Eval suite + benchmark adapter (P1)
- [x] Docs + completions + binaries + Docker (P1)

---

## 33. Definition of done (1.0)

A feature is done when:

1. Implemented in a package with public types and no `any` in public APIs.
2. Unit + integration tests cover success, failure, and boundary cases.
3. Permission/security implications are documented and tested.
4. Works across Linux and macOS; Windows documented with fallbacks.
5. Observability: logs/metrics/cost emitted; errors are actionable.
6. Docs updated (reference + example) and JSON Schema regenerated.
7. No new P0/P1 lint/type/test failures; perf budget respected.
8. Reviewed against the feature matrix in §32.

Release gate:

- All P0/P1 matrix items checked.
- Eval regression suite green on the pinned model set.
- Security review signed off; SBOM attached.
- Install smoke test on clean machines (npm, binary, Docker).
- Migration guide + changelog published.

---

## 34. Open decisions

1. **Name/branding:** `harness` is a placeholder; confirm before package publish.
2. **Provider abstraction:** hand-rolled HTTP/SSE adapters were selected over the
   Vercel AI SDK for exact control over tool-call streaming, retries, and cost.
   Revisit if provider coverage grows beyond the current set.
3. **Persistence:** `node:sqlite` vs `better-sqlite3`; benchmark in M2.
4. **TypeScript:** TS 7 native compiler vs TS 5.9 for tooling compatibility;
   evaluate in M0.
5. **Web UI:** build in-house vs defer to P2.
6. **Benchmark adapters:** include SWE-bench/Terminal-Bench at 1.0 or later.
7. **Telemetry:** default off vs opt-in prompt; legal review required.
8. **Windows sandbox:** passthrough execution is the default; Docker/WSL2 is the
   documented isolation path. Native AppContainer is not implemented.

---

## 35. Immediate next steps

1. Approve this plan and the naming decision.
2. Create the monorepo scaffold (M0).
3. Spike: AI SDK streaming + one provider + one tool end-to-end.
4. Spike: `node:sqlite` + event replay on a synthetic session.
5. Publish `config.schema.json` and the event contract before UI work starts.
6. Open a tracking issue per milestone; link this document.
