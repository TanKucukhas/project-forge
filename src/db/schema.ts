/**
 * Drizzle schema — type-safe mirror of the tables defined in `ddl.ts`.
 * DDL (including FTS5 + triggers) is owned by ddl.ts; this file exists for
 * type-safe reads/writes via drizzle-orm. Keep the two in sync.
 */
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const notebooks = sqliteTable("notebooks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  notebookId: text("notebook_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  author: text("author"),
  rawTextPath: text("raw_text_path"),
  summary: text("summary").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
});

export const sourceChunks = sqliteTable("source_chunks", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  notebookId: text("notebook_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
});

export const learningDocs = sqliteTable("learning_docs", {
  id: text("id").primaryKey(),
  notebookId: text("notebook_id").notNull(),
  title: text("title").notNull(),
  markdownPath: text("markdown_path").notNull(),
  summary: text("summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const outputs = sqliteTable("outputs", {
  id: text("id").primaryKey(),
  notebookId: text("notebook_id").notNull(),
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

export type Notebook = typeof notebooks.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type SourceChunk = typeof sourceChunks.$inferSelect;
export type LearningDoc = typeof learningDocs.$inferSelect;
export type Output = typeof outputs.$inferSelect;
