import { NextRequest, NextResponse } from "next/server";
import { getJob, listJobs, clearJob } from "@/lib/queue/queue";
import { ensureQueueReady } from "@/lib/queue/handlers";

export const runtime = "nodejs";

/** GET /api/jobs        → recent jobs (queue panel)
 *  GET /api/jobs?id=xyz  → a single job (polling) */
export async function GET(request: NextRequest) {
  // Resume any persisted batch left by a previous process on first poll.
  ensureQueueReady();
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json({ job });
  }
  return NextResponse.json({ jobs: listJobs() });
}

/** DELETE /api/jobs?id=xyz → dismiss a finished/errored job from the list. */
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Provide ?id." }, { status: 400 });
  const ok = clearJob(id);
  if (!ok) {
    return NextResponse.json({ error: "Job not found or still running." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
