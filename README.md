# ProjectForge

**A local-first AI research compiler for founders and developers.**

ProjectForge turns YouTube videos (and whole channels), articles, docs, websites, Markdown files,
and notes into a private, searchable knowledge base — then generates build-ready outputs that AI
coding agents (Claude, Codex, Cursor) can act on: project briefs, startup ideas, game concepts,
side-project plans, PRDs, technical specs, and agent build prompts.

It is **local-first**: your sources, notes, and outputs live on your machine as Markdown plus a
local SQLite index. No cloud lock-in. You own the attic *and* the workshop.

## The model: a Project with a goal

Everything hangs off a **Project**, and a project has a **goal** — the steering context that
shapes how sources are distilled, scored, and turned into outputs. You write the goal first
(e.g. *"Learn what makes great indie game design so we can produce the best game-design
documents — what to build and how"*).

## The flow

```
Project (goal)
  → Capture        YouTube video · whole channel · article · website · pasted notes
                   → raw transcript/text saved (.json + .txt) + free metadata
                     (thumbnail, duration, views, likes, keywords, description)
                   → credibility scored (views + like-ratio — one signal, not truth)
  → Distill        goal-aware "minimize": the model keeps only what serves the goal
                   → compact summary + category + tags + relevance score
                   → indexed into SQLite + FTS5 (raw text is never discarded)
  → Ask            scoped Q&A — pick how much to spend:
                   distilled summaries (cheap) or full transcripts (precise),
                   across all sources, a category, or one source
  → Generate       buildable outputs → export to Claude / Codex / Cursor (Markdown)
```

Three modes: **Learn** (capture) · **Distill** (goal-aware analysis with scoring/tagging) ·
**Ask** (scoped retrieval). Capture is free and automatic; **distill is a deliberate, manual
step** so model credits are never spent without your say-so.

## Quick start

```bash
pnpm install
pnpm db:init          # create the local SQLite index
pnpm dev              # http://localhost:3085

# optional — only needed for "capture a whole channel"
brew install yt-dlp
```

Open the app, create a project + goal, then paste a YouTube/channel/article URL (or notes) to
capture. Local model calls use your existing **Claude / Codex CLI** login (no API key); set
`OPENAI_API_KEY` / `GEMINI_API_KEY` only if you pick a cloud model.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Zustand ·
TanStack Query · Zod · SQLite (better-sqlite3) · Drizzle ORM · SQLite FTS5 · react-markdown ·
gray-matter · `youtube-transcript` · yt-dlp (channel ingestion) · pluggable model adapters
(Claude CLI · Codex CLI · OpenAI · Gemini).

No vector DB yet — keyword/FTS5 first; embeddings only when FTS5 demonstrably falls short.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full, locked decision record (v1).
