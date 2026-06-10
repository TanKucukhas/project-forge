import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isChannelInput, listChannelVideos } from "@/lib/capture/channel";

// Spawns yt-dlp (a local binary) — Node runtime only.
export const runtime = "nodejs";

const BodySchema = z.object({
  url: z.string().trim().min(1),
  offset: z.number().int().min(0).max(5000).optional(),
  count: z.number().int().min(1).max(200).optional(),
  withStats: z.boolean().optional(),
  sort: z.enum(["popular", "latest", "oldest"]).optional(),
});

/** POST /api/channel/preview → list a channel's videos so the user can pick
 *  which to import. Does NOT capture anything. */
export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide { url }." }, { status: 400 });
  }
  const { url, offset, count, withStats, sort } = parsed.data;
  if (!isChannelInput(url)) {
    return NextResponse.json({ error: "That doesn't look like a channel." }, { status: 400 });
  }

  try {
    const result = await listChannelVideos(url, {
      offset: offset ?? 0,
      count: count ?? 30,
      withStats,
      sort,
    });
    return NextResponse.json({ ...result, offset: offset ?? 0 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not list channel videos." },
      { status: 502 },
    );
  }
}
