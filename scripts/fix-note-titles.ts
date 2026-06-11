/**
 * One-time fix: give pasted notes a meaningful title.
 *
 * Notes captured before the distill-title feature kept their generic "Pasted
 * note" placeholder. This derives a concise title from each note's text via the
 * model and updates BOTH the source row and the learned-doc frontmatter title —
 * so it propagates to the scope picker, source lists, and Ask retrieval.
 *
 * Run once (the --conditions flag makes `server-only` a no-op under tsx):
 *   pnpm tsx --conditions=react-server scripts/fix-note-titles.ts
 *   FIX_MODEL=claude:sonnet pnpm tsx --conditions=react-server scripts/fix-note-titles.ts
 *
 * Idempotent enough to re-run; pass FIX_ALL=1 to also re-title notes that
 * already have a non-generic title.
 */
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import matter from "gray-matter";
import { initDb } from "../src/db/client";
import {
  listProjects,
  listSources,
  updateSource,
  listDocsForSource,
  setLearningDocsTitleForSource,
} from "../src/lib/db/queries";
import { runModel } from "../src/lib/ai";

const MODEL = process.env.FIX_MODEL || "claude:sonnet";
const FIX_ALL = process.env.FIX_ALL === "1";

function looksGeneric(title: string): boolean {
  const t = title.trim().toLowerCase();
  return !t || t === "pasted note" || t === "pasted notes" || t === "note" || t.startsWith("note ");
}

async function readSnapshotContent(rawTextPath: string | null): Promise<string> {
  if (!rawTextPath) return "";
  try {
    const snap = JSON.parse(await readFile(path.join(process.cwd(), rawTextPath), "utf8")) as {
      content?: string;
    };
    return snap.content ?? "";
  } catch {
    return "";
  }
}

async function genTitle(content: string): Promise<string> {
  const prompt = `Give a concise, specific title (max ~80 characters) for the following note. Return ONLY the title text — no quotes, no preamble, no markdown.

NOTE:
${content.slice(0, 4000)}`;
  const { output } = await runModel(MODEL, prompt);
  return output
    .trim()
    .split("\n")[0]
    .replace(/^["'`#\s]+|["'`\s]+$/g, "")
    .slice(0, 120)
    .trim();
}

async function updateDocFrontmatter(relPath: string, title: string): Promise<void> {
  const abs = path.join(process.cwd(), relPath);
  try {
    const parsed = matter(await readFile(abs, "utf8"));
    parsed.data.title = title;
    await writeFile(abs, matter.stringify(parsed.content, parsed.data), "utf8");
  } catch (e) {
    console.warn(`    ! couldn't update doc ${relPath}: ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  initDb();
  console.log(`Fixing note titles with model: ${MODEL}${FIX_ALL ? " (re-titling ALL notes)" : ""}\n`);
  let fixed = 0;
  let skipped = 0;

  for (const p of listProjects()) {
    const notes = listSources(p.id).filter((s) => s.type === "note");
    if (!notes.length) continue;
    console.log(`Project "${p.title}" — ${notes.length} note(s)`);

    for (const s of notes) {
      const generic = looksGeneric(s.title);
      try {
        // Pick the target title: generate one only when the source still has a
        // placeholder; otherwise reuse the already-good source title (this lets a
        // re-run repair stale learning_docs rows without spending a model call).
        let title = s.title;
        if (generic || FIX_ALL) {
          const content = await readSnapshotContent(s.rawTextPath);
          if (!content.trim()) {
            console.log(`  - skip (no text): ${s.id}`);
            skipped++;
            continue;
          }
          const gen = await genTitle(content);
          if (gen.length >= 3) title = gen;
        }
        if (title.length < 3) {
          skipped++;
          continue;
        }
        // Apply to the source row, the learning_docs rows (Learned list reads
        // these), and every learned-doc frontmatter on disk.
        updateSource(s.id, { title });
        setLearningDocsTitleForSource(s.id, title);
        for (const d of listDocsForSource(s.id)) await updateDocFrontmatter(d.markdownPath, title);
        console.log(`  ✓ "${s.title}"  →  "${title}"`);
        fixed++;
      } catch (e) {
        console.warn(`  ! failed ${s.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  console.log(`\nDone. Renamed ${fixed}, skipped ${skipped}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
