# Security Policy

## Reporting

Report vulnerabilities privately via GitHub Security Advisories:
<https://github.com/kilncraft/kilncraft/security/advisories/new>.

Do not open public issues for undisclosed vulnerabilities.

## Threat model

Kilncraft executes model-authored tools on a developer machine. The security
boundaries are:

1. **Permission engine** — first match wins; deny beats allow; unknown tools fail
   closed; dangerous shell patterns force approval.
2. **Path confinement** — writes are canonicalized and confined to the workspace;
   traversal outside the workspace is denied.
3. **Secret redaction** — API keys, bearer tokens, passwords, and credentials are
   redacted from logs, audit records, and tool output.
4. **Audit log** — every permission decision is recorded with a hash of the input,
   not the raw secret-bearing payload.
5. **MCP/plugin trust** — MCP servers and plugins are untrusted by default;
   destructive tools require approval; plugin hooks cannot override system rules.

## Current limitations

- **No OS-level sandbox in v1.0.** Bash runs as the current user with permission
  checks and command policy. Docker/WSL2 isolation is recommended for untrusted
  repositories.
- **MCP HTTP server is not exposed by default.** The MCP stdio server runs only
  when explicitly started.
- **Remote server access requires `KILNCRAFT_TOKEN`.** Local Unix-socket access is
  trusted by design.
- **Telemetry is opt-in and anonymous.**

## Hardening checklist

- Run with `--permission-mode default` for untrusted repos.
- Set `KILNCRAFT_TOKEN` when binding the server to a non-loopback address.
- Do not run with `bypassPermissions` unless you trust the model and tools.
- Keep dependencies patched; CI runs `pnpm audit` and CodeQL.
- Review MCP server and plugin sources before enabling them.

## Supported versions

The latest 1.x release receives security fixes.
