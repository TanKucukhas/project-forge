import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enqueue } from "@/lib/queue/queue";
import { runCapture } from "@/lib/queue/jobs";
import { isChannelInput, listChannelVideos } from "@/lib/capture/channel";
import { getProject } from "@/lib/db/queries";

// Capture touches the filesystem, spawns transcript scrapes and yt-dlp — Node only.
export const runtime = "nodejs";

const BodySchema = z
  .object({
    projectId: z.string().min(1),
    url: z.string().trim().min(1).optional(),
    urls: z.array(z.string().trim().min(1)).max(200).optional(),
    notes: z.string().trim().optional(),
    title: z.string().trim().max(300).optional(),
    channelLimit: z.number().int().min(1).max(200).optional(),
  })
  .refine((b) => Boolean(b.url) || Boolean(b.notes) || Boolean(b.urls?.length), {
    message: "Provide a URL, channel, video selection, or notes to capture.",
  });

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid capture request." },
      { status: 400 },
    );
  }

  const { projectId, url, urls, notes, title, channelLimit } = parsed.data;
  if (!getProject(projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 404 });
  }

  // Explicit multi-select (the channel preview → confirm path): one job per url.
  if (urls && urls.length) {
    const jobIds = urls.map((u) => enqueue("capture", u, () => runCapture({ projectId, url: u })).id);
    return NextResponse.json({ batch: true, count: jobIds.length, jobIds }, { status: 202 });
  }

  // Channel without preview: expand to N videos and enqueue one capture job each.
  if (url && isChannelInput(url)) {
    let videos;
    try {
      ({ videos } = await listChannelVideos(url, { count: channelLimit ?? 50 }));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Could not list channel videos." },
        { status: 502 },
      );
    }
    const jobIds = videos.map(
      (v) =>
        enqueue("capture", v.title, () => runCapture({ projectId, url: v.url, title: v.title })).id,
    );
    return NextResponse.json(
      { channel: true, count: videos.length, jobIds },
      { status: 202 },
    );
  }

  const label = title || url || "Pasted note";
  const job = enqueue("capture", label, () => runCapture({ projectId, url, notes, title }));
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
