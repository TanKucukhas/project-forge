<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ProjectForge

Guidance for AI agents working in this repo. (`CLAUDE.md` imports this file.)

## What this is
ProjectForge is a **local-first knowledge-to-project compiler** for founders/developers.
A **Project has a goal**; sources (YouTube video/channel, articles, websites, Markdown, notes) →
raw snapshots → goal-aware **distilled** knowledge (with category, tags, relevance) → searchable
local knowledge base → scoped **Ask** → build-ready outputs for AI coding agents. See
`docs/ARCHITECTURE.md` — it is the **locked** decision record (v1). Do not relitigate the flow,
UI structure, or stack without explicit user sign-off.

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Zustand ·
TanStack Query · React Hook Form · Zod · SQLite (better-sqlite3) · Drizzle ORM · SQLite FTS5 ·
react-markdown · gray-matter · `youtube-transcript` (+ watch-page scrape) · **yt-dlp** (channel
ingestion) · in-process job queue · pluggable model adapters (Claude/Codex CLI, OpenAI, Gemini).

## Hard rules
- **A project has a goal.** It is the steering context for distill, relevance, and outputs —
  adding sources without a project+goal is not a supported flow.
- **Save raw source snapshots** (`.json` + `.txt`) before any model runs. **Distill never destroys
  raw text** — different prompts can be re-run over the same raw source.
- **Enforce frontmatter in code** when saving Markdown — never rely on the model emitting valid YAML.
- **Distill is a manual, explicit step.** Never auto-spend model calls (esp. paid APIs) on capture.
- **Credibility (views+likes) is one signal, shown transparently — not truth.**
- **FTS5 before any vector DB.** No embeddings/LanceDB/sqlite-vec until FTS5 demonstrably fails.
- Markdown library (`learning/`) is the durable source of truth; SQLite (`data/`) is a rebuildable index.
- Local CLIs/binaries (Claude, Codex, yt-dlp) are spawned server-side, **localhost-gated**, with
  validated arguments — no shell interpolation of user input.
- Never commit user data (`learning/`, `data/*.sqlite`) — already in `.gitignore`.

## Data layout
- `learning/projects/<id>/{project.json,sources/,notes/,outputs/,index/}` — Markdown library.
  `sources/` holds `source-<id>.json` + `source-<id>.txt`; `notes/` holds distilled docs.
- `data/projectforge.sqlite` — tables: projects, sources, source_chunks, learning_docs, outputs,
  output_sources, categories, tags, source_tags, + `source_chunks_fts` (FTS5).

## Build order
Phase 0 scaffold → Phase 1 Capture & Learn → Phase 2 Knowledge Base → Phase 3 Create →
Phase 4 ingestion depth (original). **v1 (built):** A Projects & goals → B Distill + scoring →
C Channel ingestion (yt-dlp) → D Scoped Ask. See ARCHITECTURE.md §7.
