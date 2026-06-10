import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProject, listOutputs, createOutput, linkOutputSources, newId } from "@/lib/db/queries";
import { saveOutput } from "@/lib/library/store";

// Persists already-generated Markdown — no model call.
export const runtime = "nodejs";

/** GET /api/outputs?projectId=… → saved outputs for the project. */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
  if (!projectId || !getProject(projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 404 });
  }
  return NextResponse.json({ outputs: listOutputs(projectId) });
}

const BodySchema = z.object({
  projectId: z.string().min(1),
  type: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  markdown: z.string().min(1).max(500_000),
  request: z.string().max(4000).optional(),
  modelId: z.string().max(80).optional(),
  retrievalRunId: z.string().max(40).optional(),
  sourceIds: z.array(z.string()).optional(),
});

/** POST /api/outputs → save an Ask answer / generated text as a durable output. */
export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide { projectId, type, title, markdown }." },
      { status: 400 },
    );
  }
  const b = parsed.data;
  if (!getProject(b.projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 404 });
  }

  const createdAt = new Date().toISOString();
  const docId = newId();
  try {
    const { markdownPath } = await saveOutput(
      b.projectId,
      b.title,
      b.markdown,
      {
        projectId: b.projectId,
        outputType: b.type,
        request: b.request ?? "",
        model: b.modelId ?? "",
        retrievalRunId: b.retrievalRunId,
        sourceIds: b.sourceIds ?? [],
        createdAt,
      },
      docId,
    );
    const outId = createOutput({
      projectId: b.projectId,
      type: b.type,
      title: b.title,
      markdownPath,
      modelId: b.modelId ?? "",
    });
    if (b.sourceIds?.length) linkOutputSources(outId, b.sourceIds);
    return NextResponse.json({ outputId: outId, markdownPath });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save output." },
      { status: 500 },
    );
  }
}
