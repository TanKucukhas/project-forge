"use client";

/**
 * Ask — the knowledge command center. Not a chat box: a request → context →
 * output → evidence flow. Composer (output type + big textarea + examples) →
 * compact context summary with collapsed advanced filters → Answer + Retrieved
 * Context two-column result. "Answer" output type runs Ask; the others generate a
 * structured output. Preview Context is a free, model-free dry run.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ChevronRight, Copy, Save, FlaskConical, Eye, Sparkles, X } from "lucide-react";
import { useWorkspace } from "@/lib/store";
import {
  useSources,
  useGraph,
  useModelUsagePolicy,
  usePreviewContext,
  useSaveOutput,
  useAblation,
  type AskScope,
  type AskMode,
  type RetrievedItem,
  type PreviewResult,
  type GenerateOutputType,
} from "@/lib/api";
import { needsPaidConfirm } from "@/lib/settings";
import { getModelOption } from "@/lib/ai/models";
import { parseMentions } from "@/lib/mentions";
import { tagLabel } from "@/lib/taxonomy";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/markdown";

const OUTPUT_TYPES: { value: GenerateOutputType; label: string }[] = [
  { value: "answer", label: "Answer" },
  { value: "game_concept", label: "Game Concept" },
  { value: "gdd", label: "GDD" },
  { value: "prototype_spec", label: "Prototype Spec" },
  { value: "technical_spec", label: "Technical Spec" },
  { value: "agent_build_prompt", label: "Agent Prompt" },
  { value: "evaluation_checklist", label: "Evaluate" },
];

const MODES: { value: AskMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "hybrid", label: "Hybrid" },
  { value: "summaries", label: "Summaries" },
  { value: "full", label: "Raw" },
];

const USE_FOR = ["answer", "concept", "gdd", "prototype_spec", "technical_spec", "agent_prompt", "evaluation"];

const EXAMPLES = [
  "Generate a 2-week prototype concept using constraint-driven mechanics",
  "Evaluate this idea using the learned anti-patterns",
  "Create a GDD outline from the strongest design principles",
  "Use @peter_molyneux and #indirect-control to propose a god-game prototype",
];

const MODE_LABEL: Record<string, string> = {
  auto: "Auto",
  hybrid: "Hybrid",
  summaries: "Learned summaries",
  full: "Raw transcript chunks",
};

/** One asked-and-answered run. Persisted to localStorage per project so leaving
 *  the tab / reloading doesn't lose your work. */
type AskEntry = {
  id: string;
  request: string;
  answer: string;
  retrieved: RetrievedItem[];
  used: { id: string; title: string }[];
  mode: string;
  retrievalRunId: string;
  outputType: GenerateOutputType;
  modelId: string;
  createdAt: string;
};

const HISTORY_MAX = 30;
const histKey = (projectId: string) => `pf.askHistory.${projectId}`;

function readHistory(projectId: string | null): AskEntry[] {
  if (!projectId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(histKey(projectId));
    return raw ? (JSON.parse(raw) as AskEntry[]) : [];
  } catch {
    return [];
  }
}

function writeHistory(projectId: string, entries: AskEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(histKey(projectId), JSON.stringify(entries));
  } catch {
    /* quota — ignore */
  }
}

/** Small toggle-chip group for a filter dimension. */
function ChipGroup({
  items,
  selected,
  onToggle,
  render,
}: {
  items: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  render?: (v: string) => string;
}) {
  if (!items.length) return <span className="text-xs text-muted-foreground">none yet</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((v) => {
        const on = selected.has(v);
        return (
          <button
            key={v}
            onClick={() => onToggle(v)}
            className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
              on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {render ? render(v) : v}
          </button>
        );
      })}
    </div>
  );
}

export function AskPanel() {
  const { activeProjectId, modelId } = useWorkspace();
  const { data } = useSources(activeProjectId);
  const { data: graph } = useGraph(activeProjectId);
  const modelUsagePolicy = useModelUsagePolicy(activeProjectId);

  const preview = usePreviewContext();
  const saveOutput = useSaveOutput(activeProjectId);
  const ablation = useAblation();

  const [outputType, setOutputType] = useState<GenerateOutputType>("answer");
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<AskMode>("auto");
  const [advanced, setAdvanced] = useState(false);
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [authors, setAuthors] = useState<Set<string>>(new Set());
  const [gms, setGms] = useState<Set<string>>(new Set());
  const [srcs, setSrcs] = useState<Set<string>>(new Set());
  const [uses, setUses] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AskEntry | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [detailed, setDetailed] = useState(false);
  const [history, setHistory] = useState<AskEntry[]>([]);
  const [streaming, setStreaming] = useState(false);

  // Load persisted history when the project becomes available / changes, and
  // restore the most recent run so switching tabs or reloading doesn't lose it.
  // (Set-state-during-render, guarded — the sanctioned alternative to an effect;
  // runs client-side only since the guard never trips during SSR.)
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (activeProjectId !== loadedFor) {
    setLoadedFor(activeProjectId);
    const h = readHistory(activeProjectId);
    setHistory(h);
    setResult(h[0] ?? null);
    setRequest(h[0]?.request ?? "");
    if (h[0]) setOutputType(h[0].outputType);
    setPreviewData(null);
  }

  const sources = data?.sources ?? [];
  const categories = data?.categories ?? [];
  const games = (graph?.entities ?? []).filter((e) => e.type === "game");
  const mentions = parseMentions(request);
  const busy = streaming;

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, v: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function buildScope(): AskScope {
    const scope: AskScope = { mode };
    if (cats.size) scope.categories = [...cats];
    if (tags.size) scope.tags = [...tags];
    if (authors.size) scope.authors = [...authors];
    if (gms.size) scope.games = [...gms];
    if (srcs.size) scope.sourceIds = [...srcs];
    if (uses.size) scope.uses = [...uses];
    return scope;
  }

  function confirmPaid(): boolean {
    if (!needsPaidConfirm(modelUsagePolicy, modelId)) return true;
    return window.confirm(
      `${getModelOption(modelId).label} is a paid model and will use API credits. Continue?`,
    );
  }

  async function onPreview() {
    if (!activeProjectId || !request.trim()) return;
    try {
      const p = await preview.mutateAsync({ projectId: activeProjectId, question: request, scope: buildScope() });
      setPreviewData(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed.");
    }
  }

  function pushHistory(entry: AskEntry) {
    if (!activeProjectId) return;
    const next = [entry, ...history.filter((h) => h.id !== entry.id)].slice(0, HISTORY_MAX);
    setHistory(next);
    writeHistory(activeProjectId, next);
  }

  function restore(entry: AskEntry) {
    setResult(entry);
    setRequest(entry.request);
    setOutputType(entry.outputType);
    setPreviewData(null);
  }

  function clearHistory() {
    if (!activeProjectId) return;
    setHistory([]);
    writeHistory(activeProjectId, []);
  }

  async function run(type: GenerateOutputType) {
    if (!activeProjectId || !request.trim() || !confirmPaid()) return;
    setPreviewData(null);
    const createdAt = new Date().toISOString();
    const id = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const scope = buildScope();
    const req = request;

    // Seed an empty result so the answer panel appears and fills as tokens arrive.
    setResult({
      id,
      request: req,
      answer: "",
      retrieved: [],
      used: [],
      mode: scope.mode,
      retrievalRunId: "",
      outputType: type,
      modelId,
      createdAt,
    });
    setStreaming(true);

    let answer = "";
    let retrieved: RetrievedItem[] = [];
    let used: { id: string; title: string }[] = [];
    let modeUsed = scope.mode as string;
    let retrievalRunId = "";

    try {
      const res = await fetch("/api/ask/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, question: req, modelId, scope, outputType: type }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as {
            type: string;
            text?: string;
            message?: string;
            mode?: string;
            retrieved?: RetrievedItem[];
            used?: { id: string; title: string }[];
            retrievalRunId?: string;
          };
          if (ev.type === "meta") {
            retrieved = ev.retrieved ?? [];
            used = ev.used ?? [];
            modeUsed = ev.mode ?? modeUsed;
            setResult((prev) => (prev ? { ...prev, retrieved, used, mode: modeUsed } : prev));
          } else if (ev.type === "delta") {
            answer += ev.text ?? "";
            setResult((prev) => (prev ? { ...prev, answer } : prev));
          } else if (ev.type === "done") {
            retrievalRunId = ev.retrievalRunId ?? "";
          } else if (ev.type === "error") {
            throw new Error(ev.message ?? "Ask failed.");
          }
        }
      }
      const entry: AskEntry = {
        id,
        request: req,
        answer,
        retrieved,
        used,
        mode: modeUsed,
        retrievalRunId,
        outputType: type,
        modelId,
        createdAt,
      };
      setResult(entry);
      pushHistory(entry);
      if (type !== "answer") toast.success("Output generated and saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
      // Drop the empty seeded result on failure (keep any partial text otherwise).
      if (!answer) setResult(null);
    } finally {
      setStreaming(false);
    }
  }

  async function onSaveAnswer() {
    if (!result || !activeProjectId) return;
    try {
      await saveOutput.mutateAsync({
        type: result.outputType,
        title: `${result.outputType}: ${result.request.slice(0, 60)}`,
        markdown: result.answer,
        request: result.request,
        modelId: result.modelId,
        retrievalRunId: result.retrievalRunId || undefined,
        sourceIds: result.used.map((u) => u.id),
      });
      toast.success("Saved to outputs/.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed.");
    }
  }

  async function onAblation() {
    if (!activeProjectId || !request.trim() || !confirmPaid()) return;
    try {
      const r = await ablation.mutateAsync({
        projectId: activeProjectId,
        question: request,
        modelId,
        outputType: outputType === "answer" ? "game_concept" : outputType,
      });
      toast.success(`Ablation done: ${r.runs.length} variants saved under outputs/evals/${r.evalId}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ablation failed.");
    }
  }

  const activeFilters = [
    ...[...cats].map((c) => ({ k: `cat:${c}`, label: c, clear: () => toggle(setCats, c) })),
    ...[...tags].map((t) => ({ k: `tag:${t}`, label: `#${tagLabel(t)}`, clear: () => toggle(setTags, t) })),
    ...[...authors].map((a) => ({ k: `au:${a}`, label: `@${a}`, clear: () => toggle(setAuthors, a) })),
    ...[...gms].map((g) => ({
      k: `game:${g}`,
      label: games.find((x) => x.slug === g)?.name ?? g,
      clear: () => toggle(setGms, g),
    })),
    ...[...srcs].map((s) => ({
      k: `src:${s}`,
      label: sources.find((x) => x.id === s)?.title.slice(0, 24) ?? s,
      clear: () => toggle(setSrcs, s),
    })),
    ...[...uses].map((u) => ({ k: `use:${u}`, label: `use:${u}`, clear: () => toggle(setUses, u) })),
  ];

  const detected = [
    ...mentions.authors.map((a) => `Author: @${a}`),
    ...mentions.tags.map((t) => `Tag: #${t}`),
    ...mentions.games.map((g) => `Game: ${g}`),
    ...mentions.uses.map((u) => `Use: ${u}`),
    ...mentions.categories.map((c) => `Category: ${c}`),
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Ask your learned project knowledge. <strong>Auto</strong> uses the best matching summaries and
        transcript chunks. Narrow with filters only when needed.
      </p>

      {/* ── History (persisted per project) ── */}
      {history.length > 0 && (
        <details className="group rounded-md border bg-card">
          <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground select-none">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            Recent ({history.length})
            <button
              onClick={(e) => {
                e.preventDefault();
                clearHistory();
              }}
              className="ml-auto normal-case underline hover:text-foreground"
            >
              Clear
            </button>
          </summary>
          <div className="max-h-64 space-y-0.5 overflow-y-auto px-2 pb-2">
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => restore(h)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60 ${
                  result?.id === h.id ? "bg-muted/60" : ""
                }`}
              >
                <Badge variant="outline" className="shrink-0 font-normal">
                  {h.outputType}
                </Badge>
                <span className="min-w-0 flex-1 truncate">{h.request}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {h.createdAt.slice(5, 16).replace("T", " ")}
                </span>
              </button>
            ))}
          </div>
        </details>
      )}

      {/* ── Composer ── */}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="text-sm font-medium">What do you want from this knowledge base?</div>

        <div className="flex flex-wrap gap-1.5">
          {OUTPUT_TYPES.map((o) => (
            <button
              key={o.value}
              onClick={() => setOutputType(o.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                outputType === o.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <Textarea
          rows={4}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Ask a question or describe the output you want…"
          className="resize-y text-sm"
        />

        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setRequest(ex)}
              className="rounded-md border border-dashed px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted"
            >
              {ex}
            </button>
          ))}
        </div>

        {/* Detected inline filters */}
        {detected.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Detected:</span>
            {detected.map((d) => (
              <Badge key={d} variant="secondary" className="font-normal">
                {d}
              </Badge>
            ))}
          </div>
        )}

        {/* Context summary row */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          <span>
            Context: <span className="font-medium text-foreground">{MODE_LABEL[mode]}</span>
          </span>
          <span>·</span>
          <span>
            Scope:{" "}
            <span className="font-medium text-foreground">
              {activeFilters.length ? `${activeFilters.length} filter${activeFilters.length === 1 ? "" : "s"}` : "All knowledge"}
            </span>
          </span>
          <span>·</span>
          <span>
            {previewData
              ? `${previewData.summaryCount} summaries + ${previewData.chunkCount} chunks${
                  previewData.metadataCount ? ` + ${previewData.metadataCount} meta` : ""
                }`
              : "Context selected after Ask"}
          </span>
        </div>

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeFilters.map((f) => (
              <Badge key={f.k} variant="outline" className="gap-1 font-normal">
                {f.label}
                <button onClick={f.clear} className="hover:text-foreground" title="Remove">
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => run(outputType)} disabled={!request.trim() || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {outputType === "answer" ? "Ask" : `Generate ${OUTPUT_TYPES.find((o) => o.value === outputType)?.label}`}
          </Button>
          <Button variant="outline" onClick={onPreview} disabled={!request.trim() || preview.isPending}>
            {preview.isPending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
            Preview context
          </Button>
          <Button variant="ghost" onClick={() => setAdvanced((o) => !o)}>
            <ChevronRight className={`size-4 transition-transform ${advanced ? "rotate-90" : ""}`} />
            Advanced filters
          </Button>
        </div>

        {/* Advanced filters (collapsed by default) */}
        {advanced && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <Filter label="Mode">
              <div className="flex flex-wrap gap-1.5">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                      mode === m.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </Filter>
            <Filter label="Categories">
              <ChipGroup items={categories.map((c) => c.name)} selected={cats} onToggle={(v) => toggle(setCats, v)} />
            </Filter>
            <Filter label="Tags">
              <ChipGroup
                items={graph?.tags ?? []}
                selected={tags}
                onToggle={(v) => toggle(setTags, v)}
                render={tagLabel}
              />
            </Filter>
            <Filter label="Authors">
              <ChipGroup
                items={(graph?.authors ?? []).map((a) => a.slug)}
                selected={authors}
                onToggle={(v) => toggle(setAuthors, v)}
                render={(s) => `@${s}`}
              />
            </Filter>
            <Filter label="Games">
              <ChipGroup
                items={games.map((g) => g.slug)}
                selected={gms}
                onToggle={(v) => toggle(setGms, v)}
                render={(slug) => games.find((g) => g.slug === slug)?.name ?? slug}
              />
            </Filter>
            <Filter label="Sources">
              <ChipGroup
                items={sources.map((s) => s.id)}
                selected={srcs}
                onToggle={(v) => toggle(setSrcs, v)}
                render={(id) => sources.find((s) => s.id === id)?.title.slice(0, 28) ?? id}
              />
            </Filter>
            <Filter label="Use for">
              <ChipGroup items={USE_FOR} selected={uses} onToggle={(v) => toggle(setUses, v)} />
            </Filter>
          </div>
        )}
      </div>

      {/* ── Preview panel (no model) ── */}
      {previewData && !result && (
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Context preview (no model called)</span>
            <span className="text-xs text-muted-foreground">
              {MODE_LABEL[previewData.mode]} · {previewData.contextCharCount.toLocaleString()} chars
            </span>
          </div>
          <RetrievedList items={previewData.retrieved} detailed={detailed} />
        </div>
      )}

      {/* ── Result: Answer + Retrieved Context ── */}
      {result && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Badge variant="secondary" className="font-normal">{result.outputType}</Badge>
              <span>· {result.modelId}</span>
              <span>· {MODE_LABEL[result.mode] ?? result.mode}</span>
              <span>· {result.createdAt.slice(0, 16).replace("T", " ")}</span>
              {streaming && (
                <span className="flex items-center gap-1 text-primary">
                  <Loader2 className="size-3 animate-spin" /> generating…
                </span>
              )}
            </div>
            {streaming && !result.answer ? (
              <p className="text-sm text-muted-foreground">Retrieving context and starting the model…</p>
            ) : (
              <Markdown>{result.answer}</Markdown>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button size="sm" variant="outline" disabled={!result.answer} onClick={() => navigator.clipboard.writeText(result.answer).then(() => toast.success("Copied."))}>
                <Copy className="size-3.5" /> Copy
              </Button>
              <Button size="sm" variant="outline" onClick={onSaveAnswer} disabled={saveOutput.isPending || busy || !result.answer}>
                {saveOutput.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Save as Output
              </Button>
              {result.outputType !== "prototype_spec" && (
                <Button size="sm" variant="outline" onClick={() => run("prototype_spec")} disabled={busy}>
                  <Sparkles className="size-3.5" /> Turn into Prototype Spec
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onAblation} disabled={ablation.isPending || busy}>
                {ablation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
                Run Ablation
              </Button>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Retrieved context</span>
              <button
                onClick={() => setDetailed((d) => !d)}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                {detailed ? "Compact" : "Detailed"}
              </button>
            </div>
            {result.retrieved.length ? (
              <RetrievedList items={result.retrieved} detailed={detailed} />
            ) : (
              <p className="text-xs text-muted-foreground">No context items recorded.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-20 shrink-0 pt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Human reason a context item matched, derived from its match type. */
function whyMatched(item: RetrievedItem): string {
  switch (item.matchType) {
    case "source_summary":
      return "learned summary (ranked by relevance/utility/use-for)";
    case "fts":
      return "transcript keyword match";
    case "meta_fts":
      return "matched on tags / key terms / synonyms";
    default:
      return item.matchType;
  }
}

const CONTEXT_LABEL: Record<string, string> = {
  summary: "learned summary",
  chunk: "raw transcript chunk",
  metadata: "metadata match",
};

function RetrievedList({ items, detailed }: { items: RetrievedItem[]; detailed: boolean }) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="rounded-md border bg-muted/20 p-2 text-xs">
          <div className="flex items-start gap-1.5">
            <span className="min-w-0 flex-1 truncate font-medium">{it.title}</span>
            <Badge variant="outline" className="shrink-0 font-normal">
              {it.matchType}
            </Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
            {it.category && <span>{it.category}</span>}
            {it.relevance != null && <span>· {it.relevance}/100</span>}
            {it.utility && <span>· {it.utility}</span>}
            {it.contextType && <span>· {CONTEXT_LABEL[it.contextType] ?? it.contextType}</span>}
          </div>
          {detailed && <div className="mt-1 text-muted-foreground/80">Why: {whyMatched(it)}</div>}
        </div>
      ))}
    </div>
  );
}
