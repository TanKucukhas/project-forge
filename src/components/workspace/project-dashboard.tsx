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
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Target,
  Layers,
  CheckCircle2,
  FileText,
  ArrowRight,
  Sparkles,
  ChevronRight,
  Brain,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useWorkspace } from "@/lib/store";
import { useProjects, useSources, useGraph, useModelUsagePolicy } from "@/lib/api";
import { needsPaidConfirm } from "@/lib/settings";
import { getModelOption } from "@/lib/ai/models";
import { tagLabel } from "@/lib/taxonomy";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { ProjectSettings } from "./project-settings";

/** Persisted learning analysis (per project) — disposable, like askHistory. */
type Analysis = { text: string; modelId: string; createdAt: string };
const analysisKey = (projectId: string) => `pf.learnAnalysis.${projectId}`;

function readAnalysis(projectId: string | null): Analysis | null {
  if (!projectId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(analysisKey(projectId));
    return raw ? (JSON.parse(raw) as Analysis) : null;
  } catch {
    return null;
  }
}

function writeAnalysis(projectId: string, a: Analysis | null): void {
  if (typeof window === "undefined") return;
  try {
    if (a) window.localStorage.setItem(analysisKey(projectId), JSON.stringify(a));
    else window.localStorage.removeItem(analysisKey(projectId));
  } catch {
    /* quota — ignore */
  }
}

export function ProjectDashboard() {
  const activeProjectId = useWorkspace((s) => s.activeProjectId);
  const setCenterMode = useWorkspace((s) => s.setCenterMode);
  const modelId = useWorkspace((s) => s.modelId);
  const { data: projects } = useProjects();
  const { data } = useSources(activeProjectId);
  const { data: graph } = useGraph(activeProjectId);
  const modelUsagePolicy = useModelUsagePolicy(activeProjectId);
  const project = projects?.find((p) => p.id === activeProjectId);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  // Load persisted analysis for the active project (guarded set-during-render).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (activeProjectId !== loadedFor) {
    setLoadedFor(activeProjectId);
    setAnalysis(readAnalysis(activeProjectId));
  }

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

  function confirmPaid(): boolean {
    if (!needsPaidConfirm(modelUsagePolicy, modelId)) return true;
    return window.confirm(
      `${getModelOption(modelId).label} is a paid model and will use API credits. Continue?`,
    );
  }

  /** Build a meta-analysis prompt from the project's learning state (no
   *  retrieval — this reasons over the taxonomy/status, not the raw content). */
  function buildAnalysisPrompt(): string {
    const cats = data?.categories ?? [];
    const authors = (graph?.authors ?? []).map((a) => a.displayName ?? a.slug);
    const gameNames = (graph?.entities ?? []).filter((e) => e.type === "game").map((g) => g.name);
    const topicsLine = learnedTopics.length
      ? learnedTopics.map(([c, n]) => `- ${c} (${n})`).join("\n")
      : "- (nothing learned yet)";
    const notLearnedLine = toLearn.length
      ? toLearn.slice(0, 40).map((s) => `- ${s.title} [${s.type}]`).join("\n")
      : "- (none — everything captured is learned)";
    return `You are a learning strategist for a knowledge-to-project compiler. Analyze the
current state of this project's knowledge base against its GOAL and advise what
to do next. Be concrete and prioritized — the user wants to know where the gaps
are and what to learn next.

PROJECT: ${project?.title ?? ""}
GOAL: ${project?.goal || "(no goal set)"}

LEARNING STATUS:
- Captured sources: ${captured}
- Learned (distilled): ${learned} (${pct}%)
- Captured but not yet learned: ${toLearn.length}

TOPICS LEARNED (category · source count):
${topicsLine}

TAGS SURFACED: ${topTags.length ? topTags.map((t) => `#${tagLabel(t)}`).join(" ") : "(none)"}
DEFINED CATEGORIES (taxonomy): ${cats.length ? cats.map((c) => c.name).join(", ") : "(none)"}
AUTHORS COVERED: ${authors.length ? authors.join(", ") : "(none)"}
GAMES/REFERENCES: ${gameNames.length ? gameNames.join(", ") : "(none)"}

SOURCES NOT YET LEARNED:
${notLearnedLine}

Write a tight, actionable analysis in markdown with these short sections:
## Status — where this knowledge base stands relative to the GOAL.
## Coverage & gaps — which topics are well covered; which are thin or missing
for achieving the GOAL.
## Learn next — a prioritized list of concrete next steps (specific topics to
seek out, source types to capture, or which not-yet-learned sources to distill
first, and why). Keep it brief and skimmable.`;
  }

  async function analyze() {
    if (!activeProjectId || analyzing || !confirmPaid()) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, prompt: buildAnalysisPrompt() }),
      });
      const json = (await res.json()) as { output?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Analysis failed.");
      const entry: Analysis = {
        text: json.output ?? "",
        modelId,
        createdAt: new Date().toISOString(),
      };
      setAnalysis(entry);
      writeAnalysis(activeProjectId, entry);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }

  function dismissAnalysis() {
    if (!activeProjectId) return;
    setAnalysis(null);
    writeAnalysis(activeProjectId, null);
  }

  if (!project) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* AI learning analysis — pinned suggestion of what to do next. */}
      {analysis ? (
        <Card className="space-y-2 border-primary/30 bg-primary/[0.03] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Brain className="size-4 text-primary" />
            <span className="text-sm font-semibold">Suggested next steps</span>
            <span className="text-xs text-muted-foreground">
              {analysis.modelId} · {analysis.createdAt.slice(0, 16).replace("T", " ")}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={analyze} disabled={analyzing}>
                {analyzing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Re-analyze
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={dismissAnalysis} title="Dismiss">
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
          <Markdown>{analysis.text}</Markdown>
        </Card>
      ) : (
        <Card className="flex flex-wrap items-center gap-3 border-dashed p-4">
          <Brain className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Analyze my learning</p>
            <p className="text-xs text-muted-foreground">
              Let the model review what you&apos;ve learned, where the gaps are, and what to learn
              next toward your goal.
            </p>
          </div>
          <Button onClick={analyze} disabled={analyzing || captured === 0}>
            {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {analyzing ? "Analyzing…" : "Analyze"}
          </Button>
        </Card>
      )}

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
