# UI Redesign — Chat-centric ProjectForge (plan)

Locked target for the next build session. ProjectForge moves from a tabbed
workspace (Capture / Learn / Ask) to a **chat-centric** app like ChatGPT /
Claude / Gemini, on top of the existing knowledge pipeline (retrieval, queue,
distill, taxonomy, model adapters are UNCHANGED — this is a presentation +
conversation layer).

## Layout

```
┌───────────────────┬──────────────────────────────────────────┐
│ Project name ▾    │   ✦ What do you want from this KB?        │  ← new-chat hero
│ + New chat        │   ┌──────────────────────────────────┐    │
│                   │   │ composer (output-type + textarea) │    │
│ <chat 1>          │   └──────────────────────────────────┘    │
│ <chat 2>          │   [Ask][Game Concept][GDD][Agent Prompt]   │
│ <chat 3>          │                                            │
│ …                 │   (chat selected → conversation thread:    │
│                   │    Q1→A1, Q2→A2 … continue at bottom)      │
│ ── Learn          │                                            │
│ Settings          │   per-answer Retrieved Context (evidence)  │
└───────────────────┴──────────────────────────────────────────┘
```

## Left sidebar (chat-centric)
- **Project name** in the top-left corner → menu: **Dashboard · switch project · + New project** (project-creation flow lives here).
- **+ New chat**.
- **Chats listed DIRECTLY** — no "Recents" header/grouping; open/expanded like
  ChatGPT/Claude. Project-scoped.
- **Learn** — a SINGLE button (Capture + Learn merged into one screen, with inner
  sub-tabs: Capture · To learn · Learned · All).
- **Settings** (global).

## A Chat = multi-turn conversation (the key change)
- Today: 1 question → 1 answer, done. New: a chat is a **thread** — ask, get a
  streamed answer, then continue with follow-ups in the same concept.
- Each new turn includes prior turns (conversation history) + fresh retrieval
  (RAG) in the prompt, so the model sees both the conversation and the KB.
- Output type (Answer / Game Concept / GDD / Prototype Spec / Technical Spec /
  Agent Prompt / Evaluate) is a **per-turn type** inside the chat.
- "What do you want from this knowledge base?" hero = start a **new chat**.

## Project Dashboard (new; opened from the project-name corner)
- Learning status: # captured / # learned / % done, recent activity.
- Main topics: top categories/tags from taxonomy + learned docs.
- Project settings: goal, taxonomy, model usage, transcript language.
- Switch project / new project.

## Image (deferred placeholder)
- "Create image" for concept art — two methods later: (1) manual paste/upload to
  `learning/projects/<id>/assets/`, (2) API key generation. Gemini CLI image-gen
  was tested and does NOT work (model 404). UI skeleton only for now.

## Build order (incremental, fresh session)
1. **Chat data model + store** — multi-turn, persistent, project-scoped
   (localStorage first; can move to SQLite `chats`/`chat_turns` later). Repurpose
   the existing Ask localStorage history into chats.
2. **Left sidebar** — New chat + chats listed directly + Learn (single) + Settings.
3. **Center chat** — hero → create chat + first turn (stream); chat → thread +
   continue; multi-turn grounding (prior turns + retrieval each turn).
4. **Learn merge** — Capture + analyze into one "Learn" screen (relocate existing
   components: capture dialog, To learn / Learned / All sub-tabs).
5. **Project corner + Dashboard** — project-name menu, switch/new flow, dashboard
   (learning stats + main topics + settings).

## Touch / don't touch
- Change: `workspace.tsx`, `sidebar.tsx`, `center-panel.tsx`, `ask-panel.tsx`,
  `store.ts`, new chat store; streaming endpoint gains conversation history.
- Don't touch: retrieval (`ask.ts`), queue/distill, taxonomy, model adapters.
