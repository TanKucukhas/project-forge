import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOption, isLocalProvider, isLocalRequestHost } from "@/lib/ai";
import { getProject } from "@/lib/db/queries";
import { runGenerate } from "@/lib/generate/run";

// Generates a grounded project output — may spawn a local CLI, Node runtime only.
export const runtime = "nodejs";

const BodySchema = z.object({
  projectId: z.string().min(1),
  outputType: z.enum([
    "answer",
    "game_concept",
    "gdd",
    "prototype_spec",
    "technical_spec",
    "agent_build_prompt",
    "evaluation_checklist",
  ]),
  request: z.string().trim().min(1).max(4000),
  modelId: z.string().min(1),
  scope: z.object({
    mode: z.enum(["summaries", "full", "hybrid", "auto"]).default("hybrid"),
    sourceIds: z.array(z.string()).optional(),
    category: z.string().optional(),
    categories: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    authors: z.array(z.string()).optional(),
    games: z.array(z.string()).optional(),
    uses: z.array(z.string()).optional(),
  }),
});

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide { projectId, outputType, request, modelId, scope }." },
      { status: 400 },
    );
  }
  const { projectId, outputType, request: req, modelId, scope } = parsed.data;
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

  try {
    const result = await runGenerate({ projectId, outputType, request: req, modelId, scope });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed." },
      { status: 502 },
    );
  }
}
