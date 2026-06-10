import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOption, isLocalProvider, isLocalRequestHost } from "@/lib/ai";
import { providerThrottleMs } from "@/lib/ai/models";
import { enqueueJob } from "@/lib/queue/queue";
import { ensureQueueReady } from "@/lib/queue/handlers";
import { getSource } from "@/lib/db/queries";

// Distill spawns a (possibly local CLI) model — Node runtime only.
export const runtime = "nodejs";

const BodySchema = z.object({
  sourceId: z.string().min(1),
  modelId: z.string().min(1),
  instructions: z.string().trim().max(20_000).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide { sourceId, modelId }." }, { status: 400 });
  }
  const { sourceId, modelId, instructions } = parsed.data;

  const model = getModelOption(modelId);
  if (isLocalProvider(model.provider) && !isLocalRequestHost(request.headers.get("host") ?? "")) {
    return NextResponse.json(
      { error: "Local CLI models only accept localhost requests." },
      { status: 403 },
    );
  }

  const source = getSource(sourceId);
  if (!source) return NextResponse.json({ error: "Source not found." }, { status: 404 });
  if (source.status === "pending") {
    return NextResponse.json(
      { error: "Source is still capturing — wait for it to finish." },
      { status: 409 },
    );
  }

  ensureQueueReady();
  const job = enqueueJob(
    "distill",
    `Distill: ${source.title}`,
    { sourceId, modelId, instructions },
    { throttleMs: providerThrottleMs(model.provider) },
  );
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
