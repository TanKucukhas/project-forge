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
  ensureAuthor,
  linkSourceAuthor,
  ensureEntity,
  linkSourceEntity,
  clearSourceGraph,
  upsertSourceMeta,
  newId,
} from "@/lib/db/queries";
import { runModel } from "@/lib/ai";
import { parseSettings, buildLearnInstructions } from "@/lib/settings";
import { computeDistillHashes, computeTaxonomyHash, LEARN_SCHEMA_VERSION } from "@/lib/distill/versioning";
import type { DistilledAuthor, ReferencedPerson, SourceQuality } from "@/lib/library/store";
import { normalizeCategory, normalizeTags, normalizeAuthorSlug } from "@/lib/taxonomy";
import { reviewPeopleNames } from "@/lib/entity-review";

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

// ── Defensive parsers for the v2 distill JSON ────────────────────────────────
// Every field is optional and tolerant: a missing/malformed field yields a sane
// empty value rather than throwing, so older/odd model outputs never break Learn.

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStrArray(v: unknown, max = 24): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(
    new Set(v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)),
  ).slice(0, max);
}

function asAuthors(v: unknown): DistilledAuthor[] {
  if (!Array.isArray(v)) return [];
  const out: DistilledAuthor[] = [];
  for (const a of v) {
    if (typeof a === "string" && a.trim()) {
      out.push({ name: a.trim() });
    } else if (a && typeof a === "object") {
      const name = asStr((a as Record<string, unknown>).name);
      if (!name) continue;
      const role = asStr((a as Record<string, unknown>).role) || undefined;
      const confidence = asStr((a as Record<string, unknown>).confidence) || undefined;
      out.push({ name, ...(role ? { role } : {}), ...(confidence ? { confidence } : {}) });
    }
  }
  return out.slice(0, 24);
}

/** People discussed but NOT authors (objects with relation/confidence, or bare
 *  strings). De-duplicated against the author list by slug so the same person is
 *  never both an author and a referenced person. */
function asPeople(v: unknown, authorSlugs: Set<string>): ReferencedPerson[] {
  if (!Array.isArray(v)) return [];
  const out: ReferencedPerson[] = [];
  const seen = new Set<string>();
  for (const p of v) {
    let person: ReferencedPerson | null = null;
    if (typeof p === "string" && p.trim()) {
      person = { name: p.trim() };
    } else if (p && typeof p === "object") {
      const name = asStr((p as Record<string, unknown>).name);
      if (!name) continue;
      const relation = asStr((p as Record<string, unknown>).relation) || undefined;
      const confidence = asStr((p as Record<string, unknown>).confidence) || undefined;
      person = { name, ...(relation ? { relation } : {}), ...(confidence ? { confidence } : {}) };
    }
    if (!person) continue;
    const slug = normalizeAuthorSlug(person.name);
    if (authorSlugs.has(slug) || seen.has(slug)) continue; // dedupe vs authors + self
    seen.add(slug);
    out.push(person);
  }
  return out.slice(0, 24);
}

function asSourceQuality(v: unknown): SourceQuality | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const q: SourceQuality = {};
  if (asStr(o.authority)) q.authority = asStr(o.authority);
  if (asStr(o.confidence)) q.confidence = asStr(o.confidence);
  if (asStr(o.bias_or_limits)) q.bias_or_limits = asStr(o.bias_or_limits);
  return Object.keys(q).length ? q : undefined;
}

/** Normalize the model's utility into the allowed set; null if unrecognized. */
function asUtility(v: unknown): "low" | "medium" | "high" | null {
  const s = asStr(v).toLowerCase();
  return s === "low" || s === "medium" || s === "high" ? s : null;
}

/** Drop items from `list` that already appear (case-insensitively) in `exclude`,
 *  so a game tagged "primary" isn't also listed as "mentioned". */
function dedupeAgainst(list: string[], exclude: string[]): string[] {
  const lower = new Set(exclude.map((s) => s.toLowerCase()));
  return list.filter((s) => !lower.has(s.toLowerCase()));
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

  // Bound the text sent to the model so a very long transcript can't blow the
  // local-CLI time budget (the raw snapshot is untouched, so nothing is lost and
  // a re-distill with a higher cap is always possible). Override via DISTILL_MAX_CHARS.
  const maxDistillChars = Number(process.env.DISTILL_MAX_CHARS) || 60_000;
  if (content.length > maxDistillChars) {
    content = content.slice(0, maxDistillChars);
  }

  // Prose precedence: an explicit per-call override, else the project's saved
  // Learn instructions, else the built-in default (handled by the builder).
  const settings = parseSettings(project?.settings);
  const taxonomy = settings.taxonomy;
  const goal = project?.goal ?? "";
  const prose = input.instructions?.trim() || settings.learnInstructions;
  // Build the instruction block ONCE so the hash provably matches the prompt run.
  // The prompt includes the project's taxonomy; the hashed signature does not, so
  // taxonomy edits mark docs metadata-stale (taxonomy_hash) not fully stale.
  const instructionsText = buildLearnInstructions(goal, prose, taxonomy.categories);
  const { instructionHash, goalHash } = computeDistillHashes(goal, prose);
  const taxonomyHash = computeTaxonomyHash(taxonomy);

  const prompt = `${instructionsText}

SOURCE
Title: ${source.title}
Type: ${source.type}${source.url ? `\nURL: ${source.url}` : ""}${
    description ? `\nDescription: ${description}` : ""
  }

Content:
${content}`;

  const { output } = await runModel(input.modelId, prompt);
  const parsed = extractJsonObject(output);
  // parse_status records whether we got structured JSON or fell back to raw text,
  // so the UI can flag low-confidence docs without re-running the model.
  const parseStatus: "ok" | "fallback" = parsed ? "ok" : "fallback";

  // Graceful fallback: if the model didn't return clean JSON, treat the whole
  // output as the summary and leave scoring/category empty.
  const summaryMarkdown =
    (parsed?.summary_markdown as string | undefined)?.trim() || output.trim();

  // Meaningful title from the distill. Pasted notes arrive with a generic
  // placeholder ("Pasted note"), so for note sources we adopt this title as the
  // source's name — it then flows everywhere (scope picker, lists, retrieval).
  const generatedTitle = (asStr(parsed?.title) || "").trim().slice(0, 120);
  const adoptTitle = source.type === "note" && generatedTitle.length >= 3;
  const docTitle = adoptTitle ? generatedTitle : source.title;

  // Category: normalize the model's label to a canonical category (from the
  // project's taxonomy), keeping its raw label as original_category when changed.
  const rawCategory = asStr(parsed?.category) || asStr(parsed?.original_category);
  const category = rawCategory ? normalizeCategory(rawCategory, taxonomy.categories) : null;
  const modelOriginal = asStr(parsed?.original_category) || asStr(parsed?.category);
  const originalCategory =
    modelOriginal && modelOriginal.toLowerCase() !== (category ?? "").toLowerCase()
      ? modelOriginal
      : "";

  // Tags: stored as lowercase kebab-case slugs (rendered readable in the UI).
  const tags = normalizeTags(asStrArray(parsed?.tags, 16), 8);
  const relevanceRaw = Number(parsed?.relevance);
  const relevance =
    Number.isFinite(relevanceRaw) ? Math.max(0, Math.min(100, Math.round(relevanceRaw))) : null;
  const rationale = asStr(parsed?.rationale);

  // v2/v3 structured metadata (all defensively parsed). Entity extraction is
  // gated by the project's taxonomy flags — a disabled type yields [].
  const ee = taxonomy.entityExtraction;
  const utility = asUtility(parsed?.utility);
  const useFor = asStrArray(parsed?.use_for, 12);
  const authors = ee.extract_authors ? asAuthors(parsed?.authors) : [];
  const authorSlugs = new Set(authors.map((a) => normalizeAuthorSlug(a.name)));
  const referencedPeople = ee.extract_referenced_people
    ? asPeople(parsed?.referenced_people, authorSlugs)
    : [];
  // Importance-tiered games/studios. Fall back to the old flat fields for
  // backward compatibility (treat as "mentioned" if the model used the v2 shape).
  const primaryGames = ee.extract_referenced_games ? asStrArray(parsed?.primary_games, 8) : [];
  const secondaryGames = ee.extract_referenced_games ? asStrArray(parsed?.secondary_games, 12) : [];
  const mentionedGames = ee.extract_referenced_games
    ? dedupeAgainst(asStrArray(parsed?.mentioned_games ?? parsed?.referenced_games, 24), [
        ...primaryGames,
        ...secondaryGames,
      ])
    : [];
  const primaryStudios = ee.extract_referenced_studios ? asStrArray(parsed?.primary_studios, 8) : [];
  const mentionedStudios = ee.extract_referenced_studios
    ? dedupeAgainst(asStrArray(parsed?.mentioned_studios ?? parsed?.referenced_studios, 16), primaryStudios)
    : [];
  const keyTerms = ee.extract_key_terms ? asStrArray(parsed?.key_terms, 30) : [];
  const synonyms = ee.extract_synonyms ? asStrArray(parsed?.synonyms, 30) : [];
  const sourceQuality = asSourceQuality(parsed?.source_quality);

  // Entity review: merge the model's flag with a code heuristic that catches
  // transcript-corrupted names (e.g. "Ron Hubbard" → likely "Rob Hubbard").
  const personNames = [...authors.map((a) => a.name), ...referencedPeople.map((p) => p.name)];
  const review = reviewPeopleNames(personNames);
  const entityReviewNotes = [
    ...new Set([...asStrArray(parsed?.entity_review_notes, 12), ...review.notes]),
  ].slice(0, 16);
  const needsEntityReview = parsed?.needs_entity_review === true || review.notes.length > 0;

  // Names that must NOT become strong retrieval signals: heuristic suspects +
  // low-confidence people. They stay in the graph (for explicit filters) but are
  // kept out of the metadata FTS index below.
  const weakNames = new Set<string>([
    ...review.suspects,
    ...referencedPeople
      .filter((p) => (p.confidence ?? "").toLowerCase() === "low")
      .map((p) => p.name),
  ]);
  const whyKeep = asStr(parsed?.why_keep);
  const whyNot = asStr(parsed?.why_not);

  const createdAt = new Date().toISOString();
  const docId = newId();

  // The metadata blob mirrored into both the doc frontmatter and SQLite, so the
  // UI / future retrieval can read structured fields without re-parsing markdown.
  const metadata = {
    original_category: originalCategory || undefined,
    utility,
    use_for: useFor,
    authors,
    referenced_people: referencedPeople,
    primary_games: primaryGames,
    secondary_games: secondaryGames,
    mentioned_games: mentionedGames,
    primary_studios: primaryStudios,
    mentioned_studios: mentionedStudios,
    key_terms: keyTerms,
    synonyms,
    source_quality: sourceQuality,
    needs_entity_review: needsEntityReview,
    entity_review_notes: entityReviewNotes,
    rationale,
    why_keep: whyKeep,
    why_not: whyNot,
  };
  const metadataJson = JSON.stringify(metadata);

  const { markdownPath } = await saveDoc(
    source.projectId,
    summaryMarkdown,
    {
      title: docTitle,
      projectId: source.projectId,
      sourceId: source.id,
      type: source.type,
      kind: "distilled",
      url: source.url ?? undefined,
      category: category ?? undefined,
      original_category: originalCategory || undefined,
      relevance,
      tags,
      topics: [],
      createdAt,
      utility,
      use_for: useFor,
      authors,
      referenced_people: referencedPeople,
      primary_games: primaryGames,
      secondary_games: secondaryGames,
      mentioned_games: mentionedGames,
      primary_studios: primaryStudios,
      mentioned_studios: mentionedStudios,
      needs_entity_review: needsEntityReview,
      entity_review_notes: entityReviewNotes,
      key_terms: keyTerms,
      synonyms,
      source_quality: sourceQuality,
      rationale: rationale || undefined,
      why_keep: whyKeep || undefined,
      why_not: whyNot || undefined,
      instruction_hash: instructionHash,
      goal_hash: goalHash,
      taxonomy_hash: taxonomyHash,
      goal_version: 1,
      learn_schema_version: LEARN_SCHEMA_VERSION,
      distilled_at: createdAt,
      model: input.modelId,
      parse_status: parseStatus,
    },
    docId,
  );

  // Update the source row + taxonomy + provenance (so the Raw list can show stale too).
  const patch: Parameters<typeof updateSource>[1] = {
    status: "distilled",
    distilledPath: markdownPath,
    summary: rationale || whyKeep || `Distilled (relevance ${relevance ?? "?"}/100).`,
    instructionHash,
    goalHash,
    taxonomyHash,
    distilledAt: createdAt,
    model: input.modelId,
    metadataJson,
  };
  if (adoptTitle) patch.title = docTitle;
  if (category) patch.category = category;
  if (relevance != null) patch.relevance = relevance;
  if (utility) patch.utility = utility;
  if (tags.length) patch.tags = JSON.stringify(tags);
  updateSource(source.id, patch);

  if (category) ensureCategory(source.projectId, category);
  if (tags.length) linkSourceTags(source.projectId, source.id, tags);

  // Populate the lightweight people/entity graph (Phase 4). Cleared first so a
  // re-distill doesn't accumulate stale importance tiers.
  clearSourceGraph(source.id);
  for (const a of authors) {
    const id = ensureAuthor(source.projectId, a.name);
    if (id) linkSourceAuthor(source.id, id, a.role, a.confidence);
  }
  for (const p of referencedPeople) {
    const id = ensureEntity(source.projectId, "person", p.name);
    if (id) linkSourceEntity(source.id, id, p.relation || "mentioned", p.confidence);
  }
  const gameTiers: [string[], string][] = [
    [primaryGames, "primary"],
    [secondaryGames, "secondary"],
    [mentionedGames, "mentioned"],
  ];
  for (const [games, relation] of gameTiers) {
    for (const g of games) {
      const id = ensureEntity(source.projectId, "game", g);
      if (id) linkSourceEntity(source.id, id, relation);
    }
  }
  for (const [studios, relation] of [
    [primaryStudios, "primary"],
    [mentionedStudios, "mentioned"],
  ] as [string[], string][]) {
    for (const s of studios) {
      const id = ensureEntity(source.projectId, "studio", s);
      if (id) linkSourceEntity(source.id, id, relation);
    }
  }

  // Meta FTS (Phase 5): tags + key terms + synonyms + STRONG entity signals only.
  // Excluded so weak signals can't dominate retrieval: the "mentioned" tier, and
  // suspect/low-confidence people (they remain queryable via explicit filters).
  const strongPeople = [...authors.map((a) => a.name), ...referencedPeople.map((p) => p.name)].filter(
    (n) => !weakNames.has(n),
  );
  const metaTerms = [
    ...tags,
    ...keyTerms,
    ...synonyms,
    ...strongPeople,
    ...primaryGames,
    ...secondaryGames,
    ...primaryStudios,
  ].join(" ");
  upsertSourceMeta(source.id, source.projectId, metaTerms);

  const learningDocId = createDoc({
    projectId: source.projectId,
    sourceId: source.id,
    kind: "distilled",
    title: docTitle,
    markdownPath,
    summary: rationale || whyKeep || summaryMarkdown.replace(/\s+/g, " ").slice(0, 200),
    category,
    relevance,
    utility,
    instructionHash,
    goalHash,
    taxonomyHash,
    goalVersion: 1,
    learnSchemaVersion: LEARN_SCHEMA_VERSION,
    distilledAt: createdAt,
    model: input.modelId,
    parseStatus,
    metadataJson,
  });

  return { docId: learningDocId, markdownPath, relevance, category };
}
