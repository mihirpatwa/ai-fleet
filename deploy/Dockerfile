# ai-fleet — 24/7 container. Build context is the repo root:
#   docker compose -f deploy/docker-compose.yml up -d --build
FROM node:22-slim

ENV NODE_ENV=production \
    AIFLEET_HOME=/data \
    AIFLEET_DB_PATH=/data/state.db \
    CLAUDE_CONFIG_DIR=/root/.claude \
    GITLEAKS_VERSION=8.21.2

# Toolchain the agents/scanners need. python3+make+g++ build better-sqlite3.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git bash curl jq ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && ARCH="$(dpkg --print-architecture)" \
 && case "$ARCH" in amd64) GL=x64 ;; arm64) GL=arm64 ;; *) GL=x64 ;; esac \
 && curl -sSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${GL}.tar.gz" \
      | tar -xz -C /usr/local/bin gitleaks \
 && gitleaks version \
 && npm install -g @anthropic-ai/claude-code pm2 \
 && corepack enable

WORKDIR /app
COPY . .
RUN corepack pnpm install --frozen-lockfile \
 && corepack pnpm -r build

EXPOSE 7878 3737

# pm2-runtime is PID 1 so SIGTERM/SIGINT propagate and the fleet drains cleanly.
ENTRYPOINT ["bash", "deploy/entrypoint.sh"]
