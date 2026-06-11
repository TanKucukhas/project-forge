"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertCircle, Activity, X } from "lucide-react";
import { useJobs, useJobStats, useDismissJob, useCancelQueued } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "done") return "default";
  if (status === "error") return "destructive";
  return "secondary";
}

/** Human ETA from ms, e.g. "~4.2h left" / "~7m left". "" when nothing pending. */
function formatEta(ms: number): string {
  if (!ms || ms <= 0) return "";
  const min = ms / 60_000;
  if (min < 1) return "~<1m left";
  if (min < 60) return `~${Math.round(min)}m left`;
  return `~${(min / 60).toFixed(1)}h left`;
}

/**
 * Global activity indicator (topbar). Shows the running job + TRUE totals/ETA
 * (the list itself is capped, so totals come from stats), and lets you cancel
 * the queued backlog.
 */
export function QueueStatus() {
  const { data: jobs } = useJobs();
  const { data: stats } = useJobStats();
  const dismiss = useDismissJob();
  const cancel = useCancelQueued();
  const [open, setOpen] = useState(false);

  const all = jobs ?? [];
  const running = all.find((j) => j.status === "running");
  const queued = stats?.queued ?? 0;
  const runningCount = stats?.running ?? (running ? 1 : 0);
  const errorCount = stats?.error ?? 0;
  const active = runningCount + queued;
  const eta = formatEta(stats?.etaMs ?? 0);

  async function onCancel() {
    if (!window.confirm(`Cancel ${queued} queued job${queued === 1 ? "" : "s"}? The running one finishes.`))
      return;
    try {
      const r = await cancel.mutateAsync();
      toast.success(`Cancelled ${r.cancelled} queued job${r.cancelled === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel.");
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex max-w-[300px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          active > 0
            ? "border-primary/30 bg-primary/10 text-primary"
            : errorCount > 0
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "bg-background text-muted-foreground hover:bg-muted",
        )}
        title="Activity"
      >
        {running ? (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            <span className="truncate">{running.label}</span>
            {queued > 0 && <span className="shrink-0 opacity-70">+{queued}</span>}
            {eta && <span className="shrink-0 opacity-70">· {eta}</span>}
          </>
        ) : queued > 0 ? (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            <span className="shrink-0">{queued} queued{eta ? ` · ${eta}` : ""}</span>
          </>
        ) : errorCount > 0 ? (
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
          <button
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-hidden
            tabIndex={-1}
          />
          <div className="absolute right-0 top-9 z-50 w-[360px] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
            {/* Summary header — true totals + ETA + cancel */}
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="font-medium uppercase tracking-wide">Activity</span>
                {stats && (
                  <>
                    {stats.running > 0 && <span className="text-primary">{stats.running} running</span>}
                    {queued > 0 && <span>{queued} queued</span>}
                    {stats.done > 0 && <span>{stats.done} done</span>}
                    {stats.error > 0 && <span className="text-destructive">{stats.error} failed</span>}
                    {eta && <span>· {eta}</span>}
                  </>
                )}
              </div>
              {queued > 0 && (
                <button
                  onClick={onCancel}
                  disabled={cancel.isPending}
                  className="shrink-0 rounded border border-destructive/40 px-1.5 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                >
                  {cancel.isPending ? "Cancelling…" : `Cancel ${queued}`}
                </button>
              )}
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-1.5">
              {all.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Nothing running. Capture or learn a source to see activity here.
                </p>
              ) : (
                all.map((job) => (
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
                      {job.error && <p className="mt-0.5 text-xs text-destructive">{job.error}</p>}
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
