-- ai-fleet :: migration 002_memory
-- Adaptive memory: the cold tier. One row per learned lesson, full-text
-- searchable via an external-content FTS5 index kept in sync by triggers.

CREATE TABLE memories(
  id TEXT PRIMARY KEY,                      -- ULID
  project_root TEXT NOT NULL,
  agent TEXT,                               -- which agent it applies to
  tags JSON DEFAULT '[]',
  context TEXT,                             -- when this applies
  lesson_json JSON,                         -- {do, avoid, why}
  confidence REAL DEFAULT 0.5,
  used_count INT DEFAULT 0,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  pinned INT DEFAULT 0,
  embedding BLOB                            -- nullable, optional
);

CREATE INDEX idx_memories_lookup
  ON memories(project_root, agent, confidence DESC);

-- External-content FTS5 over the searchable text. `content_rowid='rowid'`
-- uses the table's implicit rowid (memories is not WITHOUT ROWID).
CREATE VIRTUAL TABLE memories_fts USING fts5(
  context, lesson_json,
  content='memories', content_rowid='rowid'
);

CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, context, lesson_json)
  VALUES (new.rowid, new.context, new.lesson_json);
END;

CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, context, lesson_json)
  VALUES ('delete', old.rowid, old.context, old.lesson_json);
END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, context, lesson_json)
  VALUES ('delete', old.rowid, old.context, old.lesson_json);
  INSERT INTO memories_fts(rowid, context, lesson_json)
  VALUES (new.rowid, new.context, new.lesson_json);
END;
