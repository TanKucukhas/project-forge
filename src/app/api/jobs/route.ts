import { NextRequest, NextResponse } from "next/server";
import { getJob, listJobs } from "@/lib/queue/queue";

export const runtime = "nodejs";

/** GET /api/jobs        → recent jobs (queue panel)
 *  GET /api/jobs?id=xyz  → a single job (polling) */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json({ job });
  }
  return NextResponse.json({ jobs: listJobs() });
}
