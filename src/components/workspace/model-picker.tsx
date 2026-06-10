"use client";

/**
 * Model picker — a grouped, descriptive dropdown (Claude/Codex-style) instead of
 * a bare <select>. Shows each model's real name, one-line description, tier, and
 * a cost/usage hint (estimated $/1M for paid API models; subscription usage
 * weight for local CLIs). The list itself is curated in models.ts.
 */
import { useState } from "react";
import { Check, ChevronDown, Cpu } from "lucide-react";
import { useWorkspace } from "@/lib/store";
import { availableModels, isPaidModel, type ModelUsagePolicy } from "@/lib/settings";
import {
  getModelOption,
  modelCostHint,
  modelsByProvider,
  PROVIDER_LABELS,
} from "@/lib/ai/models";

export function ModelPicker({ policy }: { policy: ModelUsagePolicy }) {
  const { modelId, setModel } = useWorkspace();
  const [open, setOpen] = useState(false);

  const current = getModelOption(modelId);
  const groups = modelsByProvider(availableModels(policy));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs hover:bg-muted"
        title="Choose model"
      >
        <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="max-w-[150px] truncate font-medium">{current.label}</span>
        <span className="hidden text-muted-foreground sm:inline">· {current.tier}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-hidden
            tabIndex={-1}
          />
          <div className="absolute right-0 top-9 z-50 max-h-[70vh] w-80 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
            {groups.map((g) => (
              <div key={g.provider} className="mb-1">
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {PROVIDER_LABELS[g.provider]}
                </div>
                {g.models.map((m) => {
                  const selected = m.id === modelId;
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        setModel(m.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted ${
                        selected ? "bg-muted/60" : ""
                      }`}
                    >
                      <Check
                        className={`mt-0.5 size-3.5 shrink-0 ${selected ? "text-primary" : "text-transparent"}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{m.label}</span>
                          <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                            {m.tier}
                          </span>
                          {isPaidModel(m.id) && (
                            <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-600">
                              paid
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {m.description}
                        </span>
                        <span className="block text-[10px] text-muted-foreground/80">
                          {modelCostHint(m)} · <code>{m.model}</code>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
