/**
 * Scoped Ask: answer a question over a chosen slice of a project's knowledge.
 * Scope keeps token spend deliberate:
 *   mode "summaries" → feed compact distilled summaries (cheap, broad)
 *   mode "full"      → FTS5-retrieve the most relevant raw chunks (precise)
 * Selection narrows further: all sources · specific source ids · a category.
 */
import "server-only";
import matter from "gray-matter";
import { runModel } from "@/lib/ai";
import { readLibraryFile } from "@/lib/library/store";
import {
  getProject,
  listSources,
  searchChunks,
  sourceIdsForCategory,
} from "@/lib/db/queries";

export type AskScope = {
  mode: "summaries" | "full";
  sourceIds?: string[];
  category?: string;
};

const MAX_CONTEXT_CHARS = 24_000;

export async function runAsk(input: {
  projectId: string;
  question: string;
  modelId: string;
  scope: AskScope;
}): Promise<{ answer: string; usedSources: { id: string; title: string }[]; mode: string }> {
  const project = getProject(input.projectId);
  const allSources = listSources(input.projectId);

  // Resolve the selection to a concrete set of source ids (null = all).
  let targetIds: string[] | null = null;
  if (input.scope.category) {
    targetIds = sourceIdsForCategory(input.projectId, input.scope.category);
  } else if (input.scope.sourceIds && input.scope.sourceIds.length) {
    targetIds = input.scope.sourceIds;
  }
  const inScope = (id: string) => !targetIds || targetIds.includes(id);

  const used: { id: string; title: string }[] = [];
  let context = "";

  if (input.scope.mode === "summaries") {
    // Use distilled summaries only — far cheaper than raw transcripts.
    const distilled = allSources.filter((s) => s.distilledPath && inScope(s.id));
    if (!distilled.length) {
      throw new Error("No distilled summaries in scope. Distill some sources first, or use full mode.");
    }
    for (const s of distilled) {
      if (context.length > MAX_CONTEXT_CHARS) break;
      try {
        const md = await readLibraryFile(s.distilledPath!);
        const body = matter(md).content.trim();
        context += `\n\n## ${s.title}${s.relevance != null ? ` (relevance ${s.relevance}/100)` : ""}\n${body}`;
        used.push({ id: s.id, title: s.title });
      } catch {
        /* skip unreadable */
      }
    }
  } else {
    // Full mode: retrieve the most relevant raw chunks for the question.
    const hits = searchChunks(input.projectId, input.question, targetIds, 14);
    if (!hits.length) {
      throw new Error("No matching content found for that question in the selected scope.");
    }
    const titleById = new Map(allSources.map((s) => [s.id, s.title] as const));
    const seen = new Set<string>();
    for (const hit of hits) {
      if (context.length > MAX_CONTEXT_CHARS) break;
      const title = titleById.get(hit.sourceId) ?? "Unknown source";
      context += `\n\n[${title}]\n${hit.content}`;
      if (!seen.has(hit.sourceId)) {
        seen.add(hit.sourceId);
        used.push({ id: hit.sourceId, title });
      }
    }
  }

  const prompt = `Answer the QUESTION using ONLY the CONTEXT from the user's knowledge base.
Cite the sources you draw on by their bracketed/heading title. If the context is
insufficient, say so plainly and note what's missing. Surface any contradictions
between sources.

PROJECT GOAL: ${project?.goal || "(none set)"}

QUESTION:
${input.question}

CONTEXT:
${context.trim()}`;

  const { output } = await runModel(input.modelId, prompt);
  return { answer: output, usedSources: used, mode: input.scope.mode };
}
