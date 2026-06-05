# CLAUDE.md — ProjectForge

Guidance for Claude Code working in this repo.

## What this is
ProjectForge is a **local-first knowledge-to-project compiler** for founders/developers.
Sources (YouTube, articles, websites, Markdown, notes) → searchable local knowledge base →
build-ready outputs for AI coding agents. See `docs/ARCHITECTURE.md` — it is the **locked**
decision record. Do not relitigate the flow, UI structure, or stack without explicit user sign-off.

## Stack
Next.js (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Zustand · TanStack Query ·
React Hook Form · Zod · SQLite (better-sqlite3) · Drizzle ORM · SQLite FTS5 ·
react-markdown · gray-matter · pluggable model adapters.

## Hard rules
- **Save source snapshots** (raw text) before generating notes — the knowledge base depends on it.
- **Enforce frontmatter in code** when saving Markdown — never rely on the model emitting valid YAML.
- **FTS5 before any vector DB.** No embeddings/LanceDB/sqlite-vec until FTS5 demonstrably fails.
- Markdown library (`learning/`) is the durable source of truth; SQLite (`data/`) is a rebuildable index.
- Model calls to local CLIs (Claude/Codex) are spawned server-side via stdin, gated to localhost.
- Never commit user data (`learning/`, `data/*.sqlite`) — already in `.gitignore`.

## Data layout
- `learning/notebooks/<id>/{notebook.json,sources/,notes/,outputs/,index/}` — Markdown library.
- `data/projectforge.sqlite` — tables: notebooks, sources, source_chunks, learning_docs, outputs,
  tags, output_sources, + `source_chunks_fts` (FTS5).

## Build order
Phase 0 scaffold → Phase 1 Capture & Learn → Phase 2 Knowledge Base → Phase 3 Create →
Phase 4 ingestion depth. See ARCHITECTURE.md §7.
