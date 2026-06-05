"use client";

import { useWorkspace } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Plus, BookOpen, FileText } from "lucide-react";

// Phase 0 placeholder data — replaced by TanStack Query reads in Phase 1.
const NOTEBOOKS = [{ id: "indie-game-dev", title: "Indie Game Dev", sources: 0 }];
const SOURCES: { id: string; title: string; type: string }[] = [];

export function LeftPanel() {
  const { activeNotebookId, setActiveNotebook, activeSourceId, setActiveSource } = useWorkspace();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Notebooks
        </span>
        <Button size="icon" variant="ghost" className="size-7" aria-label="New notebook">
          <Plus className="size-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <nav className="space-y-1 px-2">
          {NOTEBOOKS.map((n) => (
            <button
              key={n.id}
              onClick={() => setActiveNotebook(n.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent ${
                activeNotebookId === n.id ? "bg-accent font-medium" : ""
              }`}
            >
              <BookOpen className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{n.title}</span>
              <Badge variant="secondary">{n.sources}</Badge>
            </button>
          ))}
        </nav>

        <Separator className="my-3" />

        <div className="px-4 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Sources
        </div>
        <div className="px-2">
          {SOURCES.length === 0 ? (
            <p className="px-2 py-6 text-sm text-muted-foreground">
              No sources yet. Add a YouTube link, article, or note to begin.
            </p>
          ) : (
            SOURCES.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSource(s.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent ${
                  activeSourceId === s.id ? "bg-accent" : ""
                }`}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{s.title}</span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
