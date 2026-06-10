"use client";

import { Target } from "lucide-react";
import { useWorkspace } from "@/lib/store";
import { useProjects, useModelUsagePolicy } from "@/lib/api";
import { QueueStatus } from "./queue-status";
import { ModelPicker } from "./model-picker";
import type { CenterMode } from "@/lib/types";

const TITLES: Record<CenterMode, { title: string; subtitle: string }> = {
  learn: { title: "Capture", subtitle: "Add videos, channels, articles, PDFs and notes" },
  analyze: { title: "Learn", subtitle: "Turn each source into goal-relevant knowledge" },
  ask: { title: "Ask", subtitle: "Query your knowledge base with scoped retrieval" },
  projects: { title: "Projects", subtitle: "All your projects and their settings" },
  "global-settings": { title: "Global settings", subtitle: "API keys and local CLI status" },
};

export function Topbar() {
  const { activeProjectId, centerMode } = useWorkspace();
  const { data: projects } = useProjects();
  const modelUsagePolicy = useModelUsagePolicy(activeProjectId);

  const project = projects?.find((p) => p.id === activeProjectId);
  const meta = TITLES[centerMode];
  const showModel = centerMode === "analyze" || centerMode === "ask";

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-card px-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight">{meta.title}</h1>
        {project?.goal ? (
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground" title={project.goal}>
            <Target className="size-3 shrink-0" />
            <span className="truncate">{project.goal}</span>
          </p>
        ) : (
          <p className="truncate text-xs text-muted-foreground">{meta.subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <QueueStatus />
        {showModel && <ModelPicker policy={modelUsagePolicy} />}
      </div>
    </header>
  );
}
