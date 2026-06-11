"use client";

/**
 * Chat — multi-turn conversation over the project's knowledge base.
 *
 * A chat is a thread you continue: each turn runs fresh scoped retrieval on the
 * latest question PLUS sends the prior turns as conversation history (wired into
 * `POST /api/ask/stream` `history`). No activeChat → a centered new-chat hero;
 * selecting a chat → the thread with a composer pinned at the bottom.
 *
 * Retrieval, scoping, streaming, and the evidence cards are the same machinery
 * Ask uses — this is the conversational presentation layer on top. Threads are
 * persisted per project to localStorage via `src/lib/chat-store.ts`.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, Copy, ChevronRight, MessagesSquare, X, SlidersHorizontal } from "lucide-react";
import { useWorkspace } from "@/lib/store";
import {
  useModelUsagePolicy,
  useSources,
  useGraph,
  type RetrievedItem,
  type GenerateOutputType,
  type AskScope,
  type AskMode,
} from "@/lib/api";
import { needsPaidConfirm } from "@/lib/settings";
import { getModelOption } from "@/lib/ai/models";
import { tagLabel } from "@/lib/taxonomy";
import { getChat, createChat, appendTurn, type Chat, type ChatTurn } from "@/lib/chat-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/markdown";
import { RetrievedList, MODE_LABEL, MODES, ChipGroup } from "./ask-panel";

const OUTPUT_TYPES: { value: GenerateOutputType; label: string }[] = [
  { value: "answer", label: "Answer" },
  { value: "game_concept", label: "Game Concept" },
  { value: "gdd", label: "GDD" },
  { value: "prototype_spec", label: "Prototype Spec" },
  { value: "technical_spec", label: "Technical Spec" },
  { value: "agent_build_prompt", label: "Agent Prompt" },
  { value: "evaluation_checklist", label: "Evaluate" },
];

const EXAMPLES = [
  "What are the strongest design principles in this knowledge base?",
  "Draft a game concept from the best mechanics I've learned",
  "Evaluate this idea against the anti-patterns I captured",
];

function newTurn(request: string, outputType: GenerateOutputType, modelId: string): ChatTurn {
  return {
    id: `turn-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    request,
    answer: "",
    retrieved: [],
    used: [],
    mode: "auto",
    retrievalRunId: "",
    outputType,
    modelId,
    createdAt: new Date().toISOString(),
  };
}

export function ChatPanel() {
  const { activeProjectId, activeChatId, setActiveChat, bumpChats, modelId } = useWorkspace();
  const modelUsagePolicy = useModelUsagePolicy(activeProjectId);
  const { data } = useSources(activeProjectId);
  const { data: graph } = useGraph(activeProjectId);

  const [current, setCurrent] = useState<Chat | null>(null);
  const [input, setInput] = useState("");
  const [outputType, setOutputType] = useState<GenerateOutputType>("answer");
  const [streamingTurn, setStreamingTurn] = useState<ChatTurn | null>(null);
  const [openEvidence, setOpenEvidence] = useState<Set<string>>(new Set());

  // Retrieval scope (source / author / topic selection, or Auto) — applied to
  // every turn in this chat. Same dimensions Ask exposes.
  const [mode, setMode] = useState<AskMode>("auto");
  const [advanced, setAdvanced] = useState(false);
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [authors, setAuthors] = useState<Set<string>>(new Set());
  const [gms, setGms] = useState<Set<string>>(new Set());
  const [srcs, setSrcs] = useState<Set<string>>(new Set());

  const sources = data?.sources ?? [];
  const categories = data?.categories ?? [];
  const games = (graph?.entities ?? []).filter((e) => e.type === "game");

  // Load the active chat when project/chat selection changes (guarded
  // set-during-render — the sanctioned alternative to an effect; see ask-panel).
  const loadKey = `${activeProjectId ?? ""}:${activeChatId ?? ""}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (loadKey !== loadedKey) {
    setLoadedKey(loadKey);
    setCurrent(activeChatId ? getChat(activeProjectId, activeChatId) : null);
    setStreamingTurn(null);
    setInput("");
  }

  const streaming = streamingTurn != null;
  const turns = (current?.turns ?? []).concat(streamingTurn ? [streamingTurn] : []);
  const isHero = !current && !streamingTurn;

  function confirmPaid(): boolean {
    if (!needsPaidConfirm(modelUsagePolicy, modelId)) return true;
    return window.confirm(
      `${getModelOption(modelId).label} is a paid model and will use API credits. Continue?`,
    );
  }

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
    return scope;
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
  ];

  function toggleEvidence(id: string) {
    setOpenEvidence((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send() {
    const req = input.trim();
    if (!activeProjectId || !req || streaming || !confirmPaid()) return;

    const scope = buildScope();
    const turn = { ...newTurn(req, outputType, modelId), mode: scope.mode };
    // History = the already-completed turns of this thread (latest question runs
    // fresh retrieval server-side).
    const history = (current?.turns ?? []).map((t) => ({ request: t.request, answer: t.answer }));

    setStreamingTurn(turn);
    setInput("");

    let answer = "";
    let retrieved: RetrievedItem[] = [];
    let used: { id: string; title: string }[] = [];
    let modeUsed = scope.mode as string;
    let retrievalRunId = "";

    try {
      const res = await fetch("/api/ask/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProjectId,
          question: req,
          modelId,
          scope,
          outputType,
          history,
        }),
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
            setStreamingTurn((prev) => (prev ? { ...prev, retrieved, used, mode: modeUsed } : prev));
          } else if (ev.type === "delta") {
            answer += ev.text ?? "";
            setStreamingTurn((prev) => (prev ? { ...prev, answer } : prev));
          } else if (ev.type === "done") {
            retrievalRunId = ev.retrievalRunId ?? "";
          } else if (ev.type === "error") {
            throw new Error(ev.message ?? "Ask failed.");
          }
        }
      }

      const finalTurn: ChatTurn = {
        ...turn,
        answer,
        retrieved,
        used,
        mode: modeUsed,
        retrievalRunId,
      };

      // Persist: new chat → create + select; existing → append.
      if (current) {
        const updated = appendTurn(activeProjectId, current.id, finalTurn);
        if (updated) setCurrent(updated);
      } else {
        const chat = createChat(activeProjectId, finalTurn);
        setActiveChat(chat.id);
        setLoadedKey(`${activeProjectId}:${chat.id}`); // pre-mark so the load guard doesn't reset
        setCurrent(chat);
      }
      bumpChats(); // refresh the sidebar chat list
      if (outputType !== "answer") toast.success("Output generated and saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
      setInput(req); // restore the question so it isn't lost
    } finally {
      setStreamingTurn(null);
    }
  }

  const composer = (
    <div className="space-y-2.5">
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
        rows={isHero ? 4 : 3}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={
          isHero
            ? "Ask a question or describe the output you want… (@author #tag game: use: filters work inline)"
            : "Continue the conversation…"
        }
        className="resize-y text-sm"
      />

      {/* Scope: source / author / topic selection, or Auto. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          Context: <span className="font-medium text-foreground">{MODE_LABEL[mode]}</span>
        </span>
        <span>·</span>
        <span>
          Scope:{" "}
          <span className="font-medium text-foreground">
            {activeFilters.length
              ? `${activeFilters.length} filter${activeFilters.length === 1 ? "" : "s"}`
              : "All knowledge"}
          </span>
        </span>
        <button
          onClick={() => setAdvanced((o) => !o)}
          className="ml-auto flex items-center gap-1 underline hover:text-foreground"
        >
          <SlidersHorizontal className="size-3" />
          {advanced ? "Hide scope" : "Choose scope"}
        </button>
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

      {advanced && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <ScopeRow label="Mode">
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
          </ScopeRow>
          <ScopeRow label="Topics">
            <ChipGroup items={categories.map((c) => c.name)} selected={cats} onToggle={(v) => toggle(setCats, v)} />
          </ScopeRow>
          <ScopeRow label="Tags">
            <ChipGroup items={graph?.tags ?? []} selected={tags} onToggle={(v) => toggle(setTags, v)} render={tagLabel} />
          </ScopeRow>
          <ScopeRow label="Authors">
            <ChipGroup
              items={(graph?.authors ?? []).map((a) => a.slug)}
              selected={authors}
              onToggle={(v) => toggle(setAuthors, v)}
              render={(s) => `@${s}`}
            />
          </ScopeRow>
          {games.length > 0 && (
            <ScopeRow label="Games">
              <ChipGroup
                items={games.map((g) => g.slug)}
                selected={gms}
                onToggle={(v) => toggle(setGms, v)}
                render={(slug) => games.find((g) => g.slug === slug)?.name ?? slug}
              />
            </ScopeRow>
          )}
          <ScopeRow label="Sources">
            <ChipGroup
              items={sources.map((s) => s.id)}
              selected={srcs}
              onToggle={(v) => toggle(setSrcs, v)}
              render={(id) => sources.find((s) => s.id === id)?.title.slice(0, 28) ?? id}
            />
          </ScopeRow>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={() => void send()} disabled={!input.trim() || streaming}>
          {streaming ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {outputType === "answer"
            ? current || streamingTurn
              ? "Send"
              : "Ask"
            : `Generate ${OUTPUT_TYPES.find((o) => o.value === outputType)?.label}`}
        </Button>
        <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter</span>
      </div>
    </div>
  );

  // ── New-chat hero ──
  if (isHero) {
    return (
      <div className="mx-auto flex h-full max-w-2xl flex-col justify-center p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-primary/10">
            <MessagesSquare className="size-5 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">What do you want from this knowledge base?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask anything, or generate a build-ready output. Each turn retrieves fresh evidence.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">{composer}</div>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setInput(ex)}
              className="rounded-md border border-dashed px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Thread view ──
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
        {turns.map((t) => {
          const live = streamingTurn?.id === t.id;
          const showEvidence = openEvidence.has(t.id);
          return (
            <div key={t.id} className="space-y-2.5">
              {/* Question bubble */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-3.5 py-2 text-sm">
                  {t.request}
                </div>
              </div>

              {/* Answer */}
              <div className="space-y-2 rounded-2xl rounded-bl-sm border bg-card p-3.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="font-normal">{t.outputType}</Badge>
                  <span>· {t.modelId}</span>
                  {t.mode && <span>· {MODE_LABEL[t.mode] ?? t.mode}</span>}
                  {live && (
                    <span className="flex items-center gap-1 text-primary">
                      <Loader2 className="size-3 animate-spin" /> generating…
                    </span>
                  )}
                </div>
                {live && !t.answer ? (
                  <p className="text-sm text-muted-foreground">Retrieving context and starting the model…</p>
                ) : (
                  <Markdown>{t.answer}</Markdown>
                )}
                <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!t.answer}
                    onClick={() => navigator.clipboard.writeText(t.answer).then(() => toast.success("Copied."))}
                  >
                    <Copy className="size-3.5" /> Copy
                  </Button>
                  {t.retrieved.length > 0 && (
                    <button
                      onClick={() => toggleEvidence(t.id)}
                      className="flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground"
                    >
                      <ChevronRight className={`size-3.5 transition-transform ${showEvidence ? "rotate-90" : ""}`} />
                      {showEvidence ? "Hide" : "Show"} retrieved context ({t.retrieved.length})
                    </button>
                  )}
                </div>
                {showEvidence && t.retrieved.length > 0 && (
                  <div className="border-t pt-2.5">
                    <RetrievedList items={t.retrieved} detailed={false} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom composer to continue */}
      <div className="border-t bg-card/50 p-4">
        <div className="mx-auto max-w-3xl">{composer}</div>
      </div>
    </div>
  );
}

/** One labelled row inside the scope panel. */
function ScopeRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-16 shrink-0 pt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
