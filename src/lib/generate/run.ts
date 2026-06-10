/**
 * Run one generation: retrieve grounded context → build the output prompt → run
 * the model → persist the output with provenance + retrieval log. Shared by the
 * generate-output route and the ablation runner (which calls it once per variant
 * with a forced retrieval mode).
 */
import "server-only";
import { retrieveContext, type AskScope, type RetrievedItem } from "@/lib/ask";
import { buildGeneratePrompt, outputTypeUseFor, type GenerateOutputType } from "./build";
import { runModel } from "@/lib/ai";
import { saveOutput } from "@/lib/library/store";
import {
  getProject,
  logRetrieval,
  createOutput,
  linkOutputSources,
  newId,
} from "@/lib/db/queries";

export type GenerateResult = {
  markdownPath: string;
  output: string;
  retrievalRunId: string;
  mode: string;
  used: { id: string; title: string }[];
  retrieved: RetrievedItem[];
  contextCharCount: number;
};

export async function runGenerate(input: {
  projectId: string;
  outputType: GenerateOutputType;
  request: string;
  modelId: string;
  scope: AskScope;
  modeOverride?: "summaries" | "full" | "hybrid";
  /** subdir under outputs/ (e.g. "evals") and a variant label for ablation. */
  subdir?: string;
  variant?: string;
  /** ablation variants skip the outputs table (they live under outputs/evals/). */
  persistOutputRow?: boolean;
}): Promise<GenerateResult> {
  const project = getProject(input.projectId);

  // Boost docs that declared they're useful for this output type (use_for).
  const scope: AskScope = {
    ...input.scope,
    uses: [...(input.scope.uses ?? []), outputTypeUseFor(input.outputType)],
  };

  const r = await retrieveContext({
    projectId: input.projectId,
    question: input.request,
    scope,
    modeOverride: input.modeOverride,
  });

  const prompt = buildGeneratePrompt(
    project?.goal ?? "",
    input.outputType,
    input.request,
    r.context,
  );
  const { output } = await runModel(input.modelId, prompt);

  let retrievalRunId = "";
  try {
    retrievalRunId = logRetrieval({
      projectId: input.projectId,
      mode: input.variant ? `ablation_${r.mode}` : r.mode,
      query: input.request,
      filters: { outputType: input.outputType, variant: input.variant, targetCount: r.targetCount },
      contextCharCount: r.context.length,
      items: r.logItems,
    });
  } catch {
    /* logging is non-critical */
  }

  const createdAt = new Date().toISOString();
  const docId = newId();
  const sourceIds = r.used.map((u) => u.id);
  const title = `${input.outputType}: ${input.request.slice(0, 60)}`;

  const { markdownPath } = await saveOutput(
    input.projectId,
    title,
    output,
    {
      projectId: input.projectId,
      outputType: input.outputType,
      request: input.request,
      model: input.modelId,
      retrievalRunId,
      sourceIds,
      createdAt,
      variant: input.variant,
    },
    docId,
    input.subdir ?? "",
  );

  if (input.persistOutputRow !== false) {
    const outId = createOutput({
      projectId: input.projectId,
      type: input.outputType,
      title,
      markdownPath,
      modelId: input.modelId,
    });
    linkOutputSources(outId, sourceIds);
  }

  return {
    markdownPath,
    output,
    retrievalRunId,
    mode: r.mode,
    used: r.used,
    retrieved: r.retrieved,
    contextCharCount: r.context.length,
  };
}
