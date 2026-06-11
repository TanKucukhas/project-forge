import { NextRequest, NextResponse } from "next/server";
import { getJob, listJobs, jobStats, clearJob, clearQueued } from "@/lib/queue/queue";
import { ensureQueueReady } from "@/lib/queue/handlers";

export const runtime = "nodejs";

/** GET /api/jobs        → recent jobs (capped) + true totals/ETA in `stats`
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
  return NextResponse.json({ jobs: listJobs(), stats: jobStats() });
}

/** DELETE /api/jobs?id=xyz        → dismiss one finished/errored job
 *  DELETE /api/jobs?scope=queued  → cancel ALL not-yet-started jobs */
export async function DELETE(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.get("scope") === "queued") {
    const cancelled = clearQueued();
    return NextResponse.json({ ok: true, cancelled });
  }
  const id = params.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Provide ?id or ?scope=queued." }, { status: 400 });
  const ok = clearJob(id);
  if (!ok) {
    return NextResponse.json({ error: "Job not found or still running." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
