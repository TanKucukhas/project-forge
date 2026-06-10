import { NextRequest, NextResponse } from "next/server";
import { getProject, listAuthors, listEntities, listTags } from "@/lib/db/queries";

export const runtime = "nodejs";

/** GET /api/graph?projectId=… → authors + entities (games/studios/people) for
 *  the project, used by the Ask filter pickers. */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
  if (!projectId || !getProject(projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 404 });
  }
  const authors = listAuthors(projectId).map((a) => ({
    id: a.id,
    displayName: a.displayName,
    slug: a.slug,
  }));
  const entities = listEntities(projectId).map((e) => ({
    id: e.id,
    type: e.type,
    name: e.name,
    slug: e.slug,
  }));
  const tags = listTags(projectId).map((t) => t.name);
  return NextResponse.json({ authors, entities, tags });
}
