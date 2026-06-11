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
import { normalizeAuthorSlug, normalizeEntitySlug } from "@/lib/taxonomy";
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
  settings?: Partial<ProjectSettings>;
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
    utility: string;
    instructionHash: string;
    goalHash: string;
    taxonomyHash: string;
    distilledAt: string;
    model: string;
    metadataJson: string;
  }>,
): void {
  db.update(schema.sources).set(patch).where(eq(schema.sources.id, id)).run();
}

export function getSource(id: string) {
  return db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
}

/** Learned docs derived from one source (newest first) — for cleanup on delete. */
export function listDocsForSource(sourceId: string) {
  return db
    .select()
    .from(schema.learningDocs)
    .where(eq(schema.learningDocs.sourceId, sourceId))
    .orderBy(desc(schema.learningDocs.createdAt))
    .all();
}

/** Delete a source and everything that hangs off it. FK ON DELETE CASCADE drops
 *  chunks (→ FTS via triggers), tags/author/entity links, and output_sources;
 *  learning_docs is SET NULL on source delete, so we remove those rows first. */
export function deleteSource(id: string): void {
  db.delete(schema.learningDocs).where(eq(schema.learningDocs.sourceId, id)).run();
  db.delete(schema.sources).where(eq(schema.sources.id, id)).run();
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

/** Total transcript tokens per source (sum over its chunks). Falls back to
 *  chars/4 for legacy rows whose token_count was never set. Drives the Smart
 *  Context "what would using everything cost" estimate. */
export function sourceTokenTotals(projectId: string): Map<string, number> {
  const rows = db
    .select({
      sourceId: schema.sourceChunks.sourceId,
      tokens: sql<number>`cast(sum(case when ${schema.sourceChunks.tokenCount} > 0 then ${schema.sourceChunks.tokenCount} else length(${schema.sourceChunks.content}) / 4 end) as integer)`,
    })
    .from(schema.sourceChunks)
    .where(eq(schema.sourceChunks.projectId, projectId))
    .groupBy(schema.sourceChunks.sourceId)
    .all();
  return new Map(rows.map((r) => [r.sourceId, r.tokens ?? 0]));
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

export function listTags(projectId: string) {
  return db
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.projectId, projectId))
    .orderBy(schema.tags.name)
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
  // Phase 1/2 provenance + metadata (mirrored from the doc frontmatter).
  category?: string | null;
  relevance?: number | null;
  utility?: string | null;
  instructionHash?: string | null;
  goalHash?: string | null;
  taxonomyHash?: string | null;
  goalVersion?: number | null;
  learnSchemaVersion?: number | null;
  distilledAt?: string | null;
  model?: string | null;
  parseStatus?: string | null;
  metadataJson?: string | null;
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
      category: input.category ?? null,
      relevance: input.relevance ?? null,
      utility: input.utility ?? null,
      instructionHash: input.instructionHash ?? null,
      goalHash: input.goalHash ?? null,
      taxonomyHash: input.taxonomyHash ?? null,
      goalVersion: input.goalVersion ?? null,
      learnSchemaVersion: input.learnSchemaVersion ?? null,
      distilledAt: input.distilledAt ?? null,
      model: input.model ?? null,
      parseStatus: input.parseStatus ?? null,
      metadataJson: input.metadataJson ?? null,
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

// ── Authors / entities (Phase 4) ─────────────────────────────────────────────

export type EntityType = "person" | "game" | "studio" | "book" | "concept" | "mechanic" | "other";

/** Find-or-create an author by slug within a project; returns its id. */
export function ensureAuthor(projectId: string, name: string): string | null {
  const display = name.trim();
  const slug = normalizeAuthorSlug(display);
  if (!slug) return null;
  const now = new Date().toISOString();
  db.insert(schema.authors)
    .values({ id: newId(), projectId, displayName: display, slug, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .run();
  return (
    db
      .select({ id: schema.authors.id })
      .from(schema.authors)
      .where(and(eq(schema.authors.projectId, projectId), eq(schema.authors.slug, slug)))
      .get()?.id ?? null
  );
}

export function linkSourceAuthor(
  sourceId: string,
  authorId: string,
  role?: string,
  confidence?: string,
): void {
  db.insert(schema.sourceAuthors)
    .values({ sourceId, authorId, role: role ?? null, confidence: confidence ?? null })
    .onConflictDoNothing()
    .run();
}

/** Find-or-create an entity by (type, slug) within a project; returns its id. */
export function ensureEntity(projectId: string, type: EntityType, name: string): string | null {
  const display = name.trim();
  const slug = normalizeEntitySlug(display);
  if (!slug) return null;
  const now = new Date().toISOString();
  db.insert(schema.entities)
    .values({ id: newId(), projectId, type, name: display, slug, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .run();
  return (
    db
      .select({ id: schema.entities.id })
      .from(schema.entities)
      .where(
        and(
          eq(schema.entities.projectId, projectId),
          eq(schema.entities.type, type),
          eq(schema.entities.slug, slug),
        ),
      )
      .get()?.id ?? null
  );
}

export function linkSourceEntity(
  sourceId: string,
  entityId: string,
  relation: string,
  confidence?: string,
): void {
  db.insert(schema.sourceEntities)
    .values({ sourceId, entityId, relation, confidence: confidence ?? null })
    .onConflictDoNothing()
    .run();
}

/** Remove all author/entity links for a source — called before re-populating on
 *  re-distill so importance tiers can't accumulate stale rows. */
export function clearSourceGraph(sourceId: string): void {
  db.delete(schema.sourceAuthors).where(eq(schema.sourceAuthors.sourceId, sourceId)).run();
  db.delete(schema.sourceEntities).where(eq(schema.sourceEntities.sourceId, sourceId)).run();
}

export function listAuthors(projectId: string) {
  return db
    .select()
    .from(schema.authors)
    .where(eq(schema.authors.projectId, projectId))
    .orderBy(schema.authors.displayName)
    .all();
}

export function listEntities(projectId: string, type?: EntityType) {
  const where = type
    ? and(eq(schema.entities.projectId, projectId), eq(schema.entities.type, type))
    : eq(schema.entities.projectId, projectId);
  return db.select().from(schema.entities).where(where).orderBy(schema.entities.name).all();
}

/** Source ids tied to an author slug (any role). */
export function sourceIdsForAuthorSlug(projectId: string, slug: string): string[] {
  const author = db
    .select({ id: schema.authors.id })
    .from(schema.authors)
    .where(and(eq(schema.authors.projectId, projectId), eq(schema.authors.slug, slug)))
    .get();
  if (!author) return [];
  return db
    .select({ id: schema.sourceAuthors.sourceId })
    .from(schema.sourceAuthors)
    .where(eq(schema.sourceAuthors.authorId, author.id))
    .all()
    .map((r) => r.id);
}

/** Source ids tied to an entity slug (optionally constrained to a type). */
export function sourceIdsForEntitySlug(
  projectId: string,
  slug: string,
  type?: EntityType,
): string[] {
  const where = type
    ? and(
        eq(schema.entities.projectId, projectId),
        eq(schema.entities.type, type),
        eq(schema.entities.slug, slug),
      )
    : and(eq(schema.entities.projectId, projectId), eq(schema.entities.slug, slug));
  const ent = db.select({ id: schema.entities.id }).from(schema.entities).where(where).get();
  if (!ent) return [];
  return db
    .select({ id: schema.sourceEntities.sourceId })
    .from(schema.sourceEntities)
    .where(eq(schema.sourceEntities.entityId, ent.id))
    .all()
    .map((r) => r.id);
}

/** Source ids carrying a given tag name (kebab slug stored in tags table). */
export function sourceIdsForTag(projectId: string, tagName: string): string[] {
  const tag = db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(and(eq(schema.tags.projectId, projectId), eq(schema.tags.name, tagName)))
    .get();
  if (!tag) return [];
  return db
    .select({ id: schema.sourceTags.sourceId })
    .from(schema.sourceTags)
    .where(eq(schema.sourceTags.tagId, tag.id))
    .all()
    .map((r) => r.id);
}

// ── Source metadata FTS (Phase 5) ────────────────────────────────────────────

/** Replace the meta-FTS row(s) for a source with the given searchable terms
 *  (tags + key_terms + synonyms + entity names). No triggers on this FTS table,
 *  so we manage rows directly. */
export function upsertSourceMeta(sourceId: string, projectId: string, terms: string): void {
  db.run(sql`DELETE FROM source_meta_fts WHERE source_id = ${sourceId}`);
  const clean = terms.trim();
  if (!clean) return;
  db.run(sql`
    INSERT INTO source_meta_fts (terms, source_id, project_id)
    VALUES (${clean}, ${sourceId}, ${projectId})
  `);
}

/** Find sources whose metadata (tags/terms/synonyms/entities) match the query —
 *  catches conceptually-relevant sources the transcript text alone would miss. */
export function searchMetaSources(
  projectId: string,
  query: string,
  sourceIds: string[] | null,
  limit = 8,
): { sourceId: string; rank: number }[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
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
    SELECT source_id, rank FROM source_meta_fts
    WHERE source_meta_fts MATCH ${matchExpr}
      AND project_id = ${projectId}
      ${scopeClause}
    ORDER BY rank
    LIMIT ${limit}
  `) as Array<{ source_id: string; rank: number }>;
  return rows.map((r) => ({ sourceId: r.source_id, rank: r.rank }));
}

// ── Retrieval logging (Phase 6) ──────────────────────────────────────────────

export type RetrievalItem = {
  sourceId?: string | null;
  chunkId?: string | null;
  learningDocId?: string | null;
  title?: string | null;
  rank?: number | null;
  score?: number | null;
  matchType?: string | null;
  matchedTerms?: string[];
  metadata?: Record<string, unknown>;
};

/** Persist a retrieval run + its items; returns the run id. Best-effort logging
 *  — callers should not let a logging failure break Ask/Generate. */
export function logRetrieval(input: {
  projectId: string;
  mode: string;
  query: string;
  filters?: Record<string, unknown>;
  contextCharCount: number;
  items: RetrievalItem[];
}): string {
  const runId = newId();
  db.insert(schema.retrievalRuns)
    .values({
      id: runId,
      projectId: input.projectId,
      mode: input.mode,
      query: input.query,
      filtersJson: input.filters ? JSON.stringify(input.filters) : null,
      contextCharCount: input.contextCharCount,
      createdAt: new Date().toISOString(),
    })
    .run();
  for (const it of input.items) {
    db.insert(schema.retrievalRunItems)
      .values({
        id: newId(),
        runId,
        sourceId: it.sourceId ?? null,
        chunkId: it.chunkId ?? null,
        learningDocId: it.learningDocId ?? null,
        title: it.title ?? null,
        rank: it.rank ?? null,
        score: it.score ?? null,
        matchType: it.matchType ?? null,
        matchedTermsJson: it.matchedTerms?.length ? JSON.stringify(it.matchedTerms) : null,
        metadataJson: it.metadata ? JSON.stringify(it.metadata) : null,
      })
      .run();
  }
  return runId;
}

// ── Generated outputs (Phase 8) ──────────────────────────────────────────────

export function createOutput(input: {
  projectId: string;
  type: string;
  title: string;
  markdownPath: string;
  modelId: string;
}): string {
  const id = newId();
  db.insert(schema.outputs)
    .values({
      id,
      projectId: input.projectId,
      type: input.type,
      title: input.title,
      markdownPath: input.markdownPath,
      modelId: input.modelId,
      createdAt: new Date().toISOString(),
    })
    .run();
  return id;
}

export function linkOutputSources(outputId: string, sourceIds: string[]): void {
  for (const sourceId of new Set(sourceIds)) {
    db.insert(schema.outputSources).values({ outputId, sourceId }).onConflictDoNothing().run();
  }
}

export function listOutputs(projectId: string) {
  return db
    .select()
    .from(schema.outputs)
    .where(eq(schema.outputs.projectId, projectId))
    .orderBy(desc(schema.outputs.createdAt))
    .all();
}

export function getRetrievalRun(runId: string) {
  const run = db
    .select()
    .from(schema.retrievalRuns)
    .where(eq(schema.retrievalRuns.id, runId))
    .get();
  if (!run) return null;
  const items = db
    .select()
    .from(schema.retrievalRunItems)
    .where(eq(schema.retrievalRunItems.runId, runId))
    .all();
  return { run, items };
}
