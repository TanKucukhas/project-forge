"use client";

/**
 * Knowledge Taxonomy editor (collapsed Advanced section of Project Settings).
 * Defines the project's canonical categories, tag policy, and entity-extraction
 * flags. Changing it marks existing learned docs *metadata-stale* (not fully
 * stale) and never re-runs paid models automatically.
 */
import { useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Loader2, Plus, Trash2, RotateCcw } from "lucide-react";
import { useProjectSettings, useUpdateProject } from "@/lib/api";
import { DEFAULT_TAXONOMY, type CanonicalCategory, type EntityExtraction } from "@/lib/taxonomy";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const EE_LABELS: { key: keyof EntityExtraction; label: string }[] = [
  { key: "extract_authors", label: "Authors" },
  { key: "extract_referenced_games", label: "Games" },
  { key: "extract_referenced_people", label: "People" },
  { key: "extract_referenced_studios", label: "Studios" },
  { key: "extract_key_terms", label: "Key terms" },
  { key: "extract_synonyms", label: "Synonyms" },
];

export function KnowledgeTaxonomy({ projectId }: { projectId: string }) {
  const settings = useProjectSettings(projectId);
  const update = useUpdateProject();

  const [cats, setCats] = useState<CanonicalCategory[]>(settings.taxonomy.categories);
  const [ee, setEe] = useState<EntityExtraction>(settings.taxonomy.entityExtraction);
  const [maxTags, setMaxTags] = useState<number>(settings.taxonomy.tagPolicy.maxTagsPerSource);
  // Re-sync if the persisted taxonomy changes (sanctioned set-during-render).
  const [syncedTo, setSyncedTo] = useState(settings.taxonomy);
  if (settings.taxonomy !== syncedTo) {
    setSyncedTo(settings.taxonomy);
    setCats(settings.taxonomy.categories);
    setEe(settings.taxonomy.entityExtraction);
    setMaxTags(settings.taxonomy.tagPolicy.maxTagsPerSource);
  }

  function setCat(i: number, patch: Partial<CanonicalCategory>) {
    setCats((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function removeCat(i: number) {
    setCats((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addCat() {
    setCats((prev) => [...prev, { id: `custom-${prev.length}`, name: "", description: "", aliases: [] }]);
  }

  async function save() {
    const cleaned = cats
      .map((c) => ({ ...c, name: c.name.trim() }))
      .filter((c) => c.name);
    if (!cleaned.some((c) => c.name === "Other")) {
      cleaned.push({ id: "other", name: "Other", description: "Does not fit any category above.", aliases: [] });
    }
    try {
      await update.mutateAsync({
        id: projectId,
        settings: {
          taxonomy: {
            ...settings.taxonomy,
            categories: cleaned,
            entityExtraction: ee,
            tagPolicy: { ...settings.taxonomy.tagPolicy, maxTagsPerSource: maxTags },
          },
        },
      });
      toast.success("Taxonomy saved. Existing learned docs may now show as metadata-stale.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save taxonomy.");
    }
  }

  return (
    <details className="group rounded-md border">
      <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2.5 text-sm font-medium select-none">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        Knowledge Taxonomy
        <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
          advanced
        </span>
      </summary>

      <div className="space-y-4 px-3 pb-4">
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700">
          Changing taxonomy may mark existing learned docs as <strong>metadata-stale</strong>. It will
          not re-run paid models automatically — re-learn a source when you want its category/tags/
          entities refreshed.
        </p>

        <div className="text-xs text-muted-foreground">
          Template: <span className="font-medium text-foreground">{settings.taxonomy.template}</span>
        </div>

        {/* Categories */}
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Canonical categories
          </div>
          {cats.map((c, i) => {
            const isOther = c.name === "Other";
            return (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1 space-y-1">
                  <Input
                    value={c.name}
                    onChange={(e) => setCat(i, { name: e.target.value })}
                    placeholder="Category name"
                    className="h-8"
                    disabled={isOther}
                  />
                  <Input
                    value={c.aliases.join(", ")}
                    onChange={(e) =>
                      setCat(i, {
                        aliases: e.target.value.split(",").map((a) => a.trim()).filter(Boolean),
                      })
                    }
                    placeholder="aliases, comma separated"
                    className="h-7 font-mono text-xs"
                    disabled={isOther}
                  />
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => removeCat(i)}
                  disabled={isOther}
                  title={isOther ? "Other is always kept" : "Remove"}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addCat}>
              <Plus className="size-3.5" /> Add category
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCats(DEFAULT_TAXONOMY.categories)}>
              <RotateCcw className="size-3.5" /> Reset to default
            </Button>
          </div>
        </div>

        {/* Entity extraction */}
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Entity extraction
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {EE_LABELS.map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ee[key]}
                  onChange={(e) => setEe((prev) => ({ ...prev, [key]: e.target.checked }))}
                  className="size-4 accent-primary"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Tag policy */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Max tags / source
          </span>
          <Input
            type="number"
            min={1}
            max={20}
            value={maxTags}
            onChange={(e) => setMaxTags(Math.max(1, Math.min(20, Number(e.target.value) || 8)))}
            className="h-7 w-20"
          />
          <span className="text-xs text-muted-foreground">
            tags normalized to {settings.taxonomy.tagPolicy.format}
          </span>
        </div>

        <Button size="sm" onClick={save} disabled={update.isPending}>
          {update.isPending && <Loader2 className="size-3.5 animate-spin" />}
          Save taxonomy
        </Button>
      </div>
    </details>
  );
}
