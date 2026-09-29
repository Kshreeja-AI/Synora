# Synora Control Center

A developer-only VS Code panel for this repository. It runs commands that
already exist here and shows their real output.

**It is not part of the Synora application.** It is deliberately outside the
pnpm workspace (`pnpm-workspace.yaml` covers `apps/*` and `packages/*` only),
so it cannot affect `pnpm install`, the test suites, the build, or CI.

## Run it

```bash
cd tools/synora-control-center
npm install
npm run compile
```

Then in VS Code: **Run and Debug → Run Extension** (F5). A new window opens
with the Synora icon in the activity bar.

Alternatively, without the panel, every button is also a command in the
palette (`Ctrl+Shift+P` → "Synora: …").

## What it does

| Button | Runs |
|---|---|
| Run Backend Tests | `vitest run` in `apps/backend` |
| Run Web Tests | `vitest run` in `apps/web` |
| Typecheck | `pnpm run type-check` |
| Lint | `eslint src --ext .ts` |
| Dependency Audit | `pnpm audit --audit-level low` |
| Security Guardrails | `node scripts/guardrails.mjs` |
| Capability Report | `tsx src/cli/capabilityReport.ts` |
| Check Docker | `docker ps` |
| Check Environment | `scripts/check-env.ps1` |
| Local Smoke Test | the fast test subset, no database needed |
| Generate Launch Report | the four checks above, in sequence |

## What it deliberately does not do

- **No deploy, DNS, VPS or production-migration button.** Those operations are
  absent rather than guarded: a developer UI is exactly where a misclick
  happens, and none of them is recoverable by clicking again.
- **No second orchestrator, provider registry, configuration or daemon.** It
  spawns a process and prints what comes back.
- **No credentials.** The environment check reports variable names and
  present/absent only; no value is ever read, printed or stored.
- **It does not drive Claude Code.** There is no supported interface for that,
  so it does not pretend to have one. Claude Code remains the coding agent in
  its own terminal; this panel tells you what the repository says about itself.

## Why the dashboard opens grey

Capability states render as "not checked" until the Capability Report has
actually run. A panel that opened showing nine green capabilities would look
exactly like a verified system while being a picture.

## Safety notes for anyone editing this

- Commands live in one fixed list (`src/commands.ts`). The webview can only
  send an **id**; an unknown id runs nothing, and there is no path by which
  webview content becomes a program name or an argument.
- `spawn` is called with an argv array, never an interpolated string.
- Command output reaches the panel through `textContent`, never `innerHTML` —
  output can contain markup from a test fixture.
- The webview CSP permits no remote origin at all.
