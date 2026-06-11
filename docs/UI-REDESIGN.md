# UI Redesign — Chat-centric ProjectForge (full plan + handoff)

Read this first after `/clear`. It is the locked plan for restructuring the UI
into a chat-centric app (ChatGPT / Claude / Gemini style) on top of the existing
knowledge pipeline. The pipeline (retrieval, queue, distill, taxonomy, model
adapters) is UNCHANGED — this is a presentation + multi-turn conversation layer.

---

## 0. Current codebase state (so you don't re-explore)

Stack: Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn/ui · Zustand
(`src/lib/store.ts`) · TanStack Query (`src/lib/api.ts`) · SQLite + Drizzle ·
FTS5. Dev: `pnpm dev` → localhost:3085. Always run `pnpm typecheck && pnpm lint`
(and `pnpm build` at the end). `pnpm db:init` if DDL changes.

Key UI files:
- `src/components/workspace/workspace.tsx` — gates on project (no project →
  `ProjectSetup`); otherwise renders Sidebar + Topbar + CenterPanel.
- `src/components/workspace/sidebar.tsx` — left icon nav (Capture/Learn/Ask/…).
- `src/components/workspace/topbar.tsx` — project name + goal + `ModelPicker`.
- `src/components/workspace/center-panel.tsx` — BIG file: Capture/Learn/Ask tabs,
  `renderSourceRow`, `AttentionSummary`, `StaleBadge`, learned-docs list, preview
  modal. Tabs driven by `centerMode` (Zustand).
- `src/components/workspace/ask-panel.tsx` — the Ask "command center": output-type
  pills, composer, advanced filters, retrieved-context evidence, **per-project
  history persisted to localStorage** (`pf.askHistory.<projectId>`, type
  `AskEntry[]`), **streaming** via `POST /api/ask/stream`.
- `projects-page.tsx`, `project-settings.tsx`, `knowledge-taxonomy.tsx`,
  `learned-doc-view.tsx`, `model-picker.tsx`, `queue-status.tsx`.

`centerMode` values (in `src/lib/types.ts` + store): `"learn"` (= Capture page),
`"analyze"` (= Learn/distill page), `"ask"`, `"projects"`, `"global-settings"`.

Server/retrieval (DO NOT rewrite — reuse):
- `src/lib/ask.ts` — `retrieveContext({projectId, question, scope, modeOverride})`
  returns `{mode, context, used, retrieved, logItems, ...}`. `runAsk` = retrieve →
  prompt → model. Scope: `{mode: auto|summaries|full|hybrid, category, categories,
  tags, authors, games, sourceIds, uses}` + inline `@author #tag game: use:` via
  `parseMentions`.
- `POST /api/ask/stream` — NDJSON stream `{type:"meta",retrieved,used,mode,...}`,
  `{type:"delta",text}`, `{type:"done",retrievalRunId,markdownPath}`. Handles
  `outputType` "answer" (Ask prompt) vs structured (buildGeneratePrompt → saves to
  outputs/). Body: `{projectId, question, modelId, scope, outputType}`.
- `POST /api/generate/output`, `src/lib/generate/run.ts#runGenerate`.
- `POST /api/ask/preview` (dry-run retrieval, no model).
- `useSources`, `useGraph` (authors/entities/tags), `useJobs`/`useJobStats`,
  `usePreviewContext`, `useGenerateOutput`, `useSaveOutput`, `useAblation`.

`AskEntry` (ask-panel.tsx, persisted) — the seed for chat turns:
```ts
type AskEntry = { id; request; answer; retrieved: RetrievedItem[];
  used: {id;title}[]; mode; retrievalRunId; outputType; modelId; createdAt };
```

---

## 1. Target layout

```
┌───────────────────┬──────────────────────────────────────────┐
│ Project name ▾    │   ✦ What do you want from this KB?        │  ← new-chat hero
│ + New chat        │   ┌──────────────────────────────────┐    │
│                   │   │ composer (output-type + textarea) │    │
│ <chat 1>          │   └──────────────────────────────────┘    │
│ <chat 2>          │   [Ask][Game Concept][GDD][Agent Prompt]   │
│ <chat 3>  …       │                                            │
│                   │   chat selected → THREAD (Q1→A1, Q2→A2…,   │
│ ── Learn          │   continue at bottom) + per-answer         │
│ Settings          │   Retrieved Context (evidence)             │
└───────────────────┴──────────────────────────────────────────┘
```

- **Project name** top-left corner → menu: **Dashboard · switch project ·
  + New project** (project-creation flow moves here).
- **+ New chat**, then **chats listed DIRECTLY** (no "Recents" header; expanded
  like ChatGPT/Claude). Project-scoped.
- **Learn** = ONE button merging Capture + Learn (inner sub-tabs: Capture · To
  learn · Learned · All).
- **Settings** (global) at the bottom.

---

## 2. Chat = multi-turn conversation (the core change)

Today Ask is 1 question → 1 answer. New: a chat is a **thread** you continue.

Data model (new chat store — start in localStorage, key `pf.chats.<projectId>`):
```ts
type ChatTurn = AskEntry;              // one request→answer pair (+retrieved)
type Chat = {
  id: string;
  projectId: string;
  title: string;                       // from first request (slice) or model-named
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
};
```
- New chat → hero composer; first submit creates a `Chat` + first turn.
- Selecting a chat → render the thread; composer pinned at the bottom to continue.
- **Multi-turn grounding:** each new turn sends the prior turns as conversation
  history PLUS fresh retrieval. Extend `POST /api/ask/stream` body with
  `history?: {request:string; answer:string}[]`; in the route, prepend a
  `CONVERSATION SO FAR:` block before `CONTEXT:` (keep it bounded — last ~6 turns,
  truncate long answers). Retrieval still runs per turn on the latest question.
- Output type is per-turn (Answer / Game Concept / GDD / …).

Reuse: ask-panel's streaming `run()` logic, retrieved-context cards, model picker,
confirmPaid. The localStorage `AskEntry[]` history becomes `Chat[]` (migration:
wrap existing entries each as a 1-turn chat, or ignore/drop — low stakes).

---

## 3. Project Dashboard (opened from the project-name corner)
- Learning status: # captured / # learned / % done, recent activity (from
  `useSources`: sources by status; learned = status "distilled").
- Main topics: top categories/tags (from `useSources` categories + `useGraph`
  tags, or learned-doc metadata).
- Project settings embedded: goal, taxonomy (`KnowledgeTaxonomy`), model usage,
  transcript language (reuse `ProjectSettings` + `KnowledgeTaxonomy`).
- Switch project / new project (reuse `projects-page.tsx` flow).

---

## 4. Image (deferred placeholder)
"Create image" for concept art — two methods LATER: (1) manual paste/upload to
`learning/projects/<id>/assets/`, (2) API key generation. Gemini CLI image-gen was
tested → 404 (model not found), so NOT viable. UI skeleton only for now; not in the
first build passes.

---

## 5. Build order (incremental — each pass: typecheck+lint, keep it shippable)

**STATUS (2026-06-11): Steps 1–5 implemented** (chat store, chat-centric sidebar
with project-corner menu, multi-turn chat center with `history` wired into
`/api/ask/stream`, Learn merge via Capture/Learn sub-toggle, project Dashboard).
typecheck/lint/build clean. Remaining: §4 Image (deferred), polish (chat
rename, advanced scope filters in chat, model-named titles), and removing the
now-unmounted `ask-panel.tsx` once its exported helpers are relocated.

**Step 1: Chat data model + store.**
- New `src/lib/chat-store.ts` (or extend store): localStorage-backed, per project.
  `Chat` / `ChatTurn` types (§2), CRUD: `listChats(projectId)`, `getChat(id)`,
  `createChat(projectId, firstTurn)`, `appendTurn(chatId, turn)`, `renameChat`,
  `deleteChat`. SSR-safe (guard `typeof window`), set-during-render load pattern
  (see `ask-panel.tsx` history load / `learn-instructions.tsx` for the lint-clean
  guarded pattern). Active chat id in Zustand store.
- Keep it isolated; no UI change yet. typecheck/lint.

Step 2: **Left sidebar** → `+ New chat` + chats listed directly + `Learn` (single)
+ `Settings`. Project-name corner menu (Dashboard/switch/new). Replace icon-only
sidebar.

Step 3: **Center chat** → new-chat hero (reuse ask-panel composer) creates chat +
streams first turn; selecting a chat shows the thread with a bottom composer to
continue; wire multi-turn history into `/api/ask/stream`.

Step 4: **Learn merge** → one "Learn" screen with Capture + the analyze sub-tabs
(To learn / Learned / All). Mostly relocating existing center-panel sections.

Step 5: **Project corner + Dashboard** → project-name menu, switch/new flow,
dashboard (learning stats + main topics + embedded settings).

---

## 6. Touch / don't touch
- Change: `workspace.tsx`, `sidebar.tsx`, `topbar.tsx`, `center-panel.tsx`,
  `ask-panel.tsx`, `store.ts`, new chat store; `/api/ask/stream` gains `history`.
- DON'T touch: `ask.ts` retrieval, queue/distill (`queue.ts`, `jobs.ts`),
  taxonomy, model adapters (`lib/ai/*`). Reuse them as-is.

## 7. Constraints (unchanged project rules)
Markdown (`learning/`) is truth, SQLite rebuildable index. Capture is model-free.
Distill manual. Local CLIs localhost-gated. Never commit `learning/` or
`data/*.sqlite` (+ `data/queue.json`). `provider:model` ids. Single commit straight
to `main` per the user's workflow; push only when asked.
