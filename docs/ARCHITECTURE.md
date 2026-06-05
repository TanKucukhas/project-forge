# ProjectForge — Architecture Decision Record

Status: **Locked** (v0). Date: 2026-06-05.

This document is the single source of truth for the product flow, UI structure, and tech
stack. It exists so we stop relitigating settled choices and start building.

---

## 1. Product thesis

ProjectForge is a **knowledge-to-project compiler**, not a learning app.

A learning note is the *intermediate* artifact. The *final* output is **buildable project
intelligence**: concepts, specs, and agent-ready build prompts. The user's goal is leverage —
consume messy sources, extract patterns, and emit something an AI coding agent can build.

Optimize for: fast ingestion · clean learning docs · searchable local memory · ask-anything
Q&A · project/spec generation · one-click Markdown export.

---

## 2. The flow (locked)

```
Notebook / Workspace
  → Add Sources
  → Extract + SAVE SOURCE SNAPSHOT   (raw text persisted, not just the final note)
  → Generate Learning Doc            (structured, guaranteed frontmatter)
  → Index into SQLite + FTS5
  → Ask the Knowledge Base           (retrieve relevant chunks → model → cited answer)
  → Generate Project Outputs
  → Export to Claude / Codex / Cursor (Markdown)
```

### Three modes
- **Learn** — knowledge intake engine. Source in → learning doc + snapshot out.
- **Ask** — talk to the local DB. Retrieval-backed answers with source references,
  contradictions, and gaps.
- **Create** — the payoff. Knowledge base → buildable outputs.

---

## 3. UI structure (locked): 3-panel workspace

Drop the 5-tab model. Use a NotebookLM-style 3-panel layout, one notebook at a time:

```
┌──────────────────┬──────────────────────────────┬──────────────────────┐
│ LEFT             │ CENTER                        │ RIGHT                │
│ Notebooks        │ Ask / Learn / Preview         │ Generate Outputs     │
│ Sources          │ Source summary                │ Game Idea            │
│ Tags             │ Learning document             │ Startup Brief        │
│ Saved outputs    │ Chat with notebook            │ Side Project         │
│                  │ Markdown preview              │ PRD / Tech Spec      │
│                  │                               │ Claude/Codex Prompt  │
└──────────────────┴──────────────────────────────┴──────────────────────┘
```

Top-level nav (for cross-notebook views, not the primary loop):
`Workspace · Sources · Knowledge Base · Generate · Outputs · Settings`

---

## 4. Tech stack (locked)

| Layer | Choice | Why |
|---|---|---|
| App framework | Next.js (App Router) + Route Handlers | Local web app + local API for ingest/synth/save/model exec |
| Language | TypeScript | Source/output schemas demand it |
| UI components | shadcn/ui | Copy-paste admin components, no design-system lock-in |
| Styling | Tailwind CSS v4 | Fast custom admin UI |
| Client state | Zustand | Active notebook, model, panel selection |
| Server state | TanStack Query | Fetch/refetch/mutations/cache for sources, outputs, gen status |
| Forms | React Hook Form + Zod | Source forms, generator forms, runtime validation |
| Local DB | SQLite (better-sqlite3) | Local-first, synchronous, zero-ops |
| ORM | Drizzle | Typed schema + migrations without enterprise sludge |
| Search | SQLite FTS5 | Keyword retrieval before any vector circus |
| Markdown | react-markdown · gray-matter · remark | Preview + frontmatter |
| Models | Adapter pattern | Claude CLI, Codex CLI, OpenAI, Gemini behind one interface |
| Jobs | Simple in-process queue | No BullMQ/Redis until proven necessary |
| Vectors | LanceDB / sqlite-vec — LATER | Only after FTS5 fails in a real workflow |

Runtime: starts as a local Next.js server on localhost. CLI model calls (Codex/Claude) are
spawned server-side via stdin, gated to localhost. Electron packaging is a later option, not v0.

---

## 5. Data model

Two layers, both kept in sync:

**Markdown library** (human-readable, portable, the source of truth for content):
```
learning/
  notebooks/
    <notebook-id>/
      notebook.json
      sources/   source-001.json   (snapshot: raw text + metadata)
      notes/     2026-06-05-*.md    (learning docs, frontmatter guaranteed)
      outputs/   game-concepts/ startup-briefs/ product-specs/ technical-specs/ ai-agent-prompts/
      index/     chunks.json
```

**SQLite index** (app behavior: search, filter, retrieval):
```
data/projectforge.sqlite
  notebooks · sources · source_chunks · learning_docs · outputs · tags · output_sources
  source_chunks_fts   (FTS5 virtual table)
```

Markdown is the durable artifact; SQLite is the rebuildable index. If the DB is deleted it can
be reconstructed by re-ingesting the Markdown library.

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
- Markdown/PDF upload, YouTube playlist/bulk, transcript fallback (yt-dlp), GitHub README, depth-1 crawl.

---

## 8. Non-negotiables

1. **Persist source snapshots**, not just generated notes — or the knowledge base is fake.
2. **Frontmatter is enforced in code.** Prayer-with-TypeScript is not a save strategy.
3. **FTS5 before embeddings.** Resist the vector-DB-for-everything disease.
4. Markdown stays human-readable and portable. The user owns their data.
