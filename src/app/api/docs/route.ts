import { NextRequest, NextResponse } from "next/server";
import { readLibraryFile } from "@/lib/library/store";

export const runtime = "nodejs";

/** GET /api/docs?path=learning/notebooks/.../notes/x.md → raw markdown for preview.
 *  Path is constrained to the learning/ library so it can't read arbitrary files. */
export async function GET(request: NextRequest) {
  const rel = request.nextUrl.searchParams.get("path") ?? "";
  const normalized = rel.replace(/\\/g, "/");
  if (
    !normalized.startsWith("learning/") ||
    normalized.includes("..") ||
    !normalized.endsWith(".md")
  ) {
    return NextResponse.json({ error: "Invalid document path." }, { status: 400 });
  }
  try {
    return NextResponse.json({ markdown: await readLibraryFile(normalized) });
  } catch {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
}
