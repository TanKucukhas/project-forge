import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOption, isLocalProvider, isLocalRequestHost, runModelStream } from "@/lib/ai";
import { retrieveContext, type AskScope } from "@/lib/ask";
import { buildGeneratePrompt, outputTypeUseFor, type GenerateOutputType } from "@/lib/generate/build";
import { saveOutput } from "@/lib/library/store";
import {
  getProject,
  logRetrieval,
  createOutput,
  linkOutputSources,
  newId,
} from "@/lib/db/queries";

// Streams model output as it's generated (may spawn a local CLI) — Node runtime.
export const runtime = "nodejs";

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
    .default("answer"),
  scope: z.object({
    mode: z.enum(["summaries", "full", "hybrid", "auto"]),
    sourceIds: z.array(z.string()).optional(),
    category: z.string().optional(),
    categories: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    authors: z.array(z.string()).optional(),
    games: z.array(z.string()).optional(),
    uses: z.array(z.string()).optional(),
  }),
});

/**
 * NDJSON stream of events:
 *   {type:"meta", mode, retrieved, used, contextCharCount}
 *   {type:"delta", text}            (repeated)
 *   {type:"done", retrievalRunId, markdownPath?}
 *   {type:"error", message}
 */
export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide { projectId, question, modelId, scope }." },
      { status: 400 },
    );
  }
  const { projectId, question, modelId, outputType } = parsed.data;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: "Unknown project." }, { status: 404 });

  const model = getModelOption(modelId);
  if (isLocalProvider(model.provider) && !isLocalRequestHost(request.headers.get("host") ?? "")) {
    return NextResponse.json(
      { error: "Local CLI models only accept localhost requests." },
      { status: 403 },
    );
  }

  // Inject the output type's use_for so generation retrieval boosts matching docs.
  const scope: AskScope = { ...parsed.data.scope };
  if (outputType !== "answer") {
    scope.uses = [...(scope.uses ?? []), outputTypeUseFor(outputType as GenerateOutputType)];
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const r = await retrieveContext({ projectId, question, scope });

        if (outputType === "answer" && !r.context.trim()) {
          send({
            type: "error",
            message:
              r.mode === "summaries"
                ? "No distilled summaries in scope. Learn some sources first, or try Full/Hybrid mode."
                : "No matching content found for that question in the selected scope.",
          });
          controller.close();
          return;
        }

        send({
          type: "meta",
          mode: r.mode,
          retrieved: r.retrieved,
          used: r.used,
          contextCharCount: r.context.length,
        });

        const prompt =
          outputType === "answer"
            ? `Answer the QUESTION using ONLY the CONTEXT from the user's knowledge base.

Cite the sources you draw on by their bracketed/heading title.
If the context is insufficient, say so plainly and note what is missing.
Surface contradictions between sources when relevant.
Do not invent unsupported facts.

PROJECT GOAL:
${project.goal || "(none set)"}

QUESTION:
${question}

CONTEXT:
${r.context.trim()}`
            : buildGeneratePrompt(project.goal, outputType as GenerateOutputType, question, r.context);

        const { output } = await runModelStream(modelId, prompt, (text) => send({ type: "delta", text }));

        // Log retrieval (best-effort).
        let retrievalRunId = "";
        try {
          retrievalRunId = logRetrieval({
            projectId,
            mode: r.mode,
            query: question,
            filters: { outputType, targetCount: r.targetCount },
            contextCharCount: r.context.length,
            items: r.logItems,
          });
        } catch {
          /* non-critical */
        }

        // For structured outputs, persist the result (Ask answers are saved on demand).
        let markdownPath: string | undefined;
        if (outputType !== "answer" && output.trim()) {
          try {
            const createdAt = new Date().toISOString();
            const sourceIds = r.used.map((u) => u.id);
            const title = `${outputType}: ${question.slice(0, 60)}`;
            const saved = await saveOutput(
              projectId,
              title,
              output,
              {
                projectId,
                outputType,
                request: question,
                model: modelId,
                retrievalRunId,
                sourceIds,
                createdAt,
              },
              newId(),
            );
            markdownPath = saved.markdownPath;
            const outId = createOutput({ projectId, type: outputType, title, markdownPath, modelId });
            if (sourceIds.length) linkOutputSources(outId, sourceIds);
          } catch {
            /* saving is best-effort; the streamed text already reached the client */
          }
        }

        send({ type: "done", retrievalRunId, markdownPath });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Ask failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
