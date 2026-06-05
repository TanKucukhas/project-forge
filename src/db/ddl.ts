/**
 * Canonical schema DDL for ProjectForge's local SQLite index.
 *
 * This is the source of truth for table structure (drizzle-kit does not handle
 * FTS5 virtual tables or triggers, so we own the DDL directly). The Drizzle
 * schema in `schema.ts` mirrors these tables for type-safe queries.
 *
 * All statements are idempotent — running `initDb()` repeatedly is safe.
 */
export const DDL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notebooks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',   -- JSON array
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  notebook_id   TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,              -- youtube | article | website | markdown | pdf | note
  title         TEXT NOT NULL,
  url           TEXT,
  author        TEXT,
  raw_text_path TEXT,                       -- path to the saved snapshot in learning/
  summary       TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '[]', -- JSON array
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | processed | failed
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_notebook ON sources(notebook_id);

CREATE TABLE IF NOT EXISTS source_chunks (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content     TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON source_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_chunks_notebook ON source_chunks(notebook_id);

CREATE TABLE IF NOT EXISTS learning_docs (
  id            TEXT PRIMARY KEY,
  notebook_id   TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  markdown_path TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_notebook ON learning_docs(notebook_id);

CREATE TABLE IF NOT EXISTS outputs (
  id            TEXT PRIMARY KEY,
  notebook_id   TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,             -- game | startup | side-project | prd | tech-spec | claude-prompt | ...
  title         TEXT NOT NULL,
  markdown_path TEXT NOT NULL,
  model_id      TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outputs_notebook ON outputs(notebook_id);

CREATE TABLE IF NOT EXISTS output_sources (
  output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (output_id, source_id)
);

-- Full-text search over source chunks (FTS5). content is indexed; we keep
-- external-content style refs via stored columns for simple retrieval.
CREATE VIRTUAL TABLE IF NOT EXISTS source_chunks_fts USING fts5(
  content,
  chunk_id    UNINDEXED,
  source_id   UNINDEXED,
  notebook_id UNINDEXED,
  tokenize = 'porter unicode61'
);

-- Keep the FTS index in sync with source_chunks via triggers.
CREATE TRIGGER IF NOT EXISTS source_chunks_ai AFTER INSERT ON source_chunks BEGIN
  INSERT INTO source_chunks_fts(content, chunk_id, source_id, notebook_id)
  VALUES (new.content, new.id, new.source_id, new.notebook_id);
END;

CREATE TRIGGER IF NOT EXISTS source_chunks_ad AFTER DELETE ON source_chunks BEGIN
  DELETE FROM source_chunks_fts WHERE chunk_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS source_chunks_au AFTER UPDATE ON source_chunks BEGIN
  DELETE FROM source_chunks_fts WHERE chunk_id = old.id;
  INSERT INTO source_chunks_fts(content, chunk_id, source_id, notebook_id)
  VALUES (new.content, new.id, new.source_id, new.notebook_id);
END;
`;
