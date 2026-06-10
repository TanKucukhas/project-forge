import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOption, isLocalProvider, isLocalRequestHost } from "@/lib/ai";
import { runAsk } from "@/lib/ask";
import { getProject } from "@/lib/db/queries";

// Ask runs the model synchronously (interactive) — Node runtime only.
export const runtime = "nodejs";

const BodySchema = z.object({
  projectId: z.string().min(1),
  question: z.string().trim().min(1).max(4000),
  modelId: z.string().min(1),
  scope: z.object({
    mode: z.enum(["summaries", "full"]),
    sourceIds: z.array(z.string()).optional(),
    category: z.string().optional(),
  }),
});

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide { projectId, question, modelId, scope }." },
      { status: 400 },
    );
  }
  const { projectId, question, modelId, scope } = parsed.data;
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
    const result = await runAsk({ projectId, question, modelId, scope });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ask failed." },
      { status: 502 },
    );
  }
}
