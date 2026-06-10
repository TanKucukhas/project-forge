import { NextRequest, NextResponse } from "next/server";
import { getSource } from "@/lib/db/queries";
import { readLibraryFile } from "@/lib/library/store";

export const runtime = "nodejs";

/** GET /api/snapshot?id=<sourceId> → the raw captured snapshot (transcript / page text). */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const source = getSource(id);
  if (!source) return NextResponse.json({ error: "Source not found." }, { status: 404 });
  if (!source.rawTextPath) {
    return NextResponse.json(
      { error: "No snapshot was saved for this source." },
      { status: 404 },
    );
  }

  try {
    const snapshot = JSON.parse(await readLibraryFile(source.rawTextPath)) as {
      content?: string;
      transcriptFetched?: boolean;
      thumbnail?: string | null;
      description?: string | null;
      durationSeconds?: number | null;
      viewCount?: number | null;
      publishedAt?: string | null;
      keywords?: string[];
    };
    return NextResponse.json({
      id: source.id,
      title: source.title,
      type: source.type,
      url: source.url,
      author: source.author,
      channel: source.channel,
      thumbnail: snapshot.thumbnail ?? null,
      description: snapshot.description ?? null,
      durationSeconds: snapshot.durationSeconds ?? null,
      viewCount: source.viewCount,
      likeCount: source.likeCount,
      credibility: source.credibility,
      relevance: source.relevance,
      category: source.category,
      publishedAt: snapshot.publishedAt ?? null,
      keywords: snapshot.keywords ?? [],
      transcriptFetched: Boolean(snapshot.transcriptFetched),
      content: snapshot.content ?? "",
    });
  } catch {
    return NextResponse.json({ error: "Could not read the snapshot." }, { status: 500 });
  }
}
