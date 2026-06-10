"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useProjects } from "@/lib/api";
import { useWorkspace } from "@/lib/store";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CenterPanel } from "./center-panel";
import { ProjectsPage } from "./projects-page";

export function Workspace() {
  const { data: projects, isLoading } = useProjects();
  const activeProjectId = useWorkspace((s) => s.activeProjectId);
  const setActiveProject = useWorkspace((s) => s.setActiveProject);

  // Auto-select the most recent project so returning users land in their workspace.
  const validActive = projects?.some((p) => p.id === activeProjectId) ? activeProjectId : null;
  useEffect(() => {
    if (!validActive && projects && projects.length > 0) {
      setActiveProject(projects[0].id);
    }
  }, [validActive, projects, setActiveProject]);

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (!validActive) {
    return (
      <div className="h-dvh overflow-auto bg-background p-6">
        <ProjectsPage />
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-hidden">
          <CenterPanel />
        </main>
      </div>
    </div>
  );
}
