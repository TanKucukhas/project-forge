"use client";

/**
 * Project Dashboard — opened from the project-name corner menu. Shows learning
 * status (captured / learned / % done), the main topics (top categories), and
 * the embedded project settings (goal, taxonomy, model usage, transcript
 * language via ProjectSettings). Read-only stats derived from useSources.
 */
import { useMemo } from "react";
import { Target, Layers, CheckCircle2, FileText } from "lucide-react";
import { useWorkspace } from "@/lib/store";
import { useProjects, useSources } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProjectSettings } from "./project-settings";

export function ProjectDashboard() {
  const activeProjectId = useWorkspace((s) => s.activeProjectId);
  const { data: projects } = useProjects();
  const { data } = useSources(activeProjectId);
  const project = projects?.find((p) => p.id === activeProjectId);

  const sources = useMemo(() => data?.sources ?? [], [data]);
  const learned = sources.filter((s) => s.status === "distilled").length;
  const captured = sources.length;
  const pct = captured ? Math.round((learned / captured) * 100) : 0;

  // Top categories by source count (learned + captured).
  const topCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sources) {
      if (s.category) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [sources]);

  if (!project) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{project.title}</h2>
        {project.goal && (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
            <Target className="mt-0.5 size-3.5 shrink-0" />
            <span>{project.goal}</span>
          </p>
        )}
      </div>

      {/* Learning status */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={FileText} label="Captured" value={captured} />
        <StatCard icon={CheckCircle2} label="Learned" value={learned} />
        <StatCard icon={Layers} label="Progress" value={`${pct}%`} />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* Main topics */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Main topics</h3>
        {topCategories.length ? (
          <div className="flex flex-wrap gap-1.5">
            {topCategories.map(([cat, n]) => (
              <Badge key={cat} variant="outline" className="font-normal">
                {cat} · {n}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No categories yet — learn some sources to populate topics.
          </p>
        )}
      </div>

      {/* Embedded project settings (goal · taxonomy · model usage · language) */}
      <div className="space-y-2 border-t pt-5">
        <h3 className="text-sm font-medium">Project settings</h3>
        <ProjectSettings projectId={activeProjectId ?? undefined} />
      </div>
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
