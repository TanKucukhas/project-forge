import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { retrieveContext } from "@/lib/ask";
import { getProject } from "@/lib/db/queries";

// Dry-run retrieval — reads the DB/library, NEVER calls a model. So no localhost
// gate / paid-model concern; it's free and deterministic.
export const runtime = "nodejs";

const BodySchema = z.object({
  projectId: z.string().min(1),
  question: z.string().trim().min(1).max(4000),
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

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide { projectId, question, scope }." }, { status: 400 });
  }
  const { projectId, question, scope } = parsed.data;
  if (!getProject(projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 404 });
  }
  try {
    const r = await retrieveContext({ projectId, question, scope });
    return NextResponse.json({
      mode: r.mode,
      contextCharCount: r.context.length,
      retrieved: r.retrieved,
      used: r.used,
      targetCount: r.targetCount,
      summaryCount: r.retrieved.filter((x) => x.contextType === "summary").length,
      chunkCount: r.retrieved.filter((x) => x.contextType === "chunk").length,
      metadataCount: r.retrieved.filter((x) => x.contextType === "metadata").length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Preview failed." },
      { status: 500 },
    );
  }
}
