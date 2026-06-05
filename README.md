# ProjectForge

**A local AI research compiler for founders and developers.**

ProjectForge turns YouTube videos, articles, docs, websites, Markdown files, and notes
into a private, searchable knowledge base — then generates build-ready outputs that AI
coding agents (Claude, Codex, Cursor) can act on: project briefs, startup ideas, game
concepts, side-project plans, PRDs, technical specs, and agent build prompts.

It is **local-first**: your sources, notes, and outputs live on your machine as Markdown
plus a local SQLite index. No cloud lock-in. You own the attic *and* the workshop.

## The three modes

1. **Learn** — Drop in a source → get a structured learning doc + a saved source snapshot.
2. **Ask** — Query across your saved notebooks; answers cite the underlying sources.
3. **Create** — Turn the knowledge base into buildable outputs (concepts, specs, agent prompts).

## The flow

```
Notebook → Add Sources → Extract & Save Snapshot → Learning Doc
        → Index (SQLite + FTS5) → Ask (retrieval + model) → Generate Outputs
        → Export to Claude / Codex / Cursor (Markdown)
```

## Stack (locked)

Next.js (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Zustand · TanStack Query ·
React Hook Form · Zod · SQLite (better-sqlite3) · Drizzle ORM · SQLite FTS5 ·
react-markdown · gray-matter · pluggable model adapters (Claude CLI, Codex CLI, OpenAI, Gemini).

No vector DB yet — keyword/FTS5 first; embeddings only when FTS5 demonstrably falls short.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full decision record.
