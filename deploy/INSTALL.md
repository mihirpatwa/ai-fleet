# Deploying ai-fleet 24/7

Two supported ways to run the fleet continuously. Both keep state in
`~/.aifleet` so restarts/upgrades preserve tasks, events, memories and the
audit log.

## Option A — Docker (any OS with Docker)

```bash
cd ai-fleet
cp deploy/.env.example deploy/.env       # set ANTHROPIC_API_KEY (or rely on the mounted ~/.claude login)
docker compose -f deploy/docker-compose.yml up -d --build
# dashboard: http://localhost:3737   daemon: http://localhost:7878/healthz
```

- State volume: `${HOME}/.aifleet → /data`. A `docker compose restart` (or
  host reboot with `restart: unless-stopped`) preserves everything.
- Point it at a project: `PROJECT_PATH=/abs/path docker compose ... up -d`
  (mounted at `/workspace`).
- Logs: `docker compose -f deploy/docker-compose.yml logs -f`.
- Stop: `docker compose -f deploy/docker-compose.yml down` (state survives).

## Option B — systemd (native Linux, user service)

`deploy/aifleet@.service` is a templated unit (the `@` lets it run as the
invoking user via `%i`). Assuming the repo is at `~/ai-fleet` and built
(`pnpm -r build`):

```bash
mkdir -p ~/.config/systemd/user
cp deploy/aifleet@.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now aifleet@$(whoami).service
loginctl enable-linger "$(whoami)"      # keep it running after logout
systemctl --user status aifleet@$(whoami).service
journalctl --user -u aifleet@$(whoami).service -f
```

`ExecStart` runs `ai-fleet up --foreground`, which keeps the daemon and
dashboard in the foreground as child processes and propagates SIGTERM so
`Restart=always` can supervise them.

## Updating

```bash
git pull && corepack pnpm install --frozen-lockfile && corepack pnpm -r build
# Docker:  docker compose -f deploy/docker-compose.yml up -d --build
# systemd: systemctl --user restart aifleet@$(whoami).service
```

SQLite migrations are applied automatically by the daemon on startup.
