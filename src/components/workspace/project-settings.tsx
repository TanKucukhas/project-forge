"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useWorkspace } from "@/lib/store";
import { useProjects, useUpdateProject, useProjectSettings } from "@/lib/api";
import {
  MODEL_USAGE_OPTIONS,
  TRANSCRIPT_LANGUAGE_OPTIONS,
  type ModelUsagePolicy,
} from "@/lib/settings";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Editable settings for one project. Defaults to the active project, but any
 *  project id can be passed (e.g. from the Projects page settings dialog). */
export function ProjectSettings({ projectId }: { projectId?: string } = {}) {
  const activeProjectId = useWorkspace((s) => s.activeProjectId);
  const id = projectId ?? activeProjectId;
  const { data: projects } = useProjects();
  const settings = useProjectSettings(id);
  const update = useUpdateProject();
  const project = projects?.find((p) => p.id === id);

  const [title, setTitle] = useState(project?.title ?? "");
  const [goal, setGoal] = useState(project?.goal ?? "");

  if (!project) return null;

  async function save(patch: Parameters<typeof update.mutateAsync>[0]) {
    try {
      await update.mutateAsync(patch);
      toast.success("Saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Project name</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Goal</label>
        <Textarea rows={4} value={goal} onChange={(e) => setGoal(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          The steering context for distillation, relevance scoring, and outputs.
        </p>
        <Button
          size="sm"
          disabled={update.isPending || (title.trim() === project.title && goal.trim() === project.goal)}
          onClick={() => save({ id: project.id, title: title.trim(), goal: goal.trim() })}
        >
          {update.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save name & goal"}
        </Button>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Transcript language</label>
        <Select
          value={settings.transcriptLanguage || "auto"}
          onValueChange={(v) =>
            save({ id: project.id, settings: { transcriptLanguage: v === "auto" ? "" : v } })
          }
        >
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TRANSCRIPT_LANGUAGE_OPTIONS.map((l) => (
              <SelectItem key={l.value || "auto"} value={l.value || "auto"}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Model usage</label>
        {MODEL_USAGE_OPTIONS.map((opt) => {
          const selected = settings.modelUsagePolicy === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => save({ id: project.id, settings: { modelUsagePolicy: opt.value as ModelUsagePolicy } })}
              className={`flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                selected ? "border-primary bg-accent/50" : ""
              }`}
            >
              <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${selected ? "border-primary" : "border-muted-foreground/40"}`}>
                {selected && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="block text-xs text-muted-foreground">{opt.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
