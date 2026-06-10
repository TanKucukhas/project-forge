import { NextRequest, NextResponse } from "next/server";
import { listSources, listDocs, listCategories, getProject } from "@/lib/db/queries";

export const runtime = "nodejs";

/** GET /api/sources?projectId=… → sources, distilled docs, and categories. */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
  if (!projectId || !getProject(projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 404 });
  }
  return NextResponse.json({
    projectId,
    sources: listSources(projectId),
    docs: listDocs(projectId),
    categories: listCategories(projectId),
  });
}
