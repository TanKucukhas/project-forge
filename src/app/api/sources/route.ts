import { NextRequest, NextResponse } from "next/server";
import { listSources, listDocs, listCategories, getProject } from "@/lib/db/queries";
import { parseSettings, LEARN_SCHEMA_VERSION } from "@/lib/settings";
import { computeDistillHashes, computeTaxonomyHash } from "@/lib/distill/versioning";

export const runtime = "nodejs";

/** GET /api/sources?projectId=… → sources, distilled docs, categories, and the
 *  CURRENT distill hashes. The UI compares each doc/source's stored hashes to
 *  these to flag stale docs — no crypto on the client, just a string compare. */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
  const project = getProject(projectId);
  if (!projectId || !project) {
    return NextResponse.json({ error: "Unknown project." }, { status: 404 });
  }
  const settings = parseSettings(project.settings);
  const { instructionHash, goalHash } = computeDistillHashes(project.goal, settings.learnInstructions);
  const taxonomyHash = computeTaxonomyHash(settings.taxonomy);
  return NextResponse.json({
    projectId,
    sources: listSources(projectId),
    docs: listDocs(projectId),
    categories: listCategories(projectId),
    current: { instructionHash, goalHash, taxonomyHash, learnSchemaVersion: LEARN_SCHEMA_VERSION },
  });
}
