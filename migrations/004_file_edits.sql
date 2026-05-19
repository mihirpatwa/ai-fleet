-- ai-fleet :: migration 004_file_edits
-- Phase 12: capture every coder file edit so the dashboard can render a live
-- Monaco before/after diff. file_snapshots holds the pre-edit content captured
-- on PreToolUse; file_edits holds the committed before/after + unified diff
-- captured on PostToolUse.
--
-- Numbered 004 (not 003 as the phase spec wrote) because 003_scheduled.sql
-- already exists — the migration runner tracks applied versions by filename,
-- so a duplicate 003_* is ambiguous. Tables/indexes are exactly as specified.

CREATE TABLE file_snapshots(
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         TEXT,
  agent           TEXT,
  file_path       TEXT NOT NULL,
  before_content  TEXT,
  intended_change TEXT,
  ts              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_file_snapshots_task ON file_snapshots(task_id, ts);
-- Post-edit lookup of the matching pre-edit snapshot.
CREATE INDEX idx_file_snapshots_lookup ON file_snapshots(task_id, file_path, id);

CREATE TABLE file_edits(
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         TEXT,
  agent           TEXT,
  file_path       TEXT NOT NULL,
  before_content  TEXT,
  after_content   TEXT,
  diff_unified    TEXT,
  lines_added     INT DEFAULT 0,
  lines_removed   INT DEFAULT 0,
  ts              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_file_edits_task ON file_edits(task_id, ts);
