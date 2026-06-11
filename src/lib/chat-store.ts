"use client";

/**
 * Chat store — localStorage-backed, per-project multi-turn conversations.
 *
 * A Chat is a thread of request→answer turns over the project's knowledge base.
 * A ChatTurn is exactly the shape Ask already produces (an `AskEntry`): one
 * request, its streamed answer, the retrieved context, and the run metadata.
 *
 * Persistence mirrors ask-panel's history: one localStorage key per project
 * (`pf.chats.<projectId>`), SSR-guarded reads/writes. Markdown (`learning/`)
 * remains the durable truth; this is disposable UI history, like askHistory.
 *
 * No React here — pure functions. The active chat id lives in Zustand
 * (`src/lib/store.ts`). UI loads via the set-state-during-render guard pattern
 * (see ask-panel.tsx). Step 1 keeps this isolated — no component imports it yet.
 */
import type { RetrievedItem, GenerateOutputType } from "./api";

/** One request→answer pair plus its retrieval evidence. Same shape as AskEntry. */
export type ChatTurn = {
  id: string;
  request: string;
  answer: string;
  retrieved: RetrievedItem[];
  used: { id: string; title: string }[];
  mode: string;
  retrievalRunId: string;
  outputType: GenerateOutputType;
  modelId: string;
  createdAt: string;
};

export type Chat = {
  id: string;
  projectId: string;
  /** Derived from the first request (sliced); renameable later. */
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
};

const CHATS_MAX = 100;
const TITLE_MAX = 60;
const chatsKey = (projectId: string) => `pf.chats.${projectId}`;

function titleFromRequest(request: string): string {
  const t = request.trim().replace(/\s+/g, " ");
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX)}…` : t || "New chat";
}

function readAll(projectId: string | null): Chat[] {
  if (!projectId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(chatsKey(projectId));
    return raw ? (JSON.parse(raw) as Chat[]) : [];
  } catch {
    return [];
  }
}

function writeAll(projectId: string, chats: Chat[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(chatsKey(projectId), JSON.stringify(chats.slice(0, CHATS_MAX)));
  } catch {
    /* quota — ignore */
  }
}

/** Chats for a project, most-recently-updated first. */
export function listChats(projectId: string | null): Chat[] {
  return readAll(projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getChat(projectId: string | null, chatId: string): Chat | null {
  return readAll(projectId).find((c) => c.id === chatId) ?? null;
}

/** Create a chat seeded with its first turn. Returns the new chat. */
export function createChat(projectId: string, firstTurn: ChatTurn): Chat {
  const now = firstTurn.createdAt;
  const chat: Chat = {
    id: `chat-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    projectId,
    title: titleFromRequest(firstTurn.request),
    createdAt: now,
    updatedAt: now,
    turns: [firstTurn],
  };
  writeAll(projectId, [chat, ...readAll(projectId)]);
  return chat;
}

/** Append a turn to an existing chat. Returns the updated chat (or null if gone). */
export function appendTurn(projectId: string, chatId: string, turn: ChatTurn): Chat | null {
  const chats = readAll(projectId);
  const i = chats.findIndex((c) => c.id === chatId);
  if (i < 0) return null;
  const updated: Chat = {
    ...chats[i],
    turns: [...chats[i].turns, turn],
    updatedAt: turn.createdAt,
  };
  chats[i] = updated;
  writeAll(projectId, chats);
  return updated;
}

export function renameChat(projectId: string, chatId: string, title: string): void {
  const chats = readAll(projectId);
  const i = chats.findIndex((c) => c.id === chatId);
  if (i < 0) return;
  chats[i] = { ...chats[i], title: title.trim() || chats[i].title };
  writeAll(projectId, chats);
}

export function deleteChat(projectId: string, chatId: string): void {
  writeAll(projectId, readAll(projectId).filter((c) => c.id !== chatId));
}
