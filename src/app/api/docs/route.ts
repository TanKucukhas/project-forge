import { NextRequest, NextResponse } from "next/server";
import matter from "gray-matter";
import { readLibraryFile } from "@/lib/library/store";

export const runtime = "nodejs";

/** GET /api/docs?path=learning/.../notes/x.md → the doc, split into parsed
 *  frontmatter + body so the modal can render structured metadata cleanly
 *  instead of dumping raw YAML. `markdown` (full file) is kept for compatibility.
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
    const markdown = await readLibraryFile(normalized);
    const parsed = matter(markdown);
    return NextResponse.json({
      markdown,
      frontmatter: parsed.data,
      body: parsed.content.trim(),
    });
  } catch {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
}
