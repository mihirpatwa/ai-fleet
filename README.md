# ai-fleet

Portable multi-agent orchestrator that drives Claude Code subagents to autonomously work on any project you point it at. The fleet runs as a long-lived daemon with a web dashboard and CLI.

## Directory layout

```
ai-fleet/
├── package.json          # pnpm workspace root (private)
├── pnpm-workspace.yaml    # workspace package list
├── tsconfig.base.json     # shared strict TS config (ES2022 · NodeNext)
├── eslint.config.js       # flat ESLint config (typescript-eslint)
├── .prettierrc            # formatting rules
├── .editorconfig          # editor defaults
├── .gitignore
├── daemon/                # long-running orchestrator; hosts the Claude Agent SDK
├── dashboard/             # Next.js 15 + Antd web UI
├── cli/                   # user-facing commands to point & control the fleet
├── agents/                # global subagent markdown definitions
├── migrations/            # SQLite schema migrations (.sql)
├── scripts/               # smoke tests & install helpers
└── deploy/                # Docker + systemd packaging
```

## Workspace packages

| Package           | Path         | Role                                                  |
| ----------------- | ------------ | ----------------------------------------------------- |
| `@ai-fleet/daemon`    | `daemon/`    | Orchestrator process embedding the Claude Agent SDK   |
| `@ai-fleet/dashboard` | `dashboard/` | Next.js 15 observability & control UI                 |
| `@ai-fleet/cli`       | `cli/`       | Commands to target a project and drive runs           |

## Getting started

```bash
pnpm install      # install root tooling, link workspaces
pnpm -r build     # compile every package
pnpm -r test      # run package test suites
```

## Build phases

1. **Bootstrap** — pnpm monorepo, strict TypeScript, lint/format/test tooling, and a git baseline.
2. **Agents** — author the global subagent markdown definitions the fleet dispatches.
3. **State** — SQLite schema and migrations modelling fleets, tasks, and runs.
4. **Daemon + hooks** — long-running orchestrator embedding the Claude Agent SDK with lifecycle hooks.
5. **Dashboard** — Next.js 15 web UI to observe and steer the fleet in real time.
6. **CLI** — user-facing commands to point the fleet at a project and control runs.
7. **React profile** — first concrete stack profile teaching agents a React web app's conventions.
8. **Security** — sandboxing, secret redaction, and a permission policy for autonomous runs.
9. **Memory** — persistent cross-run knowledge so agents accumulate understanding of a codebase.
10. **24/7 + portability** — Docker/systemd deploy, crash resilience, and run-anywhere portability.
