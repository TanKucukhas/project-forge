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
import { mkdir, writeFile, readFile } from "node:fs/promises";
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

export type DocFrontmatter = {
  title: string;
  projectId: string;
  sourceId: string;
  type: string;
  kind: "doc" | "distilled";
  url?: string;
  category?: string;
  relevance?: number | null;
  tags: string[];
  topics: string[];
  createdAt: string;
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

  const frontmatter = {
    title: required.title,
    projectId: required.projectId,
    sourceId: required.sourceId,
    type: required.type,
    kind: required.kind,
    ...(required.url ? { url: required.url } : {}),
    ...(required.category ? { category: required.category } : {}),
    ...(required.relevance != null ? { relevance: required.relevance } : {}),
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
