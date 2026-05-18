-- ai-fleet :: migration 001_initial
-- Raw DDL — no ORM. Applied exactly once; tracked in schema_migrations.

CREATE TABLE schema_migrations(
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMP
);

CREATE TABLE tasks(
  id TEXT PRIMARY KEY,                     -- ULID
  parent_id TEXT REFERENCES tasks(id),
  root_id TEXT NOT NULL,                   -- top of the tree
  project_root TEXT NOT NULL,
  title TEXT NOT NULL,
  assigned_agent TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN
    ('queued','running','done','failed','blocked','review','cancelled')),
  depends_on JSON DEFAULT '[]',            -- array of task ids
  input_json JSON,
  output_json JSON,
  progress INT DEFAULT 0,
  retry_count INT DEFAULT 0,
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP
);

CREATE TABLE events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks(id),
  agent TEXT,
  type TEXT CHECK(type IN
    ('started','tool_use_pre','tool_use_post','progress','log',
     'completed','failed','blocked')),
  payload_json JSON,
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks(id),
  from_agent TEXT,
  to_agent TEXT,
  kind TEXT CHECK(kind IN ('handoff','question','result')),
  payload_json JSON,
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP
);

CREATE TABLE agent_runs(
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INT, output_tokens INT, cache_read_tokens INT,
  cost_usd REAL,
  status TEXT,
  started_at TIMESTAMP, finished_at TIMESTAMP
);

CREATE INDEX idx_tasks_status          ON tasks(status);
CREATE INDEX idx_tasks_project_status  ON tasks(project_root, status);
CREATE INDEX idx_tasks_assigned_agent  ON tasks(assigned_agent);
CREATE INDEX idx_tasks_root_id         ON tasks(root_id);
CREATE INDEX idx_events_task_ts        ON events(task_id, ts DESC);
CREATE INDEX idx_agent_runs_started    ON agent_runs(started_at DESC);
