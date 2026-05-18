# Project guide (generic profile)

This file is read by the ai-fleet subagents before they work on this
repository. It was created by `ai-fleet init` from the generic profile.

> Stub: phase 7 fills this profile in with real, stack-specific conventions.
> For now it carries only the universally safe rules below.

## Conventions

- Match the surrounding code's existing style, naming, and structure.
- Read at least three similar files before adding or changing code.
- Keep changes scoped to the task; do not refactor unrelated code.

## Commands

- Build, test, and lint commands are project-specific — discover them from
  `package.json`, `Makefile`, or the CI config rather than assuming.

## Boundaries

- Never commit secrets. Treat `.env*` and credential files as read-only.
- Leave the working tree lint- and format-clean.
