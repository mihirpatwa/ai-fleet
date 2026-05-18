# ai-fleet — Agent Verification

After running `scripts/link-agents.sh`, the 10 subagents are global. Open a **fresh Claude Code session in any directory** and paste one prompt per agent below.

A pass = the agent runs and its **final message is a single fenced ` ```json ` block** that conforms to that agent's Output schema (see `agents/<name>.md`).

> Primary acceptance test (Phase 2 Done-when):
> **`use the planner subagent to break down "add a login page"`**
> → returns a structured plan with `spec`, `requirements`, `acceptanceCriteria` (Given/When/Then), `tickets`, `risks`, `assumptions`, `openQuestions`, `memory.wouldSearchTags`.

## Per-agent test prompts

| # | Agent | Paste this into Claude Code | Expect |
|---|-------|------------------------------|--------|
| 1 | orchestrator | `use the orchestrator subagent to plan and dispatch the goal "add a /health endpoint" for repoRoot "/tmp/demo" with acceptance criteria ["GET /health returns 200 {status:ok}"]` | JSON with `dag`, `dispatched`, `status` ∈ done/looping/blocked |
| 2 | planner | `use the planner subagent to break down "add a login page"` | JSON `spec/requirements/acceptanceCriteria/tickets` |
| 3 | researcher | `use the researcher subagent to investigate "zod vs valibot for runtime schema validation in a strict TypeScript Node service"` | JSON `findings[]` with cited `evidence`, `options`, `recommendation` |
| 4 | coder | `use the coder subagent on ticket {ticketId:"T1", title:"Add GET /health route", goal:"health check", repoRoot:"<this repo>", acceptanceCriteria:["GET /health returns 200 {status:ok}"]}` | JSON with `readForPatterns` (≥3), `filesChanged`, `lint`, `format` |
| 5 | reviewer | `use the reviewer subagent to review the changes on the current git branch (diffRef "origin/main...HEAD")` | JSON `findings[]` with severity/category/path; `approved` boolean. No files modified |
| 6 | tester | `use the tester subagent to run this project's test suite and report results` | JSON `status` ∈ pass/fail/error, `totals`, `failures[]`. Edits (if any) only in test paths |
| 7 | debugger | `use the debugger subagent to investigate the symptom "npm test fails: Cannot find module './config'"` | JSON `rootCause`, `evidence[]`, `suggestedFix`, `confidence`. No source edited |
| 8 | devops | `use the devops subagent to add CI that runs lint and tests on push (action "ci")` | JSON `filesChanged` only under `.github/`; `commands[]` with exit codes |
| 9 | doc-writer | `use the doc-writer subagent to add a "Subagents" section to README.md` | JSON `filesChanged` only `*.md`/`*.mdx`; `outline[]` |
| 10 | scribe | `use the scribe subagent to record events [{ts:"09:14",agent:"coder",type:"ticket-done",detail:"T1 done"}] for date "2026-05-18"` | JSON `logFile` = `logs/2026-05-18.md`, append-only, `dailySummary` |

## What to check on each pass

1. **Loaded**: Claude Code routes to the named subagent (not the main agent).
2. **Schema**: final message is exactly one ` ```json ` block matching the Output schema.
3. **Boundaries**: tool/path scope respected — reviewer & debugger change nothing; tester edits only test files; devops only infra paths; doc-writer only `.md`/`.mdx`; scribe only `logs/`; only the orchestrator uses the Task tool.
4. **Memory**: every output includes `memory.wouldSearchTags` (Phase 9 forward-wiring).

## Quick relink / sanity

```bash
# from anywhere:
bash "<fleet>/scripts/link-agents.sh"          # idempotent re-link
ls -l ~/.claude/agents/                          # 10 symlinks -> <fleet>/agents/*.md
```

If an agent doesn't load: confirm `~/.claude/agents/<name>.md` resolves (`readlink`), the target has valid frontmatter (`name`, `description`, `tools`, `model`), and no project-level `.claude/agents/<name>.md` is overriding it.
