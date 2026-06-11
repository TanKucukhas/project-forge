/**
 * Markdown library — the durable, human-readable source of truth on disk.
 * SQLite is a rebuildable index over this.
 *
 * Layout (ARCHITECTURE.md §5, v1):
 *   learning/projects/<project-id>/
 *     project.json
 *     sources/  source-<id>.json   (raw snapshot: metadata + content)
 *               source-<id>.txt     (raw plain text on its own)
 *     notes/    <date>-<slug>-<id>.md   (distilled summaries / learning docs, frontmatter GUARANTEED)
 *     outputs/  ...
 *     index/    ...
 */
import "server-only";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { ResourceSnapshot } from "@/lib/capture/resource-fetch";

const LEARNING_ROOT = process.env.PROJECTFORGE_LEARNING
  ? path.resolve(process.env.PROJECTFORGE_LEARNING)
  : path.join(process.cwd(), "learning");

export function projectDir(projectId: string): string {
  return path.join(LEARNING_ROOT, "projects", projectId);
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "untitled"
  );
}

async function ensureProjectDirs(projectId: string): Promise<string> {
  const base = projectDir(projectId);
  await Promise.all(
    ["sources", "notes", "outputs", "index"].map((sub) =>
      mkdir(path.join(base, sub), { recursive: true }),
    ),
  );
  return base;
}

export async function ensureProject(
  projectId: string,
  meta: { title: string; goal: string; createdAt: string },
): Promise<void> {
  const base = await ensureProjectDirs(projectId);
  await writeFile(
    path.join(base, "project.json"),
    JSON.stringify({ id: projectId, ...meta }, null, 2),
    "utf8",
  );
}

/** Persist the raw snapshot BEFORE any model runs: a structured JSON + a plain .txt. */
export async function saveSourceSnapshot(
  projectId: string,
  sourceId: string,
  snapshot: ResourceSnapshot,
  createdAt: string,
): Promise<string> {
  const base = await ensureProjectDirs(projectId);
  const jsonPath = path.join(base, "sources", `source-${sourceId}.json`);
  const txtPath = path.join(base, "sources", `source-${sourceId}.txt`);
  await Promise.all([
    writeFile(
      jsonPath,
      JSON.stringify({ id: sourceId, projectId, createdAt, ...snapshot }, null, 2),
      "utf8",
    ),
    writeFile(txtPath, snapshot.content ?? "", "utf8"),
  ]);
  return path.relative(process.cwd(), jsonPath);
}

/**
 * Persist the raw uploaded PDF bytes alongside the text snapshot. The original
 * file is kept verbatim (durable source of truth); the extracted text lives in
 * the `.json`/`.txt` snapshot written by `saveSourceSnapshot`.
 */
export async function saveSourcePdf(
  projectId: string,
  sourceId: string,
  data: Uint8Array,
): Promise<string> {
  const base = await ensureProjectDirs(projectId);
  const pdfPath = path.join(base, "sources", `source-${sourceId}.pdf`);
  await writeFile(pdfPath, data);
  return path.relative(process.cwd(), pdfPath);
}

export type DistilledAuthor = { name: string; role?: string; confidence?: string };
export type ReferencedPerson = { name: string; relation?: string; confidence?: string };
export type SourceQuality = { authority?: string; confidence?: string; bias_or_limits?: string };

export type DocFrontmatter = {
  title: string;
  projectId: string;
  sourceId: string;
  type: string;
  kind: "doc" | "distilled";
  url?: string;
  category?: string;
  original_category?: string;
  relevance?: number | null;
  tags: string[];
  topics: string[];
  createdAt: string;
  // ── Phase 2: structured distill metadata (all optional / backward-compatible) ──
  utility?: string | null;
  use_for?: string[];
  authors?: DistilledAuthor[];
  referenced_people?: ReferencedPerson[];
  // ── Phase 3: importance-tiered entities (replaces flat referenced_games/studios) ──
  primary_games?: string[];
  secondary_games?: string[];
  mentioned_games?: string[];
  primary_studios?: string[];
  mentioned_studios?: string[];
  needs_entity_review?: boolean;
  entity_review_notes?: string[];
  key_terms?: string[];
  synonyms?: string[];
  source_quality?: SourceQuality;
  rationale?: string;
  why_keep?: string;
  why_not?: string;
  // ── Phase 1: distill versioning (enables stale detection) ──
  instruction_hash?: string;
  goal_hash?: string;
  taxonomy_hash?: string;
  goal_version?: number;
  learn_schema_version?: number;
  distilled_at?: string;
  model?: string;
  parse_status?: "ok" | "fallback";
};

/**
 * Save a learning/distilled doc with frontmatter ENFORCED in code. The model's
 * YAML is never trusted: we parse whatever it emitted only to harvest extra
 * tags/topics, then write the required keys with values we control.
 */
export async function saveDoc(
  projectId: string,
  modelMarkdown: string,
  required: DocFrontmatter,
  docId: string,
): Promise<{ markdownPath: string; filename: string }> {
  const base = await ensureProjectDirs(projectId);

  const cleaned = modelMarkdown
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const parsed = matter(cleaned);
  const modelTags = Array.isArray(parsed.data.tags) ? (parsed.data.tags as unknown[]) : [];
  const modelTopics = Array.isArray(parsed.data.topics) ? (parsed.data.topics as unknown[]) : [];
  const merge = (a: string[], b: unknown[]): string[] =>
    Array.from(new Set([...a, ...b.map(String).map((s) => s.trim()).filter(Boolean)]));

  // Include optional keys only when they carry a value, so frontmatter stays
  // tidy for sources where the model returned little structured metadata.
  const nonEmptyArr = (a?: unknown[]) => (Array.isArray(a) && a.length ? a : undefined);
  const cleanObj = <T extends Record<string, unknown>>(o: T): Partial<T> | undefined => {
    const entries = Object.entries(o).filter(([, v]) => v != null && v !== "");
    return entries.length ? (Object.fromEntries(entries) as Partial<T>) : undefined;
  };

  const optional = {
    url: required.url || undefined,
    category: required.category || undefined,
    original_category: required.original_category || undefined,
    relevance: required.relevance != null ? required.relevance : undefined,
    utility: required.utility || undefined,
    use_for: nonEmptyArr(required.use_for),
    authors: nonEmptyArr(required.authors),
    referenced_people: nonEmptyArr(required.referenced_people),
    primary_games: nonEmptyArr(required.primary_games),
    secondary_games: nonEmptyArr(required.secondary_games),
    mentioned_games: nonEmptyArr(required.mentioned_games),
    primary_studios: nonEmptyArr(required.primary_studios),
    mentioned_studios: nonEmptyArr(required.mentioned_studios),
    needs_entity_review: required.needs_entity_review ? true : undefined,
    entity_review_notes: nonEmptyArr(required.entity_review_notes),
    key_terms: nonEmptyArr(required.key_terms),
    synonyms: nonEmptyArr(required.synonyms),
    source_quality: required.source_quality ? cleanObj(required.source_quality) : undefined,
    rationale: required.rationale || undefined,
    why_keep: required.why_keep || undefined,
    why_not: required.why_not || undefined,
    instruction_hash: required.instruction_hash || undefined,
    goal_hash: required.goal_hash || undefined,
    taxonomy_hash: required.taxonomy_hash || undefined,
    goal_version: required.goal_version ?? undefined,
    learn_schema_version: required.learn_schema_version ?? undefined,
    distilled_at: required.distilled_at || undefined,
    model: required.model || undefined,
    parse_status: required.parse_status || undefined,
  };

  const frontmatter = {
    title: required.title,
    projectId: required.projectId,
    sourceId: required.sourceId,
    type: required.type,
    kind: required.kind,
    ...cleanObj(optional),
    tags: merge(required.tags, modelTags),
    topics: merge(required.topics, modelTopics),
    createdAt: required.createdAt,
  };

  const fileContent = matter.stringify(parsed.content.trim() + "\n", frontmatter);
  const filename = `${required.createdAt.slice(0, 10)}-${slugify(required.title)}-${docId}.md`;
  const filePath = path.join(base, "notes", filename);
  await writeFile(filePath, fileContent, "utf8");

  return { markdownPath: path.relative(process.cwd(), filePath), filename };
}

export async function readLibraryFile(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

/** Remove a source's markdown footprint: its raw snapshot (`.json`/`.txt`/`.pdf`)
 *  and every learned doc derived from it. Best-effort — missing files are fine
 *  (Markdown is truth, but a deleted source shouldn't leave orphan files). */
export async function deleteSourceFiles(
  projectId: string,
  sourceId: string,
  docRelativePaths: string[],
): Promise<void> {
  const base = projectDir(projectId);
  const targets = [
    path.join(base, "sources", `source-${sourceId}.json`),
    path.join(base, "sources", `source-${sourceId}.txt`),
    path.join(base, "sources", `source-${sourceId}.pdf`),
    ...docRelativePaths.map((p) => path.join(process.cwd(), p)),
  ];
  await Promise.all(targets.map((t) => rm(t, { force: true }).catch(() => {})));
}

/**
 * Reserved path for a future author "design lens" page (Phase 12) —
 * learning/projects/<id>/index/authors/<slug>.md. Not generated yet; the slug
 * comes from normalizeAuthorSlug so @sid_meier maps to .../authors/sid_meier.md.
 */
export function authorLensPath(projectId: string, slug: string): string {
  return path.relative(
    process.cwd(),
    path.join(projectDir(projectId), "index", "authors", `${slug}.md`),
  );
}

export type OutputFrontmatter = {
  projectId: string;
  outputType: string;
  request: string;
  model: string;
  retrievalRunId?: string;
  sourceIds: string[];
  createdAt: string;
  variant?: string; // ablation variant (distilled | raw | hybrid)
};

/**
 * Persist a generated output as Markdown with provenance frontmatter (which
 * request/model/retrieval-run/sources produced it), traceable back to context.
 * `subdir` lets the ablation runner write under outputs/evals/ without clobbering.
 */
export async function saveOutput(
  projectId: string,
  title: string,
  modelMarkdown: string,
  meta: OutputFrontmatter,
  docId: string,
  subdir = "",
): Promise<{ markdownPath: string; filename: string }> {
  const base = await ensureProjectDirs(projectId);
  const dir = path.join(base, "outputs", subdir);
  await mkdir(dir, { recursive: true });

  const body = modelMarkdown
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const frontmatter = {
    title,
    projectId: meta.projectId,
    outputType: meta.outputType,
    request: meta.request,
    model: meta.model,
    ...(meta.retrievalRunId ? { retrievalRunId: meta.retrievalRunId } : {}),
    ...(meta.variant ? { variant: meta.variant } : {}),
    sourceIds: meta.sourceIds,
    createdAt: meta.createdAt,
  };

  const fileContent = matter.stringify(body + "\n", frontmatter);
  const prefix = meta.variant ? `${meta.variant}-` : "";
  const filename = `${meta.createdAt.slice(0, 10)}-${prefix}${slugify(title)}-${docId}.md`;
  const filePath = path.join(dir, filename);
  await writeFile(filePath, fileContent, "utf8");
  return { markdownPath: path.relative(process.cwd(), filePath), filename };
}
