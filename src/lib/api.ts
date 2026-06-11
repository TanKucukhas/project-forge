"use client";

/** Client-side fetch helpers + TanStack Query hooks for the v1 pipeline. */
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
  type QueryClient,
} from "@tanstack/react-query";
import {
  parseSettings,
  DEFAULT_MODEL_USAGE_POLICY,
  type ModelUsagePolicy,
  type ProjectSettings,
} from "@/lib/settings";

export type Project = {
  id: string;
  title: string;
  goal: string;
  settings: string;
  createdAt: string;
  updatedAt: string;
};

export type Job = {
  id: string;
  kind: "capture" | "distill";
  status: "queued" | "running" | "done" | "error";
  label: string;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type Source = {
  id: string;
  projectId: string;
  type: string;
  title: string;
  url: string | null;
  author: string | null;
  channel: string | null;
  thumbnail: string | null;
  rawTextPath: string | null;
  summary: string;
  category: string | null;
  tags: string;
  viewCount: number | null;
  likeCount: number | null;
  relevance: number | null;
  credibility: number | null;
  distilledPath: string | null;
  status: string;
  utility: string | null;
  instructionHash: string | null;
  goalHash: string | null;
  taxonomyHash: string | null;
  distilledAt: string | null;
  model: string | null;
  metadataJson: string | null;
  createdAt: string;
};

export type LearningDoc = {
  id: string;
  projectId: string;
  sourceId: string | null;
  kind: string;
  title: string;
  markdownPath: string;
  summary: string;
  category: string | null;
  relevance: number | null;
  utility: string | null;
  instructionHash: string | null;
  goalHash: string | null;
  taxonomyHash: string | null;
  goalVersion: number | null;
  learnSchemaVersion: number | null;
  distilledAt: string | null;
  model: string | null;
  parseStatus: string | null;
  metadataJson: string | null;
  createdAt: string;
};

/** Current distill hashes for the active project — UI compares per-doc hashes to
 *  these to flag stale docs (see /api/sources). */
export type CurrentDistill = {
  instructionHash: string;
  goalHash: string;
  taxonomyHash: string;
  learnSchemaVersion: number;
};

export type SourcesResponse = {
  projectId: string;
  sources: Source[];
  docs: LearningDoc[];
  categories: Category[];
  current: CurrentDistill;
};

/** Parsed learned-document payload (frontmatter split from body). */
export type DocResponse = {
  markdown: string;
  frontmatter: Record<string, unknown>;
  body: string;
};

export type Category = { id: string; projectId: string; name: string };

export type Snapshot = {
  id: string;
  title: string;
  type: string;
  url: string | null;
  author: string | null;
  channel: string | null;
  thumbnail: string | null;
  description: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  credibility: number | null;
  relevance: number | null;
  category: string | null;
  publishedAt: string | null;
  keywords: string[];
  transcriptFetched: boolean;
  content: string;
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

// ── Polling helpers ──────────────────────────────────────────────────────────

const SETTLE_MS = 6000;

function shouldPoll(jobs: Job[] | undefined): boolean {
  if (!jobs?.length) return false;
  if (jobs.some((j) => j.status === "queued" || j.status === "running")) return true;
  const newest = jobs.reduce((max, j) => Math.max(max, Date.parse(j.updatedAt) || 0), 0);
  return Date.now() - newest < SETTLE_MS;
}

function jobsFromCache(qc: QueryClient): Job[] | undefined {
  return qc.getQueryData<JobsResponse>(["jobs"])?.jobs;
}

// ── Projects ─────────────────────────────────────────────────────────────────

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => jsonFetch<{ projects: Project[] }>("/api/projects").then((r) => r.projects),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; goal: string; settings: Partial<ProjectSettings> }) =>
      jsonFetch<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify(body),
      }).then((r) => r.project),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      id: string;
      title?: string;
      goal?: string;
      settings?: Partial<ProjectSettings>;
    }) =>
      jsonFetch<{ project: Project }>("/api/projects", {
        method: "PATCH",
        body: JSON.stringify(body),
      }).then((r) => r.project),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

/** The active project's full settings, resolved from cached projects. */
export function useProjectSettings(projectId: string | null): ProjectSettings {
  const { data: projects } = useProjects();
  const project = projectId ? projects?.find((p) => p.id === projectId) : undefined;
  return parseSettings(project?.settings);
}

/** The active project's model-usage policy, resolved from cached projects. */
export function useModelUsagePolicy(projectId: string | null): ModelUsagePolicy {
  const { data: projects } = useProjects();
  if (!projectId) return DEFAULT_MODEL_USAGE_POLICY;
  const project = projects?.find((p) => p.id === projectId);
  return parseSettings(project?.settings).modelUsagePolicy;
}

// ── Jobs / sources ───────────────────────────────────────────────────────────

export type JobStats = {
  queued: number;
  running: number;
  done: number;
  error: number;
  total: number;
  avgMs: number;
  etaMs: number;
};
export type JobsResponse = { jobs: Job[]; stats: JobStats };

const fetchJobs = () => jsonFetch<JobsResponse>("/api/jobs");
const jobsRefetch = (q: { state: { data?: JobsResponse } }) =>
  shouldPoll(q.state.data?.jobs) ? 1000 : false;

/** The activity list (capped, running surfaced first). */
export function useJobs() {
  return useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    select: (d) => d.jobs,
    refetchInterval: jobsRefetch,
  });
}

/** True totals + empirical ETA across the whole queue (same cache as useJobs). */
export function useJobStats() {
  return useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    select: (d) => d.stats,
    refetchInterval: jobsRefetch,
  });
}

/** Dismiss a finished/errored job (acknowledge) so it leaves the activity list. */
export function useDismissJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      jsonFetch<{ ok: boolean }>(`/api/jobs?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

/** Cancel all not-yet-started (queued) jobs; the running one finishes. */
export function useCancelQueued() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      jsonFetch<{ ok: boolean; cancelled: number }>("/api/jobs?scope=queued", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useSources(projectId: string | null) {
  const qc = useQueryClient();
  useJobs();
  return useQuery({
    queryKey: ["sources", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      jsonFetch<SourcesResponse>(
        `/api/sources?projectId=${encodeURIComponent(projectId!)}`,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: () => (shouldPoll(jobsFromCache(qc)) ? 1500 : false),
  });
}

export function useSnapshot(sourceId: string | null) {
  return useQuery({
    queryKey: ["snapshot", sourceId],
    enabled: Boolean(sourceId),
    queryFn: () => jsonFetch<Snapshot>(`/api/snapshot?id=${encodeURIComponent(sourceId!)}`),
  });
}

export function useDoc(markdownPath: string | null) {
  return useQuery({
    queryKey: ["doc", markdownPath],
    enabled: Boolean(markdownPath),
    queryFn: () =>
      jsonFetch<DocResponse>(`/api/docs?path=${encodeURIComponent(markdownPath!)}`),
  });
}

// ── Mutations: capture / distill / ask ───────────────────────────────────────

export type ChannelVideo = {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  durationSeconds: number | null;
  uploadDate: string | null;
  viewCount: number | null;
  likeCount: number | null;
};

export type ChannelPreview = {
  videos: ChannelVideo[];
  hasMore: boolean;
  statsLoaded: number;
  offset: number;
};

/** Preview a page of a channel's videos (no import) for the picker / infinite scroll. */
export function useChannelPreview() {
  return useMutation({
    mutationFn: (body: {
      url: string;
      offset?: number;
      count?: number;
      withStats?: boolean;
      sort?: "popular" | "latest" | "oldest";
    }) =>
      jsonFetch<ChannelPreview>("/api/channel/preview", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}

export function useSettingsStatus() {
  return useQuery({
    queryKey: ["settings-status"],
    queryFn: () =>
      jsonFetch<{ openai: boolean; gemini: boolean; claudeCli: boolean; codexCli: boolean }>(
        "/api/settings/status",
      ),
  });
}

/** Preview a single video (metadata only, no capture). */
export function useVideoPreview() {
  return useMutation({
    mutationFn: (url: string) =>
      jsonFetch<{ video: ChannelVideo }>("/api/video/preview", {
        method: "POST",
        body: JSON.stringify({ url }),
      }).then((r) => r.video),
  });
}

export type VideoStats = Record<string, { viewCount: number | null; likeCount: number | null }>;

/** Fetch view/like counts for a batch of video ids (progressive enrichment). */
export function useChannelStats() {
  return useMutation({
    mutationFn: (ids: string[]) =>
      jsonFetch<{ stats: VideoStats }>("/api/channel/stats", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }).then((r) => r.stats),
  });
}

export function useCapture(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      url?: string;
      urls?: string[];
      notes?: string;
      title?: string;
      channelLimit?: number;
    }) =>
      jsonFetch<{ jobId?: string; channel?: boolean; batch?: boolean; count?: number }>(
        "/api/capture",
        { method: "POST", body: JSON.stringify({ ...body, projectId }) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["sources", projectId] });
    },
  });
}

/** Upload a PDF (multipart). The raw PDF is saved and its text extracted for indexing. */
export function useCapturePdf(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { file: File; title?: string }) => {
      const form = new FormData();
      form.append("projectId", projectId ?? "");
      form.append("file", body.file);
      if (body.title) form.append("title", body.title);
      // Don't set Content-Type — the browser adds the multipart boundary.
      const res = await fetch("/api/capture/pdf", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `Upload failed (${res.status})`);
      }
      return data as { jobId?: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["sources", projectId] });
    },
  });
}

export function useDistill(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { sourceId: string; modelId: string; instructions?: string }) =>
      jsonFetch<{ jobId: string }>("/api/distill", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["sources", projectId] });
    },
  });
}

/** Permanently delete a source (raw snapshot + any learned docs + DB rows). */
export function useDeleteSource(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) =>
      jsonFetch<{ success: boolean; id: string }>(
        `/api/sources?id=${encodeURIComponent(sourceId)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sources", projectId] });
      qc.invalidateQueries({ queryKey: ["graph", projectId] });
    },
  });
}

export type AskMode = "summaries" | "full" | "hybrid" | "auto";

export type AskScope = {
  mode: AskMode;
  sourceIds?: string[];
  category?: string;
  categories?: string[];
  tags?: string[];
  authors?: string[];
  games?: string[];
  uses?: string[];
};

export type RetrievedItem = {
  title: string;
  sourceId: string | null;
  matchType: string;
  rank?: number | null;
  category?: string | null;
  relevance?: number | null;
  utility?: string | null;
  contextType?: "summary" | "chunk" | "metadata";
};

export type AskResult = {
  answer: string;
  usedSources: { id: string; title: string }[];
  retrieved: RetrievedItem[];
  mode: string;
  retrievalRunId: string;
  contextCharCount: number;
};

export function useAsk() {
  return useMutation({
    mutationFn: (body: {
      projectId: string;
      question: string;
      modelId: string;
      scope: AskScope;
    }) => jsonFetch<AskResult>("/api/ask", { method: "POST", body: JSON.stringify(body) }),
  });
}

export type Author = { id: string; displayName: string; slug: string };
export type Entity = { id: string; type: string; name: string; slug: string };

/** Authors + entities (games/studios/people) + tags for the active project —
 *  drives the Ask filter pickers. Polls alongside sources. */
export function useGraph(projectId: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["graph", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      jsonFetch<{ authors: Author[]; entities: Entity[]; tags: string[] }>(
        `/api/graph?projectId=${encodeURIComponent(projectId!)}`,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: () => (shouldPoll(jobsFromCache(qc)) ? 2000 : false),
  });
}

// ── Generate / preview / outputs (Ask command center) ────────────────────────

export type GenerateOutputType =
  | "answer"
  | "game_concept"
  | "gdd"
  | "prototype_spec"
  | "technical_spec"
  | "agent_build_prompt"
  | "evaluation_checklist"
  | "visualization_prompt";

export type PreviewResult = {
  mode: string;
  contextCharCount: number;
  retrieved: RetrievedItem[];
  used: { id: string; title: string }[];
  targetCount: number | null;
  summaryCount: number;
  chunkCount: number;
  metadataCount: number;
};

/** Dry-run retrieval — shows what context WOULD be used, no model call. */
export function usePreviewContext() {
  return useMutation({
    mutationFn: (body: { projectId: string; question: string; scope: AskScope }) =>
      jsonFetch<PreviewResult>("/api/ask/preview", { method: "POST", body: JSON.stringify(body) }),
  });
}

export type SmartScopeResult = {
  sourceIds: string[];
  reason: string;
  selected: { id: string; title: string; category: string | null; tokens: number }[];
  totals: {
    allCount: number;
    allTokens: number;
    selectedCount: number;
    selectedTokens: number;
  };
};

/** Smart Context pre-pass — ONE cheap model call that picks relevant sources
 *  from the catalog (titles/metadata only) and reports the token trade-off
 *  (everything vs. the picked subset). User-triggered; never call automatically. */
export function useSmartScope() {
  return useMutation({
    mutationFn: (body: { projectId: string; question: string; modelId: string }) =>
      jsonFetch<SmartScopeResult>("/api/ask/smart-scope", { method: "POST", body: JSON.stringify(body) }),
  });
}

export type GenerateResult = {
  markdownPath: string;
  output: string;
  retrievalRunId: string;
  mode: string;
  used: { id: string; title: string }[];
  retrieved: RetrievedItem[];
  contextCharCount: number;
};

/** Generate a structured output (game concept / GDD / spec / agent prompt …). */
export function useGenerateOutput(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      outputType: GenerateOutputType;
      request: string;
      modelId: string;
      scope: AskScope;
    }) =>
      jsonFetch<GenerateResult>("/api/generate/output", {
        method: "POST",
        body: JSON.stringify({ ...body, projectId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outputs", projectId] }),
  });
}

/** Save an Ask answer / generated text as a durable output. */
export function useSaveOutput(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      type: string;
      title: string;
      markdown: string;
      request?: string;
      modelId?: string;
      retrievalRunId?: string;
      sourceIds?: string[];
    }) =>
      jsonFetch<{ outputId: string; markdownPath: string }>("/api/outputs", {
        method: "POST",
        body: JSON.stringify({ ...body, projectId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outputs", projectId] }),
  });
}

export type AblationRun = {
  variant: string;
  retrievalRunId: string;
  outputPath: string;
  contextCharCount: number;
  sources: number;
};

/** Run the distilled/raw/hybrid ablation for one request. */
export function useAblation() {
  return useMutation({
    mutationFn: (body: {
      projectId: string;
      question: string;
      modelId: string;
      outputType?: GenerateOutputType;
      sourceIds?: string[];
      category?: string;
    }) =>
      jsonFetch<{ evalId: string; outputType: string; runs: AblationRun[] }>(
        "/api/eval/ablation",
        { method: "POST", body: JSON.stringify(body) },
      ),
  });
}
