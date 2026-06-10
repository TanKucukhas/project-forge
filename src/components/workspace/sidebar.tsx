"use client";

import {
  Download,
  Sparkles,
  MessageCircleQuestion,
  Hammer,
  Settings,
  FolderKanban,
  ChevronsUpDown,
} from "lucide-react";
import { useWorkspace } from "@/lib/store";
import { useProjects } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CenterMode } from "@/lib/types";

const NAV: { mode: CenterMode; label: string; hint: string; icon: typeof Download }[] = [
  { mode: "learn", label: "Capture", hint: "Add sources", icon: Download },
  { mode: "analyze", label: "Learn", hint: "Goal-aware summaries", icon: Sparkles },
  { mode: "ask", label: "Ask", hint: "Query the knowledge base", icon: MessageCircleQuestion },
];

export function Sidebar() {
  const { activeProjectId, centerMode, setCenterMode } = useWorkspace();
  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.id === activeProjectId);

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r bg-card">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground">
          <Hammer className="size-4 text-background" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">ProjectForge</p>
          <p className="truncate text-[11px] text-muted-foreground">Knowledge compiler</p>
        </div>
      </div>

      {/* Project switcher → opens the Projects hub */}
      <div className="p-3">
        <button
          onClick={() => setCenterMode("projects")}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:bg-muted",
            centerMode === "projects" && "border-primary/40 ring-1 ring-primary/20",
          )}
          title="All projects"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Project</p>
            <p className="truncate text-sm font-medium">{project?.title ?? "Select a project"}</p>
          </div>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>

      {/* Primary navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Workspace
        </p>
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = centerMode === item.mode;
          return (
            <button
              key={item.mode}
              onClick={() => setCenterMode(item.mode)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                active
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-[18px] shrink-0" />
              <span className="flex-1">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer: projects + settings + version */}
      <div className="space-y-1 border-t p-3">
        <button
          onClick={() => setCenterMode("projects")}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
            centerMode === "projects"
              ? "bg-primary/10 font-medium text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <FolderKanban className="size-[18px] shrink-0" />
          <span className="flex-1">Projects</span>
        </button>
        <button
          onClick={() => setCenterMode("global-settings")}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
            centerMode === "global-settings"
              ? "bg-primary/10 font-medium text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Settings className="size-[18px] shrink-0" />
          <span className="flex-1">Global settings</span>
        </button>
        <p className="px-3 pt-1 text-[11px] text-muted-foreground/70">ProjectForge v1</p>
      </div>
    </aside>
  );
}
