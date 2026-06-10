# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The import above is the **locked decision record** (product thesis, modes, 3-panel UI, stack,
hard rules, data layout, build order). Don't relitigate it. Full detail in `docs/ARCHITECTURE.md`.
The sections below add what AGENTS.md doesn't: concrete commands and implementation-level
architecture discovered from the code.

## Commands

Package manager is **pnpm** (note: `pnpm-workspace.yaml` exists but this is a single-package repo).

```bash
pnpm dev          # Next.js dev server (Turbopack) on localhost:3085
pnpm build        # production build
pnpm start        # serve the production build
pnpm lint         # eslint (flat config, eslint.config.mjs)
pnpm typecheck    # tsc --noEmit
pnpm db:init      # apply DDL to data/projectforge.sqlite via tsx scripts/db-init.ts
pnpm db:generate  # drizzle-kit generate (migrations — see caveat below)
pnpm db:studio    # drizzle-kit studio GUI
```

No test framework is configured yet — there is no `pnpm test`.

**External binary:** channel ingestion shells out to **yt-dlp** (`brew install yt-dlp`, or set
`YTDLP_PATH`). Everything else works without it; channel capture returns a clean "install yt-dlp"
error if it's missing.

**Schema changed in v1** (notebooks→projects + new columns). The index is rebuildable, so after a
pull that changes `ddl.ts`: `rm data/projectforge.sqlite* && pnpm db:init`. `learning/` is the
durable truth.

## The pipeline (v1 — what the code actually does)

`Project (goal)` → `Capture` → `Distill (manual)` → `Ask (scoped)`. Stage by stage:

1. **Capture** — `src/lib/capture/`: `resource-fetch.ts` saves a raw snapshot (YouTube transcript
   via `youtube.ts`, web page text, or pasted notes) + free YouTube metadata (thumbnail, duration,
   views, likes, keywords, description). `channel.ts` expands a channel (yt-dlp) into N videos.
   Credibility is scored at capture (`src/lib/scoring.ts`, views+like-ratio). Runs as queued jobs.
2. **Distill** — `src/lib/queue/jobs.ts#runDistill`: builds a prompt from the **project goal**, runs
   the model, parses a JSON result → compact summary + category + tags + relevance. Saved as a
   distilled doc with enforced frontmatter; updates the source row + taxonomy. Manual, re-runnable.
3. **Ask** — `src/lib/ask.ts`: scoped retrieval. `mode` = `summaries` (cheap, uses distilled docs)
   or `full` (FTS5 over raw chunks); `scope` = all / a category / specific source ids.

The **in-process queue** (`src/lib/queue/queue.ts`) is a single-worker FIFO in a module global
(survives HMR) — capture/distill run as jobs polled via `/api/jobs`. No BullMQ/Redis.

### Service/lib map
- `src/lib/capture/` — youtube, resource-fetch, channel (yt-dlp)
- `src/lib/queue/` — queue (FIFO worker) + jobs (runCapture, runDistill)
- `src/lib/library/store.ts` — `learning/projects/<id>/` writer (snapshots, enforced-frontmatter docs)
- `src/lib/db/queries.ts` — all typed DB ops incl. FTS5 `searchChunks` (raw `sql`)
- `src/lib/ai/` — model adapters (below); `src/lib/scoring.ts` — credibility; `src/lib/ask.ts` — Ask
- `src/lib/api.ts` — client TanStack Query hooks; `src/lib/store.ts` — Zustand UI state

### API routes (`src/app/api/`)
`projects` (GET/POST/PATCH) · `capture` (POST, video/channel/notes) · `jobs` (GET poll) ·
`distill` (POST) · `ask` (POST, synchronous) · `sources` (GET by projectId) ·
`snapshot` (GET raw text by source id) · `docs` (GET markdown, path-constrained to `learning/`) ·
`generate` (POST, raw model passthrough). All are `runtime = "nodejs"`.

## Architecture notes (beyond AGENTS.md)

### Schema is owned by hand-written DDL, not Drizzle migrations
`src/db/ddl.ts` is the **source of truth** for table structure, because drizzle-kit cannot emit
FTS5 virtual tables or the sync triggers. `src/db/schema.ts` only *mirrors* those tables for
type-safe queries. When you change a table: edit `ddl.ts` first, then mirror it in `schema.ts`.
`db:generate` exists but is secondary — don't let it diverge from the DDL.

The DDL is fully idempotent (`CREATE ... IF NOT EXISTS`). `src/db/client.ts` runs it on first
connection (`initDb()`), so the SQLite index is always rebuildable — consistent with the
"Markdown is truth, SQLite is a rebuildable index" rule. `source_chunks_fts` is kept in sync with
`source_chunks` by three triggers (`_ai`/`_ad`/`_au`); never write to the FTS table directly.

### Model adapter layer (`src/lib/ai/`)
One interface, four providers, split by where they run:
- `models.ts` — the registry (`modelOptions`, `getModelOption`, `isLocalProvider`). **No
  `server-only` import** so the client model selector can import it too.
- `local-ai.ts` — `codex` / `claude` run as **local CLIs** spawned via `child_process`, prompt
  piped through stdin, no API key (uses your existing CLI login). `index.ts`/`api.ts` are
  `server-only`.
- `api.ts` — `openai` / `gemini` via plain `fetch` (no SDKs), keyed by env vars.
- `index.ts` — `runModel(modelId, prompt)` routes by provider; re-exports the client-safe bits.

A model id is `provider:model` (e.g. `claude:sonnet`, `codex:gpt-5.5-codex`). Default is
`claude:sonnet`.

### Localhost gating for local CLIs (security boundary)
Local CLI execution must **never** be reachable over the network. Every route that may spawn a
local provider (`generate`, `distill`, `ask`) sets `runtime = "nodejs"` (child_process is
unavailable on Edge) and, for local providers, rejects any request whose `host` header isn't
localhost via `isLocalRequestHost`. CLI model names are validated by `normalizeCliModel` (regex
allowlist) and channel input by `channel.ts`'s URL normalizer — no shell interpolation of user
input. Keep this guard in front of any new local-CLI/binary path.

### Client/server state split
- **Zustand** (`src/lib/store.ts`, `"use client"`) holds UI-only state: `activeProjectId`,
  `activeSourceId`, `preview` (doc or snapshot), `centerMode` (Learn/Distill/Ask/Preview),
  `modelId`. Switching project clears source/preview.
- **TanStack Query** (`src/app/providers.tsx`, hooks in `src/lib/api.ts`) owns all server state.
  Lists poll while jobs are active (and briefly after — see `shouldPoll`). Don't put fetched
  server data in Zustand.

### Layout
`src/app/page.tsx` renders `<Workspace>` (`src/components/workspace/workspace.tsx`), which gates on
project selection: no project → `<ProjectSetup>` (create project + goal); otherwise the 3-panel
grid (`280px_1fr_300px`): `LeftPanel` (project goal + scored sources, scrollable) · `CenterPanel`
(Learn/Distill/Ask/Preview tabs) · `RightPanel` (output generators). shadcn/ui primitives live in
`src/components/ui/`; the shared Markdown renderer is `src/components/markdown.tsx`.

### Env / paths
`.env.example` documents `CODEX_CLI_PATH` / `CLAUDE_CLI_PATH` (fall back to `codex`/`claude` on
PATH) and `OPENAI_API_KEY` / `GEMINI_API_KEY` (only for cloud providers). Also honored:
`YTDLP_PATH` (channel ingestion binary, default `yt-dlp`), `PROJECTFORGE_DB` (SQLite location,
default `./data/projectforge.sqlite`), `PROJECTFORGE_LEARNING` (markdown library root, default
`./learning`). `data/*.sqlite` and `learning/` are gitignored — never commit user data.
