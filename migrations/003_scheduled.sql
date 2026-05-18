-- ai-fleet :: migration 003_scheduled
-- Cron-scheduled background tasks. The daemon evaluates due rows every
-- minute and materializes a normal task from each.

CREATE TABLE scheduled_tasks(
  id TEXT PRIMARY KEY,                     -- ULID
  name TEXT NOT NULL UNIQUE,               -- stable key (defaults seeded once)
  cron TEXT NOT NULL,                      -- 5-field: min hour dom mon dow (UTC)
  agent TEXT NOT NULL,
  input_json JSON,
  project_root TEXT,                       -- nullable; daemon falls back to ~/.aifleet
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  enabled INT DEFAULT 1
);

CREATE INDEX idx_scheduled_due ON scheduled_tasks(enabled, next_run_at);
