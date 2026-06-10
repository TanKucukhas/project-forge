/**
 * Typed DB operations for the project → capture → distill → ask pipeline.
 * The FTS5 mirror (`source_chunks_fts`) is maintained by triggers in ddl.ts, so
 * inserting into `source_chunks` is all that's needed to make a chunk searchable.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ensureProject } from "@/lib/library/store";
import { chunkText } from "@/lib/chunk";
import type { SourceType } from "@/lib/types";
import {
  DEFAULT_MODEL_USAGE_POLICY,
  parseSettings,
  type ProjectSettings,
} from "@/lib/settings";

export function newId(): string {
  return randomUUID().slice(0, 8);
}

// ── Projects ───────────────────────────────────────────────────────────────

export async function createProject(input: {
  title: string;
  goal: string;
  settings?: ProjectSettings;
}): Promise<{ id: string }> {
  const id = newId();
  const now = new Date().toISOString();
  const settings = JSON.stringify(input.settings ?? { modelUsagePolicy: DEFAULT_MODEL_USAGE_POLICY });
  db.insert(schema.projects)
    .values({ id, title: input.title, goal: input.goal, settings, createdAt: now, updatedAt: now })
    .run();
  await ensureProject(id, { title: input.title, goal: input.goal, createdAt: now });
  return { id };
}

export function listProjects() {
  return db.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt)).all();
}

export function getProject(id: string) {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
}

export function updateProjectGoal(id: string, patch: { title?: string; goal?: string }): void {
  db.update(schema.projects)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, id))
    .run();
}

/** Merge new settings over the project's existing settings JSON. */
export function updateProjectSettings(id: string, patch: Partial<ProjectSettings>): void {
  const current = getProject(id);
  if (!current) return;
  const merged: ProjectSettings = { ...parseSettings(current.settings), ...patch };
  db.update(schema.projects)
    .set({ settings: JSON.stringify(merged), updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, id))
    .run();
}

// ── Sources ────────────────────────────────────────────────────────────────

export function createSource(input: {
  projectId: string;
  type: SourceType;
  title: string;
  url: string | null;
  author: string | null;
  channel: string | null;
  thumbnail: string | null;
  viewCount: number | null;
  likeCount: number | null;
  credibility: number | null;
  tags?: string[];
}): { id: string; createdAt: string } {
  const id = newId();
  const createdAt = new Date().toISOString();
  db.insert(schema.sources)
    .values({
      id,
      projectId: input.projectId,
      type: input.type,
      title: input.title,
      url: input.url,
      author: input.author,
      channel: input.channel,
      thumbnail: input.thumbnail,
      rawTextPath: null,
      summary: "",
      category: null,
      tags: JSON.stringify(input.tags ?? []),
      viewCount: input.viewCount,
      likeCount: input.likeCount,
      relevance: null,
      credibility: input.credibility,
      distilledPath: null,
      status: "pending",
      createdAt,
    })
    .run();
  return { id, createdAt };
}

export function updateSource(
  id: string,
  patch: Partial<{
    status: string;
    rawTextPath: string;
    summary: string;
    title: string;
    category: string;
    relevance: number;
    distilledPath: string;
    tags: string;
  }>,
): void {
  db.update(schema.sources).set(patch).where(eq(schema.sources.id, id)).run();
}

export function getSource(id: string) {
  return db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
}

export function getSourceChunks(sourceId: string) {
  return db
    .select()
    .from(schema.sourceChunks)
    .where(eq(schema.sourceChunks.sourceId, sourceId))
    .all();
}

export function listSources(projectId: string) {
  return db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.projectId, projectId))
    .orderBy(desc(schema.sources.createdAt))
    .all();
}

/** All non-null source URLs in a project — used to dedupe re-imports. */
export function listSourceUrls(projectId: string): string[] {
  return db
    .select({ url: schema.sources.url })
    .from(schema.sources)
    .where(eq(schema.sources.projectId, projectId))
    .all()
    .map((r) => r.url)
    .filter((u): u is string => Boolean(u));
}

/** Chunk content and insert rows — triggers index each into FTS5 automatically. */
export function indexSourceChunks(sourceId: string, projectId: string, content: string): number {
  const chunks = chunkText(content);
  for (const chunk of chunks) {
    db.insert(schema.sourceChunks)
      .values({
        id: newId(),
        sourceId,
        projectId,
        chunkIndex: chunk.index,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
      })
      .run();
  }
  return chunks.length;
}

// ── Taxonomy (categories / tags) ─────────────────────────────────────────────

export function ensureCategory(projectId: string, name: string): void {
  const clean = name.trim();
  if (!clean) return;
  db.insert(schema.categories)
    .values({ id: newId(), projectId, name: clean })
    .onConflictDoNothing()
    .run();
}

function ensureTag(projectId: string, name: string): string | null {
  const clean = name.trim();
  if (!clean) return null;
  db.insert(schema.tags)
    .values({ id: newId(), projectId, name: clean })
    .onConflictDoNothing()
    .run();
  const row = db
    .select()
    .from(schema.tags)
    .where(and(eq(schema.tags.projectId, projectId), eq(schema.tags.name, clean)))
    .get();
  return row?.id ?? null;
}

export function linkSourceTags(projectId: string, sourceId: string, tagNames: string[]): void {
  for (const name of tagNames) {
    const tagId = ensureTag(projectId, name);
    if (tagId) {
      db.insert(schema.sourceTags).values({ sourceId, tagId }).onConflictDoNothing().run();
    }
  }
}

export function listCategories(projectId: string) {
  return db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.projectId, projectId))
    .orderBy(schema.categories.name)
    .all();
}

// ── Learning / distilled docs ────────────────────────────────────────────────

export function createDoc(input: {
  projectId: string;
  sourceId: string | null;
  kind: "doc" | "distilled";
  title: string;
  markdownPath: string;
  summary: string;
}): string {
  const id = newId();
  db.insert(schema.learningDocs)
    .values({
      id,
      projectId: input.projectId,
      sourceId: input.sourceId,
      kind: input.kind,
      title: input.title,
      markdownPath: input.markdownPath,
      summary: input.summary,
      createdAt: new Date().toISOString(),
    })
    .run();
  return id;
}

export function listDocs(projectId: string) {
  return db
    .select()
    .from(schema.learningDocs)
    .where(eq(schema.learningDocs.projectId, projectId))
    .orderBy(desc(schema.learningDocs.createdAt))
    .all();
}

// ── Scoped retrieval (Ask) ───────────────────────────────────────────────────

export type ChunkHit = {
  chunkId: string;
  sourceId: string;
  content: string;
  rank: number;
};

/**
 * FTS5 keyword search within a project, optionally restricted to a set of source
 * ids (single/multiple/category scope is resolved to ids by the caller).
 */
export function searchChunks(
  projectId: string,
  query: string,
  sourceIds: string[] | null,
  limit = 12,
): ChunkHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  // Quote each term so punctuation in the question can't break FTS5 syntax.
  const matchExpr = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, "")}"`)
    .join(" OR ");
  if (!matchExpr) return [];

  const scopeClause =
    sourceIds && sourceIds.length
      ? sql`AND source_id IN (${sql.join(
          sourceIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;

  const rows = db.all(sql`
    SELECT chunk_id, source_id, content, rank
    FROM source_chunks_fts
    WHERE source_chunks_fts MATCH ${matchExpr}
      AND project_id = ${projectId}
      ${scopeClause}
    ORDER BY rank
    LIMIT ${limit}
  `) as Array<{ chunk_id: string; source_id: string; content: string; rank: number }>;

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    sourceId: r.source_id,
    content: r.content,
    rank: r.rank,
  }));
}

export function sourceIdsForCategory(projectId: string, category: string): string[] {
  return db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(and(eq(schema.sources.projectId, projectId), eq(schema.sources.category, category)))
    .all()
    .map((r) => r.id);
}

export function getSourcesByIds(ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(schema.sources).where(inArray(schema.sources.id, ids)).all();
}
