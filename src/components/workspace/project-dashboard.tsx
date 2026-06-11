"use client";

/**
 * Learn Dashboard (Learning Overview) — the at-a-glance view of a project's
 * knowledge: learning progress, the topics already learned, what's still open
 * to learn next, and (collapsed) the project settings. Reachable from the Learn
 * sub-nav "Overview" tab and the project-name corner menu.
 *
 * Read-only stats derived from useSources / useGraph; the only action is jumping
 * into the Learn list to distill the not-yet-learned sources.
 */
import { useMemo } from "react";
import {
  Target,
  Layers,
  CheckCircle2,
  FileText,
  ArrowRight,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { useWorkspace } from "@/lib/store";
import { useProjects, useSources, useGraph } from "@/lib/api";
import { tagLabel } from "@/lib/taxonomy";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProjectSettings } from "./project-settings";

export function ProjectDashboard() {
  const activeProjectId = useWorkspace((s) => s.activeProjectId);
  const setCenterMode = useWorkspace((s) => s.setCenterMode);
  const { data: projects } = useProjects();
  const { data } = useSources(activeProjectId);
  const { data: graph } = useGraph(activeProjectId);
  const project = projects?.find((p) => p.id === activeProjectId);

  const sources = useMemo(() => data?.sources ?? [], [data]);
  const learnedSources = sources.filter((s) => s.status === "distilled");
  const captured = sources.length;
  const learned = learnedSources.length;
  const pct = captured ? Math.round((learned / captured) * 100) : 0;

  // Learned topics = categories among the already-learned sources.
  const learnedTopics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of learnedSources) {
      if (s.category) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [learnedSources]);

  // Open to learn = captured but not yet learned (and not still capturing).
  const toLearn = useMemo(
    () => sources.filter((s) => s.status === "processed"),
    [sources],
  );

  const topTags = (graph?.tags ?? []).slice(0, 16);

  if (!project) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Learning overview
        </p>
        <h2 className="text-lg font-semibold">{project.title}</h2>
        {project.goal && (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
            <Target className="mt-0.5 size-3.5 shrink-0" />
            <span>{project.goal}</span>
          </p>
        )}
      </div>

      {/* Learning progress */}
      <div>
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={FileText} label="Captured" value={captured} />
          <StatCard icon={CheckCircle2} label="Learned" value={learned} />
          <StatCard icon={Layers} label="Progress" value={`${pct}%`} />
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Learned topics */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Topics learned</h3>
        {learnedTopics.length ? (
          <div className="flex flex-wrap gap-1.5">
            {learnedTopics.map(([cat, n]) => (
              <Badge key={cat} variant="secondary" className="font-normal">
                {cat} · {n}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing learned yet — distill some captured sources to build topics.
          </p>
        )}
        {topTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-muted-foreground">Tags:</span>
            {topTags.map((t) => (
              <Badge key={t} variant="outline" className="font-normal">
                #{tagLabel(t)}
              </Badge>
            ))}
          </div>
        )}
      </section>

      {/* Open to learn next */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            Open to learn{toLearn.length ? ` · ${toLearn.length}` : ""}
          </h3>
          {toLearn.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setCenterMode("analyze")}>
              <Sparkles className="size-3.5" /> Go to Learn <ArrowRight className="size-3.5" />
            </Button>
          )}
        </div>
        {toLearn.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            {captured === 0 ? (
              <>
                No sources captured yet.{" "}
                <button onClick={() => setCenterMode("learn")} className="underline hover:text-foreground">
                  Capture your first source
                </button>
                .
              </>
            ) : (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> Everything captured has
                been learned.
              </span>
            )}
          </Card>
        ) : (
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {toLearn.slice(0, 8).map((s) => (
              <button
                key={s.id}
                onClick={() => setCenterMode("analyze")}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="shrink-0 text-xs capitalize text-muted-foreground">{s.type}</span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
            {toLearn.length > 8 && (
              <button
                onClick={() => setCenterMode("analyze")}
                className="flex w-full items-center justify-center px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50"
              >
                +{toLearn.length - 8} more in Learn
              </button>
            )}
          </div>
        )}
      </section>

      {/* Project settings (collapsed) */}
      <details className="group rounded-lg border bg-card">
        <summary className="flex cursor-pointer items-center gap-1.5 px-4 py-3 text-sm font-medium select-none">
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
          Project settings
          <span className="text-xs font-normal text-muted-foreground">
            goal · taxonomy · model · language
          </span>
        </summary>
        <div className="border-t p-4">
          <ProjectSettings projectId={activeProjectId ?? undefined} />
        </div>
      </details>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
    </Card>
  );
}
