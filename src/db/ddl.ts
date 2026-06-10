/**
 * Canonical schema DDL for ProjectForge's local SQLite index (v1).
 *
 * Source of truth for table structure (drizzle-kit does not handle FTS5 virtual
 * tables or triggers, so we own the DDL directly). The Drizzle schema in
 * `schema.ts` mirrors these tables for type-safe queries.
 *
 * v1: top-level entity is `projects` (with a goal). Sources gain scoring,
 * category, distilled summary, and free YouTube metadata. Categories/tags are
 * first-class so Ask can be scoped. All statements are idempotent.
 */
export const DDL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  goal        TEXT NOT NULL DEFAULT '',   -- the steering context for distill/relevance/outputs
  settings    TEXT NOT NULL DEFAULT '{}', -- JSON: distill prompt overrides, scoring weights
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,              -- youtube | article | website | markdown | pdf | note
  title          TEXT NOT NULL,
  url            TEXT,
  author         TEXT,
  channel        TEXT,
  thumbnail      TEXT,                       -- preview image (YouTube thumb / article og:image)
  raw_text_path  TEXT,                       -- path to the saved raw snapshot in learning/
  summary        TEXT NOT NULL DEFAULT '',   -- short status/preview line
  category       TEXT,                       -- assigned at distill
  tags           TEXT NOT NULL DEFAULT '[]', -- JSON array (also normalized into source_tags)
  view_count     INTEGER,
  like_count     INTEGER,
  relevance      INTEGER,                    -- 0-100, model-judged vs goal (null until distilled)
  credibility    INTEGER,                    -- 0-100, views+like-ratio heuristic (null until scored)
  distilled_path TEXT,                       -- path to the compact distilled summary markdown
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | processed | distilled | failed
  utility        TEXT,                       -- low | medium | high (model-judged, at distill)
  instruction_hash TEXT,                     -- hash of the learn instructions used to distill
  goal_hash      TEXT,                       -- hash of the project goal used to distill
  taxonomy_hash  TEXT,                       -- hash of the taxonomy used to distill
  distilled_at   TEXT,                       -- ISO timestamp of the last distill run
  model          TEXT,                       -- model id used for the last distill
  metadata_json  TEXT,                       -- JSON: full structured distill metadata (Phase 2)
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_project ON sources(project_id);

CREATE TABLE IF NOT EXISTS source_chunks (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content     TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON source_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_chunks_project ON source_chunks(project_id);

CREATE TABLE IF NOT EXISTS learning_docs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id     TEXT REFERENCES sources(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL DEFAULT 'doc', -- doc | distilled
  title         TEXT NOT NULL,
  markdown_path TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  -- Phase 1/2: distill provenance + metadata mirrored from the doc's frontmatter,
  -- so the Learn list can show relevance/category/utility/stale without reading files.
  category           TEXT,
  relevance          INTEGER,
  utility            TEXT,
  instruction_hash   TEXT,
  goal_hash          TEXT,
  taxonomy_hash      TEXT,
  goal_version       INTEGER,
  learn_schema_version INTEGER,
  distilled_at       TEXT,
  model              TEXT,
  parse_status       TEXT,                   -- ok | fallback
  metadata_json      TEXT,                   -- JSON: full structured distill metadata
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_project ON learning_docs(project_id);

CREATE TABLE IF NOT EXISTS outputs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  markdown_path TEXT NOT NULL,
  model_id      TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outputs_project ON outputs(project_id);

CREATE TABLE IF NOT EXISTS output_sources (
  output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (output_id, source_id)
);

-- First-class taxonomy (assigned at distill, used to scope Ask).
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS tags (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS source_tags (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  tag_id    TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, tag_id)
);

-- Lightweight people/entity graph (Phase 4). Deliberately minimal — enough to
-- filter/boost retrieval by author/game/studio later, not a full graph DB.
CREATE TABLE IF NOT EXISTS authors (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  slug         TEXT NOT NULL,             -- @mention target, e.g. sid_meier
  aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (project_id, slug)
);

CREATE TABLE IF NOT EXISTS source_authors (
  source_id  TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  role       TEXT,
  confidence TEXT,
  PRIMARY KEY (source_id, author_id)
);

CREATE TABLE IF NOT EXISTS entities (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,             -- person | game | studio | book | concept | mechanic | other
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (project_id, type, slug)
);

CREATE TABLE IF NOT EXISTS source_entities (
  source_id  TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  entity_id  TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation   TEXT,                        -- primary | secondary | mentioned | subject | comparison
  confidence TEXT,
  PRIMARY KEY (source_id, entity_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project_id, type);

-- Retrieval logging (Phase 6): what context each Ask/Generate/ablation run used.
CREATE TABLE IF NOT EXISTS retrieval_runs (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mode               TEXT NOT NULL,        -- summaries | raw | hybrid | auto | ablation_*
  query              TEXT NOT NULL,
  filters_json       TEXT,
  context_char_count INTEGER,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retrieval_runs_project ON retrieval_runs(project_id);

CREATE TABLE IF NOT EXISTS retrieval_run_items (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES retrieval_runs(id) ON DELETE CASCADE,
  source_id       TEXT,
  chunk_id        TEXT,
  learning_doc_id TEXT,
  title           TEXT,
  rank            REAL,
  score           REAL,
  match_type      TEXT,                    -- fts | source_summary | meta_fts | filter | author_boost | tag_boost
  matched_terms_json TEXT,
  metadata_json   TEXT
);
CREATE INDEX IF NOT EXISTS idx_retrieval_items_run ON retrieval_run_items(run_id);

-- Source metadata FTS (Phase 5): tags + key terms + synonyms + entity names, so
-- queries phrased differently from the transcript can still find a source.
CREATE VIRTUAL TABLE IF NOT EXISTS source_meta_fts USING fts5(
  terms,
  source_id   UNINDEXED,
  project_id  UNINDEXED,
  tokenize = 'porter unicode61'
);

-- Full-text search over source chunks (FTS5).
CREATE VIRTUAL TABLE IF NOT EXISTS source_chunks_fts USING fts5(
  content,
  chunk_id    UNINDEXED,
  source_id   UNINDEXED,
  project_id  UNINDEXED,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS source_chunks_ai AFTER INSERT ON source_chunks BEGIN
  INSERT INTO source_chunks_fts(content, chunk_id, source_id, project_id)
  VALUES (new.content, new.id, new.source_id, new.project_id);
END;

CREATE TRIGGER IF NOT EXISTS source_chunks_ad AFTER DELETE ON source_chunks BEGIN
  DELETE FROM source_chunks_fts WHERE chunk_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS source_chunks_au AFTER UPDATE ON source_chunks BEGIN
  DELETE FROM source_chunks_fts WHERE chunk_id = old.id;
  INSERT INTO source_chunks_fts(content, chunk_id, source_id, project_id)
  VALUES (new.content, new.id, new.source_id, new.project_id);
END;
`;
