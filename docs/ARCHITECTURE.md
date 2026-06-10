# ProjectForge — Architecture Decision Record

Status: **Locked** (v1). Date: 2026-06-06. (v0: 2026-06-05.)

This document is the single source of truth for the product flow, UI structure, and tech
stack. It exists so we stop relitigating settled choices and start building.

**v1 change (owner sign-off 2026-06-06):** introduced **Projects with goals** as the top-level
entity, a goal-aware **Distill** stage, **relevance + credibility scoring**, first-class
**categories/tags**, **YouTube channel ingestion** (yt-dlp), and **scoped Ask**. These revise the
flow (§2), UI (§3), and data model (§5). Superseded v0 text is kept where useful and marked.

---

## 1. Product thesis

ProjectForge is a **knowledge-to-project compiler**, not a learning app.

A learning note is the *intermediate* artifact. The *final* output is **buildable project
intelligence**: concepts, specs, and agent-ready build prompts. The user's goal is leverage —
consume messy sources, extract patterns, and emit something an AI coding agent can build.

Optimize for: fast ingestion · clean learning docs · searchable local memory · ask-anything
Q&A · project/spec generation · one-click Markdown export.

---

## 2. The flow (locked v1)

A **Project** is the top-level container. You create it and write its **goal** first — the goal
is the steering context that shapes distillation, relevance scoring, and outputs. (Example goal:
*"Learn what makes great indie game design so we can produce the best game-design documents and
know what & how to build."*)

```
PROJECT  (goal + settings)                 ← create + set goal BEFORE adding anything
  → Add Sources
       • YouTube video
       • YouTube channel        (channel name/URL → every video, via yt-dlp)
       • article / website / pasted .txt / notes
  → Extract + SAVE RAW SNAPSHOT            (raw plain text persisted: source-<id>.json + .txt)
  → Capture free metadata                  (YT: title, channel, thumbnail, duration, views,
                                            likes, keywords, description)
  → Score credibility                      (views + like-ratio heuristic — one signal, not truth)
  → DISTILL ("minimize") — MANUAL step      ← goal-aware compression
       • prompt is built FROM the project goal
       • model reduces the full raw text to only the parts useful for the goal
       • emits: compact learning summary + category + tags + relevance score (+ rationale)
       • raw text is NEVER discarded
  → Index into SQLite + FTS5               (raw chunks + distilled summary)
  → ASK the Knowledge Base (scoped)        ← choose what you spend tokens on
       • hand-picked summaries · single source · multiple · whole category
       • retrieve within scope → model → cited answer
  → Generate Project Outputs
  → Export to Claude / Codex / Cursor (Markdown)
```

### Three modes
- **Learn** — knowledge intake engine. Source in → raw snapshot + (on demand) a goal-aware
  distilled summary with category, tags, relevance, and credibility.
- **Ask** — talk to the local DB. **Scoped** retrieval-backed answers (summaries by default to
  save credits; or single/multiple sources; or by category) with source references,
  contradictions, and gaps.
- **Create** — the payoff. Knowledge base → buildable outputs.

### Distill vs. Analyze
"Analyze" (v0) produced one full learning doc per source. v1 splits intake into **raw capture**
(always, free) and a **manual goal-aware Distill** that yields a *compact* artifact plus the
metadata (category, tags, relevance) that powers scoped Ask. Distill is manual so model spend
(especially paid API providers) is always an explicit choice. The full raw transcript is kept.

---

## 3. UI structure (locked): 3-panel workspace

NotebookLM-style 3-panel layout, one **project** at a time. **First run / "+" creates a project
and captures its goal before any source can be added.**

```
┌──────────────────┬──────────────────────────────┬──────────────────────┐
│ LEFT             │ CENTER                        │ RIGHT                │
│ Project + GOAL   │ Learn / Analyze / Ask / Prev  │ Generate Outputs     │
│ Sources (scroll) │ Capture + queue               │ Game Idea            │
│  · category      │ Distill (goal-aware) + scores │ Startup Brief        │
│  · relevance     │ Scoped Ask (summaries/cat/…)  │ Side Project         │
│  · credibility   │ Raw transcript / doc preview  │ PRD / Tech Spec      │
│ Categories/Tags  │ Markdown preview              │ Claude/Codex Prompt  │
└──────────────────┴──────────────────────────────┴──────────────────────┘
```

- **Left:** project header with editable goal; a **scrollable** sources list showing category +
  relevance/credibility badges; category/tag filters.
- **Center:** capture (incl. channel), per-source **Distill** button (+ bulk distill), scoped
  **Ask**, and preview (raw transcript is the focus; description collapsed).

Top-level nav (cross-project views, not the primary loop):
`Workspace · Sources · Knowledge Base · Generate · Outputs · Settings`

---

## 4. Tech stack (locked)

| Layer | Choice | Why |
|---|---|---|
| App framework | Next.js (App Router) + Route Handlers | Local web app + local API for ingest/synth/save/model exec |
| Language | TypeScript | Source/output schemas demand it |
| UI components | shadcn/ui | Copy-paste admin components, no design-system lock-in |
| Styling | Tailwind CSS v4 | Fast custom admin UI |
| Client state | Zustand | Active project, model, panel selection |
| Server state | TanStack Query | Fetch/refetch/mutations/cache for sources, outputs, gen status |
| Forms | React Hook Form + Zod | Source forms, generator forms, runtime validation |
| Local DB | SQLite (better-sqlite3) | Local-first, synchronous, zero-ops |
| ORM | Drizzle | Typed schema + migrations without enterprise sludge |
| Search | SQLite FTS5 | Keyword retrieval before any vector circus |
| Markdown | react-markdown · gray-matter · remark | Preview + frontmatter |
| Models | Adapter pattern | Claude CLI, Codex CLI, OpenAI, Gemini behind one interface |
| Jobs | Simple in-process queue | No BullMQ/Redis until proven necessary |
| YouTube transcript | `youtube-transcript` + watch-page scrape | Free, no key; transcript + metadata |
| Channel ingestion | **yt-dlp** (local binary) | Robust full-channel video list; spawned server-side like the model CLIs |
| Vectors | LanceDB / sqlite-vec — LATER | Only after FTS5 fails in a real workflow |

Runtime: starts as a local Next.js server on localhost. CLI model calls (Codex/Claude) are
spawned server-side via stdin, gated to localhost. Electron packaging is a later option, not v0.

---

## 5. Data model (v1)

Two layers, both kept in sync. The top-level entity is now a **project** (replaces "notebook").

**Markdown library** (human-readable, portable, the source of truth for content):
```
learning/
  projects/                          (v0: notebooks/ — migrated to projects/)
    <project-id>/
      project.json                   (id, title, goal, settings)
      sources/   source-<id>.json     (snapshot: raw text + metadata)
                 source-<id>.txt       (raw plain text, on its own — durable/portable)
      notes/     <date>-<slug>-<id>.md (distilled summaries / learning docs, frontmatter guaranteed)
      outputs/   game-concepts/ startup-briefs/ product-specs/ technical-specs/ ai-agent-prompts/
      index/     chunks.json
```

**SQLite index** (app behavior: search, filter, scoped retrieval):
```
data/projectforge.sqlite
  projects(id, title, goal, settings, created_at, updated_at)        (v0: notebooks)
  sources(... project_id, channel, view_count, like_count,
          category, relevance, credibility, distilled_path,
          status: pending|processed|distilled|failed)
  source_chunks · learning_docs · outputs · output_sources
  categories · tags · source_tags                                    (first-class taxonomy)
  source_chunks_fts   (FTS5 virtual table)
```

**New/changed columns & tables (v1):**
- `projects.goal` — steering text; `projects.settings` (JSON) — distill prompt overrides, scoring weights.
- `sources.relevance` (0–100, model-judged vs. goal at distill), `sources.credibility`
  (0–100, views + like-ratio heuristic at capture), `sources.category`, `sources.distilled_path`.
- `sources.view_count` / `like_count` / `channel` — free YouTube metadata.
- `categories` + `tags` + `source_tags` — assigned at distill, used to scope Ask.

Markdown is the durable artifact; SQLite is the rebuildable index. If the DB is deleted it can
be reconstructed by re-ingesting the Markdown library. **DDL stays owned by `src/db/ddl.ts`**
(FTS5 + triggers); `schema.ts` mirrors it for typed queries.

---

## 6. Output generators (first-class)

Each generator = source selector + prompt template + model selector + preview + save + copy + export.

- Learning Document · Game Concept · Startup Concept · Side Project
- Product Requirements Document · Technical Architecture
- Claude Build Prompt · Codex Task Plan · Cursor Implementation Plan
- **Master Project Brief** (the flagship 20-section spec that bridges "I watched 12 videos" → "agent, build this")

---

## 7. Build order

**Phase 0 — Scaffold** (skeleton, no features)
- Next.js + TS + Tailwind v4 + shadcn/ui, 3-panel shell, Drizzle + SQLite wired, schema migrated.

**Phase 1 — Capture & Learn (P0)**
- Ingest YouTube / article / website / Markdown / pasted notes.
- **Save source snapshots** (raw text persisted).
- Generate learning doc with **frontmatter guaranteed in code** (never trust the model's YAML).

**Phase 2 — Knowledge Base (P0)**
- Chunk sources → FTS5 index → search → Ask (retrieval → model → cited answer).
- Library becomes editable (open/edit/delete/regenerate), not read-only.

**Phase 3 — Create (P0)**
- Master Project Brief + concept/spec/agent-prompt generators. One-click Markdown export.

**Phase 4 — Ingestion depth (P1)**
- Markdown/PDF upload, transcript fallback, GitHub README, depth-1 crawl.

### v1 build order — **A–D IMPLEMENTED (2026-06-06)**
Phases 1–3 above are built (capture, snapshot, FTS5 index, distill, preview). v1 layered the
Project/goal-centric pipeline on top as working vertical slices, all now shipped:

- **✓ A — Projects & goals.** `notebook → project` (schema + library `learning/projects/<id>/`);
  first-run `ProjectSetup` to create a project and write its goal; goal editable in the left panel.
- **✓ B — Distill (manual) + scoring.** Goal-aware "minimize" → JSON-structured compact summary +
  category + tags + relevance. `like_count` scraped; credibility = views + like-ratio. Status
  ladder `pending → processed → distilled`.
- **✓ C — Channel ingestion (yt-dlp).** Channel name/`@handle`/URL → `yt-dlp --flat-playlist`
  enumerates videos → one capture job per video (the in-process queue serializes them).
- **✓ D — Scoped Ask.** `mode` (distilled summaries · full FTS5 transcripts) × `scope`
  (all · category · source ids); summaries-by-default to minimize token spend.

**Key code:** `src/lib/capture/{youtube,resource-fetch,channel}.ts` · `src/lib/queue/{queue,jobs}.ts`
· `src/lib/library/store.ts` · `src/lib/db/queries.ts` · `src/lib/scoring.ts` · `src/lib/ask.ts` ·
routes under `src/app/api/{projects,capture,jobs,distill,ask,sources,snapshot,docs}/`.

**Not yet built:** output generators (§6) beyond the raw `generate` passthrough; relevance
threshold filtering in summaries-mode Ask; PDF/Markdown upload; depth-1 web crawl.

---

## 8. Non-negotiables

1. **Persist source snapshots** (raw `.json` + `.txt`), not just generated notes — or the
   knowledge base is fake. **Distill never destroys raw text.**
2. **Frontmatter is enforced in code.** Prayer-with-TypeScript is not a save strategy.
3. **FTS5 before embeddings.** Resist the vector-DB-for-everything disease.
4. Markdown stays human-readable and portable. The user owns their data.
5. **A project has a goal.** The goal is the steering context for distillation, relevance, and
   outputs — not decoration. Adding sources without a project+goal is not a supported flow.
6. **Distill is a manual, explicit step.** Never auto-spend model calls (esp. paid APIs) on
   capture. Capture is free; distillation is a deliberate click.
7. **Credibility is one signal, shown transparently — not truth.** Popularity (views/likes)
   correlates weakly with correctness; never present the score as authoritative.
8. **Local CLIs/binaries (Claude, Codex, yt-dlp) are spawned server-side, localhost-gated,
   with validated arguments.** No shell interpolation of user input.
