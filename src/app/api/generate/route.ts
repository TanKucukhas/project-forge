import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getModelOption, isLocalProvider, isLocalRequestHost, runModel } from "@/lib/ai";

// child_process (local CLI providers) requires the Node.js runtime, not Edge.
export const runtime = "nodejs";

const BodySchema = z.object({
  modelId: z.string().min(1),
  prompt: z.string().min(1).max(200_000),
});

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide { modelId, prompt }." }, { status: 400 });
  }
  const { modelId, prompt } = parsed.data;
  const model = getModelOption(modelId);

  // Local CLI execution is localhost-only — never exposed over the network.
  if (isLocalProvider(model.provider) && !isLocalRequestHost(request.headers.get("host") ?? "")) {
    return NextResponse.json(
      { error: "Local CLI models only accept localhost requests." },
      { status: 403 },
    );
  }

  try {
    const { output } = await runModel(modelId, prompt);
    return NextResponse.json({
      model,
      output: output || "The model returned an empty response.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed." },
      { status: 502 },
    );
  }
}
