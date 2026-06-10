"use client";

/**
 * Per-project Learn (distill) instruction editor. Exposes the prose that steers
 * every Learn run so it can be seen and edited; the project goal and the fixed
 * JSON output contract are shown read-only in the full-prompt preview. Persisted
 * to the project's settings (empty = the built-in default).
 */
import { useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { useWorkspace } from "@/lib/store";
import { useProjects, useProjectSettings, useUpdateProject } from "@/lib/api";
import { DEFAULT_LEARN_INSTRUCTIONS, buildLearnInstructions } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function LearnInstructions() {
  const { activeProjectId } = useWorkspace();
  const { data: projects } = useProjects();
  const settings = useProjectSettings(activeProjectId);
  const updateProject = useUpdateProject();

  const goal = projects?.find((p) => p.id === activeProjectId)?.goal ?? "";
  // Stored "" means "use the built-in default" — surface it so it's editable.
  const saved = settings.learnInstructions || DEFAULT_LEARN_INSTRUCTIONS;
  const [draft, setDraft] = useState(saved);

  // Re-sync the draft when the persisted value changes — on project switch, after
  // a save lands, or when settings finish loading (projects load asynchronously).
  // Adjusting state during render is React's sanctioned alternative to a setState
  // effect; the guard makes it run once per genuine change, not every render.
  const [syncedTo, setSyncedTo] = useState(saved);
  if (saved !== syncedTo) {
    setSyncedTo(saved);
    setDraft(saved);
  }

  const dirty = draft.trim() !== saved.trim();
  const isDefault = draft.trim() === DEFAULT_LEARN_INSTRUCTIONS.trim();

  async function save() {
    if (!activeProjectId) return;
    try {
      await updateProject.mutateAsync({
        id: activeProjectId,
        // Store "" when it matches the default, so default changes keep flowing through.
        settings: { learnInstructions: isDefault ? "" : draft.trim() },
      });
      toast.success("Learn instructions saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save instructions.");
    }
  }

  return (
    <details className="group rounded-md border">
      <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground select-none">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        Learn instructions
        {!(settings.learnInstructions === "") && (
          <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-primary">
            customized
          </span>
        )}
      </summary>
      <div className="space-y-3 px-3 pb-3">
        <p className="text-xs text-muted-foreground">
          This prose steers every Learn run for <strong>this project</strong>. The project goal and
          the required JSON output shape are appended automatically — see the full prompt preview
          below.
        </p>
        <Textarea
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="font-mono text-xs"
          placeholder={DEFAULT_LEARN_INSTRUCTIONS}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={save}
            disabled={!dirty || !activeProjectId || updateProject.isPending}
          >
            {updateProject.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDraft(DEFAULT_LEARN_INSTRUCTIONS)}
            disabled={isDefault}
          >
            <RotateCcw className="size-3.5" /> Reset to default
          </Button>
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        </div>

        <details className="group/preview rounded-md border bg-muted/30">
          <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground select-none">
            <ChevronRight className="size-3 transition-transform group-open/preview:rotate-90" />
            Full prompt preview (read-only)
          </summary>
          <pre className="overflow-x-auto whitespace-pre-wrap px-3 pb-3 text-[11px] leading-relaxed text-foreground/70">
            {buildLearnInstructions(goal, draft, settings.taxonomy.categories)}
          </pre>
        </details>
      </div>
    </details>
  );
}
