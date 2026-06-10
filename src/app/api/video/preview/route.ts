import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchVideoPreview } from "@/lib/capture/channel";

// Spawns yt-dlp — Node runtime only.
export const runtime = "nodejs";

const BodySchema = z.object({ url: z.string().trim().min(1) });

/** POST /api/video/preview → one video's metadata (no capture), for the
 *  pre-import preview card. */
export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide { url }." }, { status: 400 });
  }
  try {
    return NextResponse.json({ video: await fetchVideoPreview(parsed.data.url) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not read that video." },
      { status: 502 },
    );
  }
}
