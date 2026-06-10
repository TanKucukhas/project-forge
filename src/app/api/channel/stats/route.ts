import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchVideoStatsBatch } from "@/lib/capture/channel";

// Spawns yt-dlp — Node runtime only.
export const runtime = "nodejs";

const BodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(60),
});

/** POST /api/channel/stats → view/like counts for a batch of video ids, so the
 *  UI can enrich a preview page progressively without blocking the listing. */
export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide { ids: string[] }." }, { status: 400 });
  }
  try {
    const map = await fetchVideoStatsBatch(parsed.data.ids);
    const stats: Record<string, { viewCount: number | null; likeCount: number | null }> = {};
    for (const [id, s] of map) stats[id] = s;
    return NextResponse.json({ stats });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not fetch stats." },
      { status: 502 },
    );
  }
}
