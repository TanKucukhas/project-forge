"use client";

import { create } from "zustand";
import type { CenterMode } from "./types";

/** Client-only UI state for the workspace. Server state lives in TanStack Query. */
interface WorkspaceState {
  activeNotebookId: string | null;
  activeSourceId: string | null;
  centerMode: CenterMode;
  modelId: string;
  setActiveNotebook: (id: string | null) => void;
  setActiveSource: (id: string | null) => void;
  setCenterMode: (mode: CenterMode) => void;
  setModel: (id: string) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  activeNotebookId: null,
  activeSourceId: null,
  centerMode: "learn",
  modelId: "claude:sonnet",
  setActiveNotebook: (id) => set({ activeNotebookId: id, activeSourceId: null }),
  setActiveSource: (id) => set({ activeSourceId: id, centerMode: "preview" }),
  setCenterMode: (mode) => set({ centerMode: mode }),
  setModel: (id) => set({ modelId: id }),
}));
