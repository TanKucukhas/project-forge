import { NextRequest, NextResponse } from "next/server";
import { enqueue } from "@/lib/queue/queue";
import { ensureQueueReady } from "@/lib/queue/handlers";
import { runCapturePdf } from "@/lib/queue/jobs";
import { getProject } from "@/lib/db/queries";

// PDF upload touches the filesystem and parses the file — Node only.
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart PDF upload." }, { status: 400 });
  }

  const projectId = String(form.get("projectId") ?? "");
  const title = (form.get("title") as string | null)?.trim() || undefined;
  const file = form.get("file");

  if (!projectId || !getProject(projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 404 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No PDF file provided." }, { status: 400 });
  }
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return NextResponse.json({ error: "Only PDF files are supported." }, { status: 415 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The PDF is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "PDF is too large (max 25 MB)." }, { status: 413 });
  }

  ensureQueueReady();
  const data = new Uint8Array(await file.arrayBuffer());
  const job = enqueue("capture", title || file.name, () =>
    runCapturePdf({ projectId, filename: file.name, title, data }),
  );
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
