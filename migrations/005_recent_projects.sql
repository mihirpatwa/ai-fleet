-- ai-fleet :: migration 005_recent_projects
-- Phase 14: remembered project folders so the header picker can offer a
-- "Recent" section instead of re-picking every session. One row per absolute
-- path; submission_count + last_used_at bump on every task submission.
--
-- Numbered 005 (the phase spec wrote 004, but 004_file_edits.sql already
-- exists — the migration runner tracks applied versions by filename).

CREATE TABLE recent_projects(
  absolute_path     TEXT PRIMARY KEY,
  name              TEXT,
  first_used_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  submission_count  INT DEFAULT 0
);

CREATE INDEX idx_recent_projects_last ON recent_projects(last_used_at DESC);
