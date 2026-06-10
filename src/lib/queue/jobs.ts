/**
 * Job runners for the capture and distill pipelines. These own the side effects
 * (fetch, snapshot, index, score, model run, save) and return a small result
 * payload for the UI to poll.
 */
import "server-only";
import { fetchResourceSnapshot, snapshotFromNotes } from "@/lib/capture/resource-fetch";
import { snapshotFromPdf } from "@/lib/capture/pdf";
import { extractVideoId, isYoutubeUrl } from "@/lib/capture/youtube";
import { saveSourceSnapshot, saveSourcePdf, saveDoc, readLibraryFile } from "@/lib/library/store";
import { credibilityScore } from "@/lib/scoring";
import {
  createSource,
  updateSource,
  indexSourceChunks,
  getSource,
  getSourceChunks,
  getProject,
  createDoc,
  ensureCategory,
  linkSourceTags,
  listSourceUrls,
  newId,
} from "@/lib/db/queries";
import { runModel } from "@/lib/ai";
import { parseSettings, buildLearnInstructions } from "@/lib/settings";

export type CaptureInput = {
  projectId: string;
  url?: string;
  notes?: string;
  title?: string;
};

/**
 * Capture: fetch → score credibility → persist raw snapshot → create source row
 * → chunk + FTS index. The snapshot is saved BEFORE indexing so a crash never
 * loses the raw text. Distillation is a separate, manual step.
 */
export async function runCapture(
  input: CaptureInput,
): Promise<{ sourceId: string; skipped?: boolean }> {
  const url = input.url?.trim() ?? "";
  const notes = input.notes?.trim() ?? "";

  // Dedupe: never import the same video/URL twice into a project.
  if (url) {
    const vid = isYoutubeUrl(url) ? extractVideoId(url) : null;
    for (const existing of listSourceUrls(input.projectId)) {
      const sameVideo = vid && isYoutubeUrl(existing) && extractVideoId(existing) === vid;
      if (sameVideo || existing === url) {
        return { sourceId: "", skipped: true };
      }
    }
  }

  const { transcriptLanguage } = parseSettings(getProject(input.projectId)?.settings);

  const snapshot = url
    ? await fetchResourceSnapshot(url, { transcriptLanguage })
    : snapshotFromNotes(notes, input.title);

  const title = input.title?.trim() || snapshot.title || (url ? url : "Pasted note");
  const credibility = credibilityScore(snapshot.viewCount, snapshot.likeCount);

  const { id: sourceId, createdAt } = createSource({
    projectId: input.projectId,
    type: snapshot.type,
    title,
    url: url || null,
    author: snapshot.author,
    channel: snapshot.channel,
    thumbnail: snapshot.thumbnail,
    viewCount: snapshot.viewCount,
    likeCount: snapshot.likeCount,
    credibility,
    tags: snapshot.keywords,
  });

  try {
    const rawTextPath = await saveSourceSnapshot(input.projectId, sourceId, snapshot, createdAt);
    const chunkCount = indexSourceChunks(sourceId, input.projectId, snapshot.content);
    const summary =
      snapshot.type === "youtube" && !snapshot.transcriptFetched
        ? "Captured (no transcript available — title/description only)."
        : `Indexed ${chunkCount} chunk${chunkCount === 1 ? "" : "s"}. Ready to distill.`;
    updateSource(sourceId, { status: "processed", rawTextPath, summary });
  } catch (error) {
    updateSource(sourceId, {
      status: "failed",
      summary: error instanceof Error ? error.message : "Capture failed.",
    });
    throw error;
  }

  return { sourceId };
}

export type CapturePdfInput = {
  projectId: string;
  filename: string;
  title?: string;
  /** Raw PDF bytes from the upload. */
  data: Uint8Array;
};

/**
 * Capture an uploaded PDF: extract text → persist the RAW PDF + the text
 * snapshot → create the source row → chunk + FTS index. Both the original PDF
 * and the extracted text are saved before indexing, so the raw file is never
 * lost and the text is what the model later distills.
 */
export async function runCapturePdf(input: CapturePdfInput): Promise<{ sourceId: string }> {
  const snapshot = await snapshotFromPdf(input.data, input.filename, input.title);
  const title = input.title?.trim() || snapshot.title || input.filename || "PDF document";

  const { id: sourceId, createdAt } = createSource({
    projectId: input.projectId,
    type: "pdf",
    title,
    url: null,
    author: snapshot.author,
    channel: null,
    thumbnail: null,
    viewCount: null,
    likeCount: null,
    credibility: null,
    tags: snapshot.keywords,
  });

  try {
    // Save the raw PDF first, then the extracted-text snapshot, then index.
    const rawPdfPath = await saveSourcePdf(input.projectId, sourceId, input.data);
    snapshot.rawFilePath = rawPdfPath;
    const rawTextPath = await saveSourceSnapshot(input.projectId, sourceId, snapshot, createdAt);
    const chunkCount = indexSourceChunks(sourceId, input.projectId, snapshot.content);
    const summary = snapshot.content.trim()
      ? `Indexed ${chunkCount} chunk${chunkCount === 1 ? "" : "s"} from PDF. Ready to distill.`
      : "Captured the PDF, but no text could be extracted (it may be scanned images).";
    updateSource(sourceId, { status: "processed", rawTextPath, summary });
  } catch (error) {
    updateSource(sourceId, {
      status: "failed",
      summary: error instanceof Error ? error.message : "PDF capture failed.",
    });
    throw error;
  }

  return { sourceId };
}

/** Pull the first balanced JSON object out of a model's text response. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Distill: goal-aware compression of a captured source. Produces a compact
 * summary + category + tags + relevance, saved as a distilled doc with
 * frontmatter enforced in code. Re-runnable; each run saves its own doc.
 */
export async function runDistill(input: {
  sourceId: string;
  modelId: string;
  instructions?: string;
}): Promise<{ docId: string; markdownPath: string; relevance: number | null; category: string | null }> {
  const source = getSource(input.sourceId);
  if (!source) throw new Error("Source not found.");
  const project = getProject(source.projectId);

  const chunks = getSourceChunks(input.sourceId);
  let content = chunks
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((c) => c.content)
    .join(" ");
  let description: string | null = null;
  if (source.rawTextPath) {
    const snap = JSON.parse(await readLibraryFile(source.rawTextPath)) as {
      content?: string;
      description?: string | null;
    };
    description = snap.description ?? null;
    if (!content) content = snap.content ?? "";
  }
  if (!content.trim()) throw new Error("This source has no captured text to distill.");

  // Prose precedence: an explicit per-call override, else the project's saved
  // Learn instructions, else the built-in default (handled by the builder).
  const prose = input.instructions?.trim() || parseSettings(project?.settings).learnInstructions;
  const prompt = `${buildLearnInstructions(project?.goal ?? "", prose)}

SOURCE
Title: ${source.title}
Type: ${source.type}${source.url ? `\nURL: ${source.url}` : ""}${
    description ? `\nDescription: ${description}` : ""
  }

Content:
${content}`;

  const { output } = await runModel(input.modelId, prompt);
  const parsed = extractJsonObject(output);

  // Graceful fallback: if the model didn't return clean JSON, treat the whole
  // output as the summary and leave scoring/category empty.
  const summaryMarkdown =
    (parsed?.summary_markdown as string | undefined)?.trim() || output.trim();
  const category =
    typeof parsed?.category === "string" && parsed.category.trim() ? parsed.category.trim() : null;
  const tags = Array.isArray(parsed?.tags)
    ? (parsed!.tags as unknown[]).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8)
    : [];
  const relevanceRaw = Number(parsed?.relevance);
  const relevance =
    Number.isFinite(relevanceRaw) ? Math.max(0, Math.min(100, Math.round(relevanceRaw))) : null;
  const rationale = typeof parsed?.rationale === "string" ? parsed.rationale.trim() : "";

  const createdAt = new Date().toISOString();
  const docId = newId();
  const { markdownPath } = await saveDoc(
    source.projectId,
    summaryMarkdown,
    {
      title: source.title,
      projectId: source.projectId,
      sourceId: source.id,
      type: source.type,
      kind: "distilled",
      url: source.url ?? undefined,
      category: category ?? undefined,
      relevance,
      tags,
      topics: [],
      createdAt,
    },
    docId,
  );

  // Update the source row + taxonomy.
  const patch: Parameters<typeof updateSource>[1] = {
    status: "distilled",
    distilledPath: markdownPath,
    summary: rationale || `Distilled (relevance ${relevance ?? "?"}/100).`,
  };
  if (category) patch.category = category;
  if (relevance != null) patch.relevance = relevance;
  if (tags.length) patch.tags = JSON.stringify(tags);
  updateSource(source.id, patch);

  if (category) ensureCategory(source.projectId, category);
  if (tags.length) linkSourceTags(source.projectId, source.id, tags);

  const learningDocId = createDoc({
    projectId: source.projectId,
    sourceId: source.id,
    kind: "distilled",
    title: source.title,
    markdownPath,
    summary: rationale || summaryMarkdown.replace(/\s+/g, " ").slice(0, 200),
  });

  return { docId: learningDocId, markdownPath, relevance, category };
}
