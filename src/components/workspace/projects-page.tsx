"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, FolderPlus, Target, Settings, ArrowRight, Sparkles } from "lucide-react";
import { useProjects, useCreateProject } from "@/lib/api";
import { useWorkspace } from "@/lib/store";
import {
  MODEL_USAGE_OPTIONS,
  DEFAULT_MODEL_USAGE_POLICY,
  TRANSCRIPT_LANGUAGE_OPTIONS,
  DEFAULT_TRANSCRIPT_LANGUAGE,
  needsPaidConfirm,
  type ModelUsagePolicy,
} from "@/lib/settings";
import { getModelOption } from "@/lib/ai/models";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectSettings } from "./project-settings";

const MIN_TITLE = 2;
const MIN_GOAL = 40;

/**
 * The Projects hub: every project in one place. Open one, create a new one, or
 * edit a project's settings (settings live here now, not in the workspace).
 * Used both as the no-project gate and as the in-workspace "Projects" view.
 */
export function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const { activeProjectId, setActiveProject, setCenterMode } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  const hasProjects = !isLoading && projects && projects.length > 0;

  function open(id: string) {
    setActiveProject(id);
    setCenterMode("learn");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Projects</h2>
          <p className="text-sm text-muted-foreground">
            Open a project, create a new one, or manage a project&apos;s settings.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <FolderPlus className="size-4" /> New project
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : !hasProjects ? (
        <Card className="flex flex-col items-center gap-3 border-dashed p-12 text-center">
          <div className="rounded-full bg-muted p-4">
            <Target className="size-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="font-medium">No projects yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              A project goal steers learning, relevance scoring, Ask, and outputs. Create your
              first one to start capturing sources.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <FolderPlus className="size-4" /> Create project
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects!.map((p) => {
            const active = p.id === activeProjectId;
            return (
              <Card key={p.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 flex-1 truncate font-medium leading-snug">{p.title}</h3>
                  {active && (
                    <Badge variant="secondary" className="shrink-0 font-normal">
                      Active
                    </Badge>
                  )}
                </div>
                <p className="line-clamp-3 min-h-[3.5rem] text-xs text-muted-foreground">
                  {p.goal || "No goal set."}
                </p>
                <div className="mt-auto flex items-center gap-2">
                  <Button size="sm" className="flex-1" onClick={() => open(p.id)}>
                    Open <ArrowRight className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    title="Project settings"
                    onClick={() => setSettingsId(p.id)}
                  >
                    <Settings className="size-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <NewProjectForm
            onCreated={(id) => {
              setCreateOpen(false);
              open(id);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Per-project settings dialog */}
      <Dialog open={settingsId != null} onOpenChange={(o) => !o && setSettingsId(null)}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Project settings</DialogTitle>
          </DialogHeader>
          {settingsId && <ProjectSettings key={settingsId} projectId={settingsId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewProjectForm({ onCreated }: { onCreated: (id: string) => void }) {
  const create = useCreateProject();
  const modelId = useWorkspace((s) => s.modelId);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [generating, setGenerating] = useState(false);
  const [modelUsagePolicy, setModelUsagePolicy] = useState<ModelUsagePolicy>(
    DEFAULT_MODEL_USAGE_POLICY,
  );
  const [transcriptLanguage, setTranscriptLanguage] = useState<string>(DEFAULT_TRANSCRIPT_LANGUAGE);

  const titleValid = title.trim().length >= MIN_TITLE;
  const goalValid = goal.trim().length >= MIN_GOAL;
  const canCreate = titleValid && goalValid && !create.isPending;

  /** Draft (or refine) the project goal from the project name via the model. */
  async function generateGoal() {
    const topic = title.trim() || goal.trim();
    if (topic.length < MIN_TITLE) {
      toast.error("Enter a project name first, so AI can draft a goal for it.");
      return;
    }
    if (
      needsPaidConfirm(modelUsagePolicy, modelId) &&
      !window.confirm(`${getModelOption(modelId).label} is a paid model and will use API credits. Continue?`)
    ) {
      return;
    }
    setGenerating(true);
    try {
      const draft = goal.trim();
      const prompt = `You are helping define a project for ProjectForge, a local-first knowledge-to-project compiler. A project has a single GOAL that steers what knowledge to learn and what build-ready outputs to generate.

Write a clear, specific project GOAL (2-4 sentences) for this project.
PROJECT NAME / TOPIC: ${topic}
${draft ? `EXISTING DRAFT TO REFINE: ${draft}\n` : ""}
The goal should state what the user wants to learn AND what they intend to produce from that knowledge (e.g. concepts, design docs, specs, agent build prompts). Be concrete and outcome-oriented.

Return ONLY the goal text — no preamble, no quotes, no markdown.`;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, prompt }),
      });
      const json = (await res.json()) as { output?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Generation failed.");
      const text = String(json.output ?? "")
        .trim()
        .replace(/^["']+|["']+$/g, "")
        .trim();
      if (text) setGoal(text);
      else toast.error("The model returned an empty goal.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate a goal.");
    } finally {
      setGenerating(false);
    }
  }

  async function onCreate() {
    if (!canCreate) return;
    try {
      const project = await create.mutateAsync({
        title: title.trim(),
        goal: goal.trim(),
        settings: { modelUsagePolicy, transcriptLanguage, learnInstructions: "" },
      });
      toast.success(`Project "${project.title}" created. Add your first sources.`);
      onCreated(project.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create project.");
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="np-name" className="text-sm font-medium">
          Project name
        </label>
        <Input
          id="np-name"
          placeholder="Indie Game Design Research"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="np-goal" className="text-sm font-medium">
            Project goal
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={generateGoal}
            disabled={generating}
            title={title.trim() ? "Draft a goal from the project name" : "Enter a project name first"}
          >
            {generating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {goal.trim() ? "Refine with AI" : "Generate with AI"}
          </Button>
        </div>
        <Textarea
          id="np-goal"
          rows={4}
          placeholder="Learn what makes great indie games work so we can generate stronger game concepts, design documents, technical specs, and AI-agent build prompts."
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Be specific. ProjectForge keeps only source material that supports this goal.
          {!goalValid && goal.length > 0 && (
            <span className="ml-1 text-amber-600">
              ({MIN_GOAL - goal.trim().length} more characters)
            </span>
          )}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Model usage</legend>
        {MODEL_USAGE_OPTIONS.map((opt) => {
          const selected = modelUsagePolicy === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setModelUsagePolicy(opt.value)}
              className={`flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                selected ? "border-primary bg-accent/50" : ""
              }`}
            >
              <span
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                  selected ? "border-primary" : "border-muted-foreground/40"
                }`}
              >
                {selected && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0 space-y-0.5">
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="block text-xs text-muted-foreground">{opt.blurb}</span>
              </span>
            </button>
          );
        })}
      </fieldset>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Transcript language</label>
        <Select
          value={transcriptLanguage || "auto"}
          onValueChange={(v) => setTranscriptLanguage(v === "auto" ? "" : v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSCRIPT_LANGUAGE_OPTIONS.map((l) => (
              <SelectItem key={l.value || "auto"} value={l.value || "auto"}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button onClick={onCreate} disabled={!canCreate} className="w-full">
        {create.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            <FolderPlus className="size-4" /> Create project → Add sources
          </>
        )}
      </Button>
    </div>
  );
}
