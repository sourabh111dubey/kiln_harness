# Contributing

Thanks for helping build Kilncraft.

## Setup

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

Requires Node.js >= 24 and pnpm 12.

## Architecture

- `packages/shared` — schemas, events, errors, config, logging, contracts.
- `packages/core` — agent loop, providers, tools, permissions, sessions, plugins.
- `packages/cli` — command-line interface.
- `packages/tui` — Ink terminal UI.
- `packages/server` — HTTP/SSE daemon.
- `packages/sdk` — in-process embeddable API.
- `packages/mcp` — MCP client/server.
- `packages/plugin-sdk` — plugin types.

Read [plan.md](./plan.md) and the ADRs in `docs/adr/` (when present) before
large changes.

## Tests

```sh
pnpm test                 # all packages
pnpm perf                 # performance budgets
pnpm perf:check           # fail on budget regression
pnpm schema               # regenerate config.schema.json
```

Every change should include tests. Provider changes need cassette tests; tool
changes need success, failure, and permission cases; parser changes need fuzz
properties.

## Commits and changesets

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
- Add a changeset with `pnpm changeset` for user-visible changes.
- Keep public APIs typed; no `any` in public signatures.

## Release

1. Merge changesets to `main`.
2. Run the release workflow by pushing a `vX.Y.Z` tag.
3. The workflow publishes npm packages, builds the Docker image, creates the
   GitHub release, and attaches the SBOM.

## Security

See [SECURITY.md](./SECURITY.md). Do not include secrets in issues, fixtures, or
golden transcripts.
