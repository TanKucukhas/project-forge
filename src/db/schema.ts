/**
 * Drizzle schema — type-safe mirror of the tables defined in `ddl.ts`.
 * DDL (including FTS5 + triggers) is owned by ddl.ts; this file exists for
 * type-safe reads/writes via drizzle-orm. Keep the two in sync.
 */
import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  goal: text("goal").notNull().default(""),
  settings: text("settings").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  author: text("author"),
  channel: text("channel"),
  thumbnail: text("thumbnail"),
  rawTextPath: text("raw_text_path"),
  summary: text("summary").notNull().default(""),
  category: text("category"),
  tags: text("tags").notNull().default("[]"),
  viewCount: integer("view_count"),
  likeCount: integer("like_count"),
  relevance: integer("relevance"),
  credibility: integer("credibility"),
  distilledPath: text("distilled_path"),
  status: text("status").notNull().default("pending"),
  utility: text("utility"),
  instructionHash: text("instruction_hash"),
  goalHash: text("goal_hash"),
  taxonomyHash: text("taxonomy_hash"),
  distilledAt: text("distilled_at"),
  model: text("model"),
  metadataJson: text("metadata_json"),
  createdAt: text("created_at").notNull(),
});

export const sourceChunks = sqliteTable("source_chunks", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  projectId: text("project_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
});

export const learningDocs = sqliteTable("learning_docs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  sourceId: text("source_id"),
  kind: text("kind").notNull().default("doc"),
  title: text("title").notNull(),
  markdownPath: text("markdown_path").notNull(),
  summary: text("summary").notNull().default(""),
  category: text("category"),
  relevance: integer("relevance"),
  utility: text("utility"),
  instructionHash: text("instruction_hash"),
  goalHash: text("goal_hash"),
  taxonomyHash: text("taxonomy_hash"),
  goalVersion: integer("goal_version"),
  learnSchemaVersion: integer("learn_schema_version"),
  distilledAt: text("distilled_at"),
  model: text("model"),
  parseStatus: text("parse_status"),
  metadataJson: text("metadata_json"),
  createdAt: text("created_at").notNull(),
});

export const outputs = sqliteTable("outputs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  markdownPath: text("markdown_path").notNull(),
  modelId: text("model_id"),
  createdAt: text("created_at").notNull(),
});

export const outputSources = sqliteTable(
  "output_sources",
  {
    outputId: text("output_id").notNull(),
    sourceId: text("source_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.outputId, t.sourceId] })],
);

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
});

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
});

export const sourceTags = sqliteTable(
  "source_tags",
  {
    sourceId: text("source_id").notNull(),
    tagId: text("tag_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.tagId] })],
);

export const authors = sqliteTable("authors", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  displayName: text("display_name").notNull(),
  slug: text("slug").notNull(),
  aliasesJson: text("aliases_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sourceAuthors = sqliteTable(
  "source_authors",
  {
    sourceId: text("source_id").notNull(),
    authorId: text("author_id").notNull(),
    role: text("role"),
    confidence: text("confidence"),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.authorId] })],
);

export const entities = sqliteTable("entities", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  aliasesJson: text("aliases_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sourceEntities = sqliteTable(
  "source_entities",
  {
    sourceId: text("source_id").notNull(),
    entityId: text("entity_id").notNull(),
    relation: text("relation"),
    confidence: text("confidence"),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.entityId, t.relation] })],
);

export const retrievalRuns = sqliteTable("retrieval_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  mode: text("mode").notNull(),
  query: text("query").notNull(),
  filtersJson: text("filters_json"),
  contextCharCount: integer("context_char_count"),
  createdAt: text("created_at").notNull(),
});

export const retrievalRunItems = sqliteTable("retrieval_run_items", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  sourceId: text("source_id"),
  chunkId: text("chunk_id"),
  learningDocId: text("learning_doc_id"),
  title: text("title"),
  rank: real("rank"),
  score: real("score"),
  matchType: text("match_type"),
  matchedTermsJson: text("matched_terms_json"),
  metadataJson: text("metadata_json"),
});

export type Project = typeof projects.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type SourceChunk = typeof sourceChunks.$inferSelect;
export type LearningDoc = typeof learningDocs.$inferSelect;
export type Output = typeof outputs.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Tag = typeof tags.$inferSelect;
