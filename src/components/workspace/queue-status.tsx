"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, Activity, X } from "lucide-react";
import { useJobs, useDismissJob } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "done") return "default";
  if (status === "error") return "destructive";
  return "secondary";
}

/**
 * Global activity indicator — lives in the topbar so the user always sees what
 * the system is doing (capture/distill jobs), on every screen. Click to expand
 * the full queue with per-job status and errors.
 */
export function QueueStatus() {
  const { data: jobs } = useJobs();
  const dismiss = useDismissJob();
  const [open, setOpen] = useState(false);

  const all = jobs ?? [];
  const running = all.find((j) => j.status === "running");
  const queued = all.filter((j) => j.status === "queued");
  const active = all.filter((j) => j.status === "running" || j.status === "queued");
  const errorCount = all.filter((j) => j.status === "error").length;
  const hasError = errorCount > 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex max-w-[280px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          active.length > 0
            ? "border-primary/30 bg-primary/10 text-primary"
            : hasError
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "bg-background text-muted-foreground hover:bg-muted",
        )}
        title="Activity"
      >
        {running ? (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            <span className="truncate">{running.label}</span>
            {queued.length > 0 && <span className="shrink-0 opacity-70">+{queued.length}</span>}
          </>
        ) : queued.length > 0 ? (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            <span className="shrink-0">{queued.length} queued</span>
          </>
        ) : hasError ? (
          <>
            <AlertCircle className="size-3.5 shrink-0" />
            <span className="shrink-0">
              {errorCount} {errorCount === 1 ? "job failed" : "jobs failed"}
            </span>
          </>
        ) : (
          <>
            <Activity className="size-3.5 shrink-0" />
            <span className="shrink-0">Idle</span>
          </>
        )}
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <button
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-hidden
            tabIndex={-1}
          />
          <div className="absolute right-0 top-9 z-50 w-[340px] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Activity
              </span>
              {active.length > 0 && (
                <span className="text-[11px] text-muted-foreground">{active.length} active</span>
              )}
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-1.5">
              {all.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Nothing running. Capture or learn a source to see activity here.
                </p>
              ) : (
                all.slice(0, 20).map((job) => (
                  <div
                    key={job.id}
                    className="flex items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted/50"
                  >
                    {job.status === "running" || job.status === "queued" ? (
                      <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
                    ) : job.status === "error" ? (
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Badge variant={statusVariant(job.status)} className="font-normal capitalize">
                          {job.kind}
                        </Badge>
                        <span className="truncate text-xs text-foreground">{job.label}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {job.updatedAt.slice(11, 16)}
                        </span>
                        {(job.status === "error" || job.status === "done") && (
                          <button
                            onClick={() => dismiss.mutate(job.id)}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                            title="Dismiss"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                      {job.error && (
                        <p className="mt-0.5 text-xs text-destructive">{job.error}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
