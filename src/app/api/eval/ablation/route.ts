import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOption, isLocalProvider, isLocalRequestHost } from "@/lib/ai";
import { getProject, newId } from "@/lib/db/queries";
import { runGenerate } from "@/lib/generate/run";

// Runs the model 3× (may be a local CLI), Node runtime only.
export const runtime = "nodejs";

/**
 * Ablation runner (Phase 9): run the SAME request three ways — distilled
 * summaries only, raw chunks only, and hybrid — so we can compare whether
 * distillation actually beats raw context. Each variant logs its own retrieval
 * run and saves its output under outputs/evals/ (never overwriting). No
 * automatic judge — manual blind review.
 */
const BodySchema = z.object({
  projectId: z.string().min(1),
  question: z.string().trim().min(1).max(4000),
  modelId: z.string().min(1),
  outputType: z
    .enum([
      "answer",
      "game_concept",
      "gdd",
      "prototype_spec",
      "technical_spec",
      "agent_build_prompt",
      "evaluation_checklist",
    ])
    .default("game_concept"),
  sourceIds: z.array(z.string()).optional(),
  category: z.string().optional(),
});

const VARIANTS = [
  { variant: "distilled", mode: "summaries" as const },
  { variant: "raw", mode: "full" as const },
  { variant: "hybrid", mode: "hybrid" as const },
];

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide { projectId, question, modelId, outputType?, sourceIds?, category? }." },
      { status: 400 },
    );
  }
  const { projectId, question, modelId, outputType, sourceIds, category } = parsed.data;
  if (!getProject(projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 404 });
  }

  const model = getModelOption(modelId);
  if (isLocalProvider(model.provider) && !isLocalRequestHost(request.headers.get("host") ?? "")) {
    return NextResponse.json(
      { error: "Local CLI models only accept localhost requests." },
      { status: 403 },
    );
  }

  const evalId = newId();
  const subdir = `evals/${evalId}`;
  const scope = { mode: "auto" as const, sourceIds, category };

  try {
    const runs = [];
    // Sequential: the in-process model queue runs one at a time anyway, and
    // sequential keeps local-CLI memory bounded.
    for (const v of VARIANTS) {
      const r = await runGenerate({
        projectId,
        outputType,
        request: question,
        modelId,
        scope,
        modeOverride: v.mode,
        subdir,
        variant: v.variant,
        persistOutputRow: false,
      });
      runs.push({
        variant: v.variant,
        retrievalRunId: r.retrievalRunId,
        outputPath: r.markdownPath,
        contextCharCount: r.contextCharCount,
        sources: r.used.length,
      });
    }
    return NextResponse.json({ evalId, outputType, runs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ablation failed." },
      { status: 502 },
    );
  }
}
