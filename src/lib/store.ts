"use client";

import { create } from "zustand";
import type { CenterMode } from "./types";

/** Client-only UI state for the workspace. Server state lives in TanStack Query. */
interface WorkspaceState {
  activeProjectId: string | null;
  activeSourceId: string | null;
  /** Selected chat thread in the chat-centric layout. Null = new-chat hero. */
  activeChatId: string | null;
  /** What the Preview modal shows: a saved doc, or a raw source snapshot. Null = closed. */
  preview: { kind: "doc"; path: string } | { kind: "snapshot"; sourceId: string } | null;
  centerMode: CenterMode;
  modelId: string;
  setActiveProject: (id: string | null) => void;
  setActiveSource: (id: string | null) => void;
  setActiveChat: (id: string | null) => void;
  previewDoc: (path: string) => void;
  previewSnapshot: (sourceId: string) => void;
  closePreview: () => void;
  setCenterMode: (mode: CenterMode) => void;
  setModel: (id: string) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  activeProjectId: null,
  activeSourceId: null,
  activeChatId: null,
  preview: null,
  centerMode: "learn",
  modelId: "claude:sonnet",
  // Switching project clears source, chat, and preview.
  setActiveProject: (id) => set({ activeProjectId: id, activeSourceId: null, activeChatId: null, preview: null }),
  setActiveSource: (id) => set({ activeSourceId: id }),
  setActiveChat: (id) => set({ activeChatId: id }),
  // Preview now opens as a modal over the current tab — it no longer switches centerMode.
  previewDoc: (path) => set({ preview: { kind: "doc", path } }),
  previewSnapshot: (sourceId) => set({ preview: { kind: "snapshot", sourceId } }),
  closePreview: () => set({ preview: null }),
  setCenterMode: (mode) => set({ centerMode: mode }),
  setModel: (id) => set({ modelId: id }),
}));
