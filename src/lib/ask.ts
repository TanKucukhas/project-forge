/**
 * Scoped Ask: answer a question over a chosen slice of a project's knowledge.
 *
 * Modes (token spend, lowest → highest precision):
 *   summaries → distilled summaries only (cheap, broad)
 *   full      → FTS5-retrieved raw chunks (precise, source-level)
 *   hybrid    → top summaries + a few supporting raw chunks (default)
 *   auto      → hybrid, unless the question clearly wants source-level detail
 *
 * Scope/filters narrow the candidate sources BEFORE ranking: category, tags,
 * authors, explicit source ids, and inline @mentions (@author #tag game:X use:Y).
 * Retrieval is ranked with light metadata boosts (relevance/utility/use_for) and
 * every run is logged (Phase 6) so we can inspect what context was used.
 */
import "server-only";
import matter from "gray-matter";
import { runModel } from "@/lib/ai";
import { readLibraryFile } from "@/lib/library/store";
import { parseMentions } from "@/lib/mentions";
import { normalizeCategory, normalizeEntitySlug } from "@/lib/taxonomy";
import {
  getProject,
  listSources,
  searchChunks,
  searchMetaSources,
  sourceIdsForCategory,
  sourceIdsForTag,
  sourceIdsForAuthorSlug,
  sourceIdsForEntitySlug,
  logRetrieval,
  type RetrievalItem,
} from "@/lib/db/queries";

export type AskMode = "summaries" | "full" | "hybrid" | "auto";

export type AskScope = {
  mode: AskMode;
  category?: string;
  categories?: string[];
  sourceIds?: string[];
  tags?: string[];
  authors?: string[];
  games?: string[];
  uses?: string[];
};

export type RetrievedItem = {
  title: string;
  sourceId: string | null;
  matchType: string;
  rank?: number | null;
  category?: string | null;
  relevance?: number | null;
  utility?: string | null;
  contextType?: "summary" | "chunk" | "metadata";
};

export type AskAnswer = {
  answer: string;
  usedSources: { id: string; title: string }[];
  retrieved: RetrievedItem[];
  mode: string;
  retrievalRunId: string;
  contextCharCount: number;
};

const MAX_CONTEXT_CHARS = 24_000;
const utilityRank: Record<string, number> = { high: 2, medium: 1, low: 0 };

type SourceRow = ReturnType<typeof listSources>[number];

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Resolve scope + inline mentions to a concrete source-id set. Multiple values
 *  within a dimension are unioned; dimensions are intersected. null = all. */
function resolveScope(
  projectId: string,
  scope: AskScope,
  mentions: ReturnType<typeof parseMentions>,
): string[] | null {
  const dims: string[][] = [];

  const categories = unique(
    [scope.category, ...(scope.categories ?? []), ...mentions.categories]
      .filter((c): c is string => Boolean(c))
      .map((c) => normalizeCategory(c)),
  );
  if (categories.length) dims.push(unique(categories.flatMap((c) => sourceIdsForCategory(projectId, c))));

  const tags = unique([...(scope.tags ?? []), ...mentions.tags]);
  if (tags.length) dims.push(unique(tags.flatMap((t) => sourceIdsForTag(projectId, t))));

  const authors = unique([...(scope.authors ?? []), ...mentions.authors]);
  if (authors.length) dims.push(unique(authors.flatMap((a) => sourceIdsForAuthorSlug(projectId, a))));

  const gameRefs = unique([...(scope.games ?? []), ...mentions.games]);
  if (gameRefs.length) {
    dims.push(
      unique(gameRefs.flatMap((g) => sourceIdsForEntitySlug(projectId, normalizeEntitySlug(g), "game"))),
    );
  }

  if (scope.sourceIds?.length) dims.push(scope.sourceIds);

  if (!dims.length) return null;
  return dims.reduce((acc, d) => acc.filter((id) => d.includes(id)));
}

/** Resolve hybrid/auto to a concrete mode. Auto picks full only when the question
 *  clearly wants source-level detail; otherwise hybrid. */
function effectiveMode(mode: AskMode, question: string): "summaries" | "full" | "hybrid" {
  if (mode !== "auto") return mode;
  return /\b(exact|exactly|quote|verbatim|transcript|timestamp|word[- ]for[- ]word|which video|where did)\b/i.test(
    question,
  )
    ? "full"
    : "hybrid";
}

/** Light metadata boost score for ranking distilled sources. */
function scoreSource(s: SourceRow, uses: string[]): number {
  let score = s.relevance ?? 50;
  if (s.utility === "high") score += 10;
  if ((s.relevance ?? 0) >= 85) score += 10;
  if (uses.length && s.metadataJson) {
    try {
      const useFor = (JSON.parse(s.metadataJson) as { use_for?: string[] }).use_for ?? [];
      if (useFor.some((u) => uses.includes(u))) score += 15;
    } catch {
      /* ignore bad metadata */
    }
  }
  return score;
}

export type RetrievedContext = {
  mode: "summaries" | "full" | "hybrid";
  context: string;
  used: { id: string; title: string }[];
  retrieved: RetrievedItem[];
  logItems: RetrievalItem[];
  uses: string[];
  targetCount: number | null;
  mentions: ReturnType<typeof parseMentions>;
};

/**
 * Retrieve grounded context for a query under a scope/mode. Shared by Ask,
 * Generate, and the ablation runner so all three rank context identically.
 * `modeOverride` forces a concrete mode (ablation variants); otherwise the
 * scope's mode (incl. auto) is resolved here.
 */
export async function retrieveContext(input: {
  projectId: string;
  question: string;
  scope: AskScope;
  modeOverride?: "summaries" | "full" | "hybrid";
}): Promise<RetrievedContext> {
  const allSources = listSources(input.projectId);
  const byId = new Map(allSources.map((s) => [s.id, s] as const));

  const mentions = parseMentions(input.question);
  const queryText = mentions.text || input.question; // strip @/#/field tokens for FTS
  const uses = unique([...(input.scope.uses ?? []), ...mentions.uses]);
  const targetIds = resolveScope(input.projectId, input.scope, mentions);
  const inScope = (id: string) => !targetIds || targetIds.includes(id);
  const mode = input.modeOverride ?? effectiveMode(input.scope.mode, input.question);

  const used: { id: string; title: string }[] = [];
  const retrieved: RetrievedItem[] = [];
  const logItems: RetrievalItem[] = [];
  const seenSources = new Set<string>();
  let context = "";

  const addSource = (id: string, title: string) => {
    if (!seenSources.has(id)) {
      seenSources.add(id);
      used.push({ id, title });
    }
  };

  // ── Summaries (used by summaries + hybrid) ──
  const summariesBudget = mode === "hybrid" ? Math.floor(MAX_CONTEXT_CHARS * 0.6) : MAX_CONTEXT_CHARS;
  if (mode === "summaries" || mode === "hybrid") {
    const distilled = allSources
      .filter((s) => s.distilledPath && inScope(s.id))
      .sort(
        (a, b) =>
          scoreSource(b, uses) - scoreSource(a, uses) ||
          (utilityRank[b.utility ?? ""] ?? -1) - (utilityRank[a.utility ?? ""] ?? -1),
      );
    for (const s of distilled) {
      if (context.length > summariesBudget) break;
      try {
        const md = await readLibraryFile(s.distilledPath!);
        const body = matter(md).content.trim();
        context += `\n\n## ${s.title}${s.relevance != null ? ` (relevance ${s.relevance}/100)` : ""}\n${body}`;
        addSource(s.id, s.title);
        retrieved.push({
          title: s.title,
          sourceId: s.id,
          matchType: "source_summary",
          category: s.category,
          relevance: s.relevance,
          utility: s.utility,
          contextType: "summary",
        });
        logItems.push({
          sourceId: s.id,
          learningDocId: null,
          title: s.title,
          score: scoreSource(s, uses),
          matchType: "source_summary",
          metadata: { relevance: s.relevance, utility: s.utility, category: s.category },
        });
      } catch {
        /* skip unreadable */
      }
    }
  }

  // ── Raw chunks (used by full + hybrid) ──
  if (mode === "full" || mode === "hybrid") {
    const chunkLimit = mode === "hybrid" ? 6 : 14;
    const hits = searchChunks(input.projectId, queryText, targetIds, chunkLimit);
    for (const hit of hits) {
      if (context.length > MAX_CONTEXT_CHARS) break;
      const title = byId.get(hit.sourceId)?.title ?? "Unknown source";
      context += `\n\n[${title}]\n${hit.content}`;
      addSource(hit.sourceId, title);
      retrieved.push({
        title,
        sourceId: hit.sourceId,
        matchType: "fts",
        rank: hit.rank,
        category: byId.get(hit.sourceId)?.category,
        relevance: byId.get(hit.sourceId)?.relevance,
        utility: byId.get(hit.sourceId)?.utility,
        contextType: "chunk",
      });
      logItems.push({
        sourceId: hit.sourceId,
        chunkId: hit.chunkId,
        title,
        rank: hit.rank,
        matchType: "fts",
      });
    }

    // Phase 5 expansion: pull a few sources whose metadata (key_terms/synonyms/
    // tags/entities) matches but whose transcript text didn't — only when not
    // already represented, and bounded so synonyms never flood the context.
    const metaHits = searchMetaSources(input.projectId, queryText, targetIds, 4);
    for (const m of metaHits) {
      if (context.length > MAX_CONTEXT_CHARS) break;
      if (seenSources.has(m.sourceId)) continue;
      const s = byId.get(m.sourceId);
      if (!s) continue;
      let snippet = "";
      try {
        if (s.distilledPath) snippet = matter(await readLibraryFile(s.distilledPath)).content.trim().slice(0, 1500);
      } catch {
        /* ignore */
      }
      if (!snippet) continue;
      context += `\n\n[${s.title}] (matched on key terms)\n${snippet}`;
      addSource(s.id, s.title);
      retrieved.push({
        title: s.title,
        sourceId: s.id,
        matchType: "meta_fts",
        rank: m.rank,
        category: s.category,
        relevance: s.relevance,
        utility: s.utility,
        contextType: "metadata",
      });
      logItems.push({ sourceId: s.id, title: s.title, rank: m.rank, matchType: "meta_fts" });
    }
  }

  return {
    mode,
    context,
    used,
    retrieved,
    logItems,
    uses,
    targetCount: targetIds?.length ?? null,
    mentions,
  };
}

export async function runAsk(input: {
  projectId: string;
  question: string;
  modelId: string;
  scope: AskScope;
}): Promise<AskAnswer> {
  const project = getProject(input.projectId);
  const r = await retrieveContext({
    projectId: input.projectId,
    question: input.question,
    scope: input.scope,
  });

  if (!r.context.trim()) {
    throw new Error(
      r.mode === "summaries"
        ? "No distilled summaries in scope. Learn some sources first, or try Full/Hybrid mode."
        : "No matching content found for that question in the selected scope.",
    );
  }

  const prompt = `Answer the QUESTION using ONLY the CONTEXT from the user's knowledge base.

Cite the sources you draw on by their bracketed/heading title.
If the context is insufficient, say so plainly and note what is missing.
Surface contradictions between sources when relevant.
Do not invent unsupported facts.

PROJECT GOAL:
${project?.goal || "(none set)"}

QUESTION:
${input.question}

CONTEXT:
${r.context.trim()}`;

  const { output } = await runModel(input.modelId, prompt);

  // Best-effort logging — never let it break the answer.
  let retrievalRunId = "";
  try {
    retrievalRunId = logRetrieval({
      projectId: input.projectId,
      mode: r.mode,
      query: input.question,
      filters: {
        scopeMode: input.scope.mode,
        category: input.scope.category,
        tags: input.scope.tags,
        authors: input.scope.authors,
        sourceIds: input.scope.sourceIds,
        uses: r.uses,
        mentions: r.mentions,
        targetCount: r.targetCount,
      },
      contextCharCount: r.context.length,
      items: r.logItems,
    });
  } catch {
    /* logging is non-critical */
  }

  return {
    answer: output,
    usedSources: r.used,
    retrieved: r.retrieved,
    mode: r.mode,
    retrievalRunId,
    contextCharCount: r.context.length,
  };
}
