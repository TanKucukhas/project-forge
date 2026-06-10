"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Video,
  FileText,
  Globe,
  StickyNote,
  Sparkles,
  Eye,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Tv,
  PlayCircle,
  Settings,
  FileUp,
  Plus,
} from "lucide-react";
import { useWorkspace } from "@/lib/store";
import {
  useCapture,
  useCapturePdf,
  useDistill,
  useAsk,
  useSources,
  useJobs,
  useSnapshot,
  useDoc,
  useModelUsagePolicy,
  useProjectSettings,
  useUpdateProject,
  useChannelPreview,
  useChannelStats,
  useVideoPreview,
  type Source,
  type AskResult,
  type ChannelVideo,
} from "@/lib/api";
import { needsPaidConfirm, TRANSCRIPT_LANGUAGE_OPTIONS } from "@/lib/settings";
import { ProjectsPage } from "./projects-page";
import { GlobalSettings } from "./global-settings";
import { LearnInstructions } from "./learn-instructions";
import { getModelOption } from "@/lib/ai/models";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Markdown } from "@/components/markdown";
import type { CenterMode } from "@/lib/types";

const TYPE_ICON: Record<string, typeof FileText> = {
  youtube: Video,
  website: Globe,
  article: Globe,
  note: StickyNote,
  pdf: FileText,
};

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "processed" || status === "done" || status === "distilled") return "default";
  if (status === "failed" || status === "error") return "destructive";
  return "secondary";
}

function looksLikeChannel(s: string): boolean {
  const t = s.trim();
  if (/[?&]list=/.test(t) || /\/playlist\?/.test(t)) return true; // a playlist
  if (/\/watch\?|youtu\.be\//.test(t)) return false;
  return /youtube\.com\/(@|channel\/|c\/|user\/)/.test(t) || /\/videos\/?$/.test(t) || t.startsWith("@");
}

function looksLikeVideo(s: string): boolean {
  const t = s.trim();
  return /\/watch\?v=|youtu\.be\//.test(t) && !looksLikeChannel(t);
}

function videoIdOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const parts = u.pathname.split("/").filter(Boolean);
    if (["embed", "shorts", "live"].includes(parts[0])) return parts[1] ?? null;
  } catch {
    /* not a URL */
  }
  return null;
}


export function CenterPanel() {
  const {
    activeProjectId,
    centerMode,
    setCenterMode,
    modelId,
    preview,
    previewDoc,
    previewSnapshot,
    closePreview,
  } = useWorkspace();
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [channelVideos, setChannelVideos] = useState<ChannelVideo[] | null>(null);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const [channelSort, setChannelSort] = useState<"popular" | "latest" | "oldest">("popular");
  const [channelHasMore, setChannelHasMore] = useState(false);
  const [channelStatsLoaded, setChannelStatsLoaded] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  // Persisted defaults (window guard for SSR).
  const [autoLoad, setAutoLoad] = useState<boolean>(
    () => typeof window === "undefined" || window.localStorage.getItem("pf.channelAutoLoad") !== "false",
  );
  const [popularCount, setPopularCount] = useState<number>(() => {
    if (typeof window === "undefined") return 200;
    const v = Number(window.localStorage.getItem("pf.popularCount"));
    return Number.isFinite(v) && v > 0 ? v : 200;
  });
  const loadingRef = useRef(false);
  const enrichTokenRef = useRef(0);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const channelStats = useChannelStats();
  const videoPreviewQ = useVideoPreview();
  const [videoPreview, setVideoPreview] = useState<ChannelVideo | null>(null);
  const PAGE = 30;
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState("");
  const [askMode, setAskMode] = useState<"summaries" | "full">("summaries");
  const [askScope, setAskScope] = useState<string>("all"); // "all" | "cat:<name>" | "src:<id>"
  const [askResult, setAskResult] = useState<AskResult | null>(null);

  const capture = useCapture(activeProjectId);
  const capturePdf = useCapturePdf(activeProjectId);
  const distill = useDistill(activeProjectId);
  const ask = useAsk();
  const channelPreview = useChannelPreview();
  const updateProject = useUpdateProject();
  const modelUsagePolicy = useModelUsagePolicy(activeProjectId);
  const { transcriptLanguage } = useProjectSettings(activeProjectId);

  // Guardrail: under "confirm before paid", a manual action with a paid model
  // pauses for an explicit OK. Capture never runs paid models, so it's exempt.
  function confirmPaid(): boolean {
    if (!needsPaidConfirm(modelUsagePolicy, modelId)) return true;
    return window.confirm(
      `${getModelOption(modelId).label} is a paid model and will use API credits. Continue?`,
    );
  }
  const { data } = useSources(activeProjectId);
  const { data: jobs } = useJobs();

  const { data: docMarkdown, isLoading: docLoading } = useDoc(
    preview?.kind === "doc" ? preview.path : null,
  );
  const { data: snapshot, isLoading: snapLoading } = useSnapshot(
    preview?.kind === "snapshot" ? preview.sourceId : null,
  );

  const sources = data?.sources ?? [];
  const categories = data?.categories ?? [];
  const distilledSources = sources.filter((s) => s.status === "distilled");
  const isChannel = looksLikeChannel(sourceUrl);
  const isVideo = looksLikeVideo(sourceUrl);
  const canCapture = (sourceUrl.trim().length > 0 || notes.trim().length > 0) && !capture.isPending;
  const activeCaptureJobs =
    jobs?.filter((j) => j.kind === "capture" && (j.status === "queued" || j.status === "running")) ??
    [];

  // Video ids already imported into this project — to dedupe channel/playlist picks.
  const existingVideoIds = new Set(
    sources.map((s) => videoIdOf(s.url)).filter((id): id is string => Boolean(id)),
  );
  // The server returns videos already in the chosen YouTube order (Popular tab,
  // Latest, or Oldest) — display as-is.
  const displayedVideos = channelVideos;
  const selectableCount = displayedVideos?.filter((v) => !existingVideoIds.has(v.id)).length ?? 0;

  async function onCapture() {
    try {
      await capture.mutateAsync({
        url: sourceUrl.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setSourceUrl("");
      setNotes("");
      setCaptureOpen(false);
      toast.success("Capturing source…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Capture failed.");
    }
  }

  async function onPickPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      toast.error("Please choose a PDF file.");
      return;
    }
    try {
      await capturePdf.mutateAsync({ file });
      toast.success(`Uploading "${file.name}"…`);
      setCaptureOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF upload failed.");
    }
  }

  // Progressively fill in view/like counts for a freshly-listed page, merging
  // each small batch as it returns. `token` guards against stale merges after
  // the user changes sort / re-previews.
  async function enrichVideos(videos: ChannelVideo[], token: number) {
    const ids = videos.map((v) => v.id);
    for (let i = 0; i < ids.length; i += 24) {
      if (enrichTokenRef.current !== token) return;
      let stats;
      try {
        stats = await channelStats.mutateAsync(ids.slice(i, i + 24));
      } catch {
        continue;
      }
      if (enrichTokenRef.current !== token) return;
      setChannelVideos(
        (prev) =>
          prev?.map((v) =>
            stats[v.id] ? { ...v, viewCount: stats[v.id].viewCount, likeCount: stats[v.id].likeCount } : v,
          ) ?? null,
      );
      setChannelStatsLoaded((n) => n + Object.values(stats).filter((s) => s.viewCount != null).length);
    }
  }

  // Fresh load (page 1). The list (in correct YouTube order) returns fast; view
  // counts fill in afterward. Popular fetches the whole set at once (YouTube caps
  // it at 200; the count is user-configurable in the gear).
  async function onPreviewVideo() {
    setPlayingId(null);
    try {
      setVideoPreview(await videoPreviewQ.mutateAsync(sourceUrl.trim()));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that video.");
    }
  }

  async function onImportVideo() {
    if (!videoPreview) return;
    try {
      await capture.mutateAsync({ url: videoPreview.url });
      toast.success("Capturing source…");
      setVideoPreview(null);
      setSourceUrl("");
      setCaptureOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Capture failed.");
    }
  }

  async function onPreviewChannel(opts?: { sort?: "popular" | "latest" | "oldest" }) {
    const sort = opts?.sort ?? channelSort;
    const count = sort === "popular" ? popularCount : PAGE;
    setPlayingId(null);
    const token = ++enrichTokenRef.current;
    try {
      const res = await channelPreview.mutateAsync({ url: sourceUrl.trim(), offset: 0, count, sort });
      setChannelVideos(res.videos);
      setChannelHasMore(res.hasMore);
      setChannelStatsLoaded(0);
      setSelectedVideos(
        new Set(res.videos.filter((v) => !existingVideoIds.has(v.id)).map((v) => v.id)),
      );
      void enrichVideos(res.videos, token);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not list the channel.");
    }
  }

  // Append the next page (manual "Get more" or auto on scroll). Ref-guarded so
  // rapid scroll events can't fire overlapping fetches.
  async function loadMore() {
    if (!channelVideos || !channelHasMore || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    const token = enrichTokenRef.current;
    try {
      const res = await channelPreview.mutateAsync({
        url: sourceUrl.trim(),
        offset: channelVideos.length,
        count: PAGE,
        sort: channelSort,
      });
      setChannelVideos((prev) => [...(prev ?? []), ...res.videos]);
      setChannelHasMore(res.hasMore);
      setSelectedVideos((prev) => {
        const next = new Set(prev);
        for (const v of res.videos) if (!existingVideoIds.has(v.id)) next.add(v.id);
        return next;
      });
      void enrichVideos(res.videos, token);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load more.");
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }

  function onGridScroll(e: React.UIEvent<HTMLDivElement>) {
    if (!autoLoad || !channelHasMore || loadingRef.current) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 350) loadMore();
  }

  // Sort picks the YouTube source (Popular tab vs Latest vs Oldest), so changing
  // it re-fetches from page 1.
  function onChangeSort(s: "popular" | "latest" | "oldest") {
    setChannelSort(s);
    onPreviewChannel({ sort: s });
  }

  function onToggleAutoLoad(v: boolean) {
    setAutoLoad(v);
    if (typeof window !== "undefined") window.localStorage.setItem("pf.channelAutoLoad", String(v));
  }

  function onChangePopularCount(n: number) {
    const v = Math.max(1, Math.min(200, Math.floor(n) || 200)); // YouTube's Popular caps at 200
    setPopularCount(v);
    if (typeof window !== "undefined") window.localStorage.setItem("pf.popularCount", String(v));
  }

  function toggleVideo(id: string) {
    setSelectedVideos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onImportSelected() {
    if (!channelVideos || selectedVideos.size === 0) return;
    const urls = channelVideos.filter((v) => selectedVideos.has(v.id)).map((v) => v.url);
    try {
      await capture.mutateAsync({ urls });
      toast.success(`Importing ${urls.length} videos…`);
      setChannelVideos(null);
      setSelectedVideos(new Set());
      setSourceUrl("");
      setCaptureOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed.");
    }
  }

  async function onChangeLanguage(value: string) {
    if (!activeProjectId) return;
    const lang = value === "auto" ? "" : value;
    try {
      await updateProject.mutateAsync({ id: activeProjectId, settings: { transcriptLanguage: lang } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update language.");
    }
  }

  async function onDistill(source: Source) {
    if (!confirmPaid()) return;
    try {
      await distill.mutateAsync({ sourceId: source.id, modelId });
      toast.success(`Learning "${source.title}"…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Learn failed.");
    }
  }

  function toggleSource(id: string) {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onDistillSelected() {
    const ids = sources
      .filter((s) => selectedSources.has(s.id) && s.status !== "pending")
      .map((s) => s.id);
    if (!ids.length) return;
    if (!confirmPaid()) return;
    try {
      // One job per source — the in-process queue runs them one at a time.
      for (const id of ids) {
        await distill.mutateAsync({ sourceId: id, modelId });
      }
      toast.success(`Learning ${ids.length} source${ids.length === 1 ? "" : "s"}…`);
      setSelectedSources(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk learn failed.");
    }
  }

  async function onAsk() {
    if (!activeProjectId || !question.trim()) return;
    if (!confirmPaid()) return;
    const scope: { mode: "summaries" | "full"; sourceIds?: string[]; category?: string } = {
      mode: askMode,
    };
    if (askScope.startsWith("cat:")) scope.category = askScope.slice(4);
    else if (askScope.startsWith("src:")) scope.sourceIds = [askScope.slice(4)];
    try {
      const result = await ask.mutateAsync({ projectId: activeProjectId, question, modelId, scope });
      setAskResult(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ask failed.");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={centerMode}
        onValueChange={(v) => setCenterMode(v as CenterMode)}
        className="flex h-full flex-col"
      >
        <div className="flex-1 overflow-auto p-6">
          {/* CAPTURE */}
          <TabsContent value="learn" className="mt-0 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Add a YouTube video, a whole channel, a web link, a PDF, or pasted notes — one
                button, every source type.
              </p>
              <Button className="shrink-0" onClick={() => setCaptureOpen(true)}>
                <Plus className="size-4" /> Capture
              </Button>
            </div>

            <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
              <DialogContent className="max-h-[88vh] w-[88vw] max-w-3xl space-y-4 overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Capture a source</DialogTitle>
                </DialogHeader>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Transcript language</span>
              <Select value={transcriptLanguage || "auto"} onValueChange={onChangeLanguage}>
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSCRIPT_LANGUAGE_OPTIONS.map((l) => (
                    <SelectItem key={l.value || "auto"} value={l.value || "auto"}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="Video · channel (@handle) · playlist (…list=) · article URL"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  (isChannel ? onPreviewChannel() : isVideo ? onPreviewVideo() : canCapture && onCapture())
                }
              />
              {isChannel ? (
                <Button onClick={() => onPreviewChannel()} disabled={!sourceUrl.trim() || channelPreview.isPending}>
                  {channelPreview.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      <Tv className="size-4" /> Preview
                    </>
                  )}
                </Button>
              ) : isVideo ? (
                <Button onClick={onPreviewVideo} disabled={!sourceUrl.trim() || videoPreviewQ.isPending}>
                  {videoPreviewQ.isPending ? <Loader2 className="size-4 animate-spin" /> : "Preview"}
                </Button>
              ) : (
                <Button disabled={!canCapture} onClick={onCapture}>
                  {capture.isPending ? <Loader2 className="size-4 animate-spin" /> : "Capture"}
                </Button>
              )}
            </div>

            {/* PDF upload — raw file is saved, text is extracted for indexing/distill */}
            <div className="flex items-center gap-2">
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={onPickPdf}
              />
              <Button
                variant="outline"
                onClick={() => pdfInputRef.current?.click()}
                disabled={capturePdf.isPending}
              >
                {capturePdf.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileUp className="size-4" />
                )}
                Upload PDF
              </Button>
              <span className="text-xs text-muted-foreground">
                The raw PDF is saved; its text is extracted for Learn &amp; Ask (max 25&nbsp;MB).
              </span>
            </div>

            {isChannel && !displayedVideos && (
              <div className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <Tv className="size-3.5" /> Channel / playlist — Preview loads videos in pages;
                scroll (or Get more) to load further.
              </div>
            )}

            {videoPreview && (
              (() => {
                const already = existingVideoIds.has(videoPreview.id);
                return (
                  <div className="space-y-3 rounded-xl border bg-card p-3 text-card-foreground">
                    <div className="overflow-hidden rounded-lg border">
                      <div className="relative w-full overflow-hidden bg-muted" style={{ paddingBottom: "56.25%" }}>
                        {playingId === videoPreview.id ? (
                          <iframe
                            src={`https://www.youtube-nocookie.com/embed/${videoPreview.id}?autoplay=1`}
                            title={videoPreview.title}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            className="absolute inset-0 h-full w-full"
                          />
                        ) : (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={videoPreview.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setPlayingId(videoPreview.id)}
                              className="group absolute inset-0 flex items-center justify-center transition hover:bg-black/30"
                              title="Play preview"
                            >
                              <PlayCircle className="size-12 text-white opacity-0 transition group-hover:opacity-100" />
                            </button>
                            {videoPreview.durationSeconds != null && (
                              <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[11px] text-white">
                                {formatDuration(videoPreview.durationSeconds)}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-medium leading-snug">{videoPreview.title}</div>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {videoPreview.viewCount != null && <span>{formatCount(videoPreview.viewCount)} views</span>}
                        {videoPreview.likeCount != null && <span>{formatCount(videoPreview.likeCount)} likes</span>}
                        {videoPreview.uploadDate && <span>{videoPreview.uploadDate}</span>}
                        <a href={videoPreview.url} target="_blank" rel="noreferrer" className="text-primary underline">
                          open ↗
                        </a>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {already ? (
                        <span className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white">
                          Already in this project
                        </span>
                      ) : (
                        <Button size="sm" onClick={onImportVideo} disabled={capture.isPending}>
                          {capture.isPending ? <Loader2 className="size-4 animate-spin" /> : "Import this video"}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => { setVideoPreview(null); setPlayingId(null); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                );
              })()
            )}

            {displayedVideos && (
              // Plain div, NOT <Card>: Card is display:flex/flex-col, and a flex
              // item with overflow-auto (the grid) gets min-height:0 and squishes
              // its rows instead of scrolling. A block wrapper avoids that.
              <div className="space-y-3 rounded-xl border bg-card p-3 text-card-foreground">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{displayedVideos.length} loaded</span>
                  <span className="text-muted-foreground">· {selectedVideos.size} selected</span>
                  <Select value={channelSort} onValueChange={(v) => onChangeSort(v as typeof channelSort)}>
                    <SelectTrigger className="ml-auto h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="popular">Popular</SelectItem>
                      <SelectItem value="latest">Latest</SelectItem>
                      <SelectItem value="oldest">Oldest</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    className="text-xs text-muted-foreground underline"
                    onClick={() =>
                      setSelectedVideos(
                        new Set(
                          displayedVideos.filter((v) => !existingVideoIds.has(v.id)).map((v) => v.id),
                        ),
                      )
                    }
                  >
                    All ({selectableCount})
                  </button>
                  <button
                    className="text-xs text-muted-foreground underline"
                    onClick={() => setSelectedVideos(new Set())}
                  >
                    None
                  </button>
                  {/* settings gear (top-right) */}
                  <div className="relative">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      title="Loading settings"
                      onClick={() => setSettingsOpen((o) => !o)}
                    >
                      <Settings className="size-4" />
                    </Button>
                    {settingsOpen && (
                      <div className="absolute right-0 top-8 z-20 w-64 space-y-3 rounded-md border bg-popover p-3 text-left text-popover-foreground shadow-md">
                        <div className="space-y-1">
                          <label className="flex cursor-pointer items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={autoLoad}
                              onChange={(e) => onToggleAutoLoad(e.target.checked)}
                              className="size-4 accent-primary"
                            />
                            Auto-load more on scroll
                          </label>
                          <p className="text-xs text-muted-foreground">
                            Loads more as you scroll (Latest/Oldest), instead of clicking Get more.
                          </p>
                        </div>
                        <div className="space-y-1">
                          <label className="flex items-center justify-between gap-2 text-sm">
                            Popular: fetch
                            <Input
                              type="number"
                              min={1}
                              max={200}
                              value={popularCount}
                              onChange={(e) => onChangePopularCount(Number(e.target.value))}
                              className="h-7 w-20"
                            />
                          </label>
                          <p className="text-xs text-muted-foreground">
                            How many of the all-time Popular videos to load at once (YouTube caps at
                            200). Saved as your default.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {channelStats.isPending && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> loading view counts… (
                    {channelStatsLoaded}/{displayedVideos.length})
                  </p>
                )}

                <div
                  onScroll={onGridScroll}
                  className="grid max-h-[70vh] grid-cols-2 items-start gap-3 overflow-auto pr-1 xl:grid-cols-3"
                >
                  {displayedVideos.map((v) => {
                    const already = existingVideoIds.has(v.id);
                    const checked = selectedVideos.has(v.id);
                    return (
                      <div
                        key={v.id}
                        className={`flex flex-col overflow-hidden rounded-lg border ${
                          checked ? "ring-2 ring-primary" : ""
                        } ${already ? "opacity-60" : ""}`}
                      >
                        {/* padding-bottom 56.25% reserves a real 16:9 box from width
                            (robust regardless of aspect-ratio support / CSS resets) */}
                        <div
                          className="relative w-full overflow-hidden bg-muted"
                          style={{ paddingBottom: "56.25%" }}
                        >
                          {playingId === v.id ? (
                            <iframe
                              src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1`}
                              title={v.title}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                              className="absolute inset-0 h-full w-full"
                            />
                          ) : (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={v.thumbnail}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => setPlayingId(v.id)}
                                className="group absolute inset-0 flex items-center justify-center transition hover:bg-black/30"
                                title="Play preview"
                              >
                                <PlayCircle className="size-10 text-white opacity-0 transition group-hover:opacity-100" />
                              </button>
                              {v.durationSeconds != null && (
                                <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[11px] text-white">
                                  {formatDuration(v.durationSeconds)}
                                </span>
                              )}
                            </>
                          )}
                          {already ? (
                            <span className="absolute left-1.5 top-1.5 rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                              Added
                            </span>
                          ) : (
                            <label className="absolute left-1.5 top-1.5 flex size-6 cursor-pointer items-center justify-center rounded bg-black/70">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleVideo(v.id)}
                                className="size-4 accent-primary"
                              />
                            </label>
                          )}
                        </div>
                        <div className="space-y-1 p-2">
                          <div className="line-clamp-2 text-xs font-medium leading-snug">{v.title}</div>
                          <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                            {v.viewCount != null && <span>{formatCount(v.viewCount)} views</span>}
                            {v.uploadDate && <span>{v.uploadDate}</span>}
                            {v.likeCount != null && <span>{formatCount(v.likeCount)} likes</span>}
                            <a
                              href={v.url}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-auto text-primary underline"
                            >
                              open ↗
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* in-grid loader / end marker */}
                  {channelHasMore ? (
                    <div className="col-span-full flex items-center justify-center py-3 text-xs text-muted-foreground">
                      {loadingMore ? (
                        <>
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" /> loading more…
                        </>
                      ) : autoLoad ? (
                        "scroll for more"
                      ) : null}
                    </div>
                  ) : (
                    <div className="col-span-full py-3 text-center text-xs text-muted-foreground">
                      {channelSort === "popular"
                        ? "End of YouTube's Popular list (max 200)."
                        : "All videos loaded."}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={onImportSelected}
                    disabled={selectedVideos.size === 0 || capture.isPending}
                  >
                    {capture.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      `Import ${selectedVideos.size} selected`
                    )}
                  </Button>
                  {!autoLoad && channelHasMore && (
                    <Button size="sm" variant="outline" onClick={loadMore} disabled={loadingMore}>
                      {loadingMore ? <Loader2 className="size-4 animate-spin" /> : "Get more"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setChannelVideos(null);
                      setChannelHasMore(false);
                      setPlayingId(null);
                    }}
                  >
                    Cancel
                  </Button>
                  {channelStatsLoaded > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      views loaded for {channelStatsLoaded}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Textarea
                placeholder="…or paste raw notes / a transcript here"
                rows={5}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              {notes.trim() && (
                <Button disabled={!canCapture} onClick={onCapture}>
                  {capture.isPending ? <Loader2 className="size-4 animate-spin" /> : "Capture notes"}
                </Button>
              )}
            </div>
              </DialogContent>
            </Dialog>

            {/* Capturing / Captured sub-tabs */}
            <Tabs defaultValue="captured" className="mt-1">
              <TabsList variant="line">
                <TabsTrigger value="capturing">
                  Capturing{activeCaptureJobs.length ? ` · ${activeCaptureJobs.length}` : ""}
                </TabsTrigger>
                <TabsTrigger value="captured">
                  Captured{sources.length ? ` · ${sources.length}` : ""}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="capturing" className="mt-3 space-y-2">
                {activeCaptureJobs.length === 0 ? (
                  <Card className="p-6 text-sm text-muted-foreground">
                    Nothing capturing right now. Click <strong>Capture</strong> to add a source.
                  </Card>
                ) : (
                  <div className="divide-y overflow-hidden rounded-lg border bg-card">
                    {activeCaptureJobs.map((job) => (
                      <div key={job.id} className="flex items-center gap-2.5 px-3 py-2.5 text-sm">
                        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                        <span className="flex-1 truncate">{job.label}</span>
                        <Badge variant="secondary" className="font-normal capitalize">
                          {job.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="captured" className="mt-3 space-y-2">
            {sources.length > 0 ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {sources.map((s) => {
                    const vid = videoIdOf(s.url);
                    // Prefer YouTube's thumbnail; otherwise the article's og:image.
                    const thumb = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : s.thumbnail;
                    const Icon = TYPE_ICON[s.type] ?? FileText;
                    return (
                      <button
                        key={s.id}
                        onClick={() => s.status !== "pending" && previewSnapshot(s.id)}
                        className="group flex flex-col overflow-hidden rounded-lg border text-left transition-shadow hover:shadow-md"
                        title={s.title}
                      >
                        <div className="relative w-full bg-muted" style={{ paddingBottom: "56.25%" }}>
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={thumb}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Icon className="size-9 text-muted-foreground" />
                            </div>
                          )}
                          {s.status === "pending" && (
                            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-amber-500" />
                          )}
                          {s.status === "distilled" && (
                            <span className="absolute right-1.5 top-1.5 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                              ✓ learned
                            </span>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col gap-1 p-2.5">
                          <div className="line-clamp-2 text-sm font-medium leading-snug">{s.title}</div>
                          <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Icon className="size-3.5 shrink-0" />
                            <span className="capitalize">{s.type}</span>
                            {s.relevance != null && <span>· R {s.relevance}</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
            ) : (
              <Card className="p-6 text-sm text-muted-foreground">
                No sources captured yet. Click <strong>Capture</strong> to add your first one.
              </Card>
            )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* DISTILL — goal-aware minimize */}
          <TabsContent value="analyze" className="mt-0 space-y-4">
            <p className="text-sm text-muted-foreground">
              Run <strong>{modelId}</strong> to compress each source down to only what serves the
              project goal — with a category, tags, and a relevance score. Raw text is kept; you
              can re-learn anytime.
            </p>

            <LearnInstructions />

            <Tabs defaultValue="distilled" className="mt-1">
              <TabsList variant="line">
                <TabsTrigger value="distilled">
                  Learned{data?.docs?.length ? ` · ${data.docs.length}` : ""}
                </TabsTrigger>
                <TabsTrigger value="raw">Raw data</TabsTrigger>
              </TabsList>

              <TabsContent value="raw" className="mt-3 space-y-2">
            {sources.length === 0 ? (
              <Card className="p-6 text-sm text-muted-foreground">
                No sources captured yet. Add some in the <strong>Capture</strong> tab.
              </Card>
            ) : (
              (() => {
                const distillable = sources.filter((s) => s.status !== "pending");
                const allSelected =
                  distillable.length > 0 && distillable.every((s) => selectedSources.has(s.id));
                const toggleAll = () =>
                  setSelectedSources(
                    allSelected ? new Set() : new Set(distillable.map((s) => s.id)),
                  );
                return (
                  <div className="space-y-2">
                    {/* Bulk action bar */}
                    <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        disabled={distillable.length === 0}
                        className="size-4 accent-primary"
                        title="Select all"
                      />
                      <span className="text-sm text-muted-foreground">
                        {selectedSources.size > 0
                          ? `${selectedSources.size} selected`
                          : `${distillable.length} ready`}
                      </span>
                      <Button
                        size="sm"
                        className="ml-auto"
                        disabled={selectedSources.size === 0 || distill.isPending}
                        onClick={onDistillSelected}
                      >
                        {distill.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Sparkles className="size-3.5" />
                        )}
                        Learn selected
                      </Button>
                    </div>

                    {/* Compact source rows */}
                    <div className="divide-y overflow-hidden rounded-lg border bg-card">
                      {sources.map((s) => {
                        const Icon = TYPE_ICON[s.type] ?? FileText;
                        const pending = s.status === "pending";
                        const busy =
                          jobs?.some(
                            (j) =>
                              j.kind === "distill" &&
                              j.label.includes(s.title) &&
                              (j.status === "queued" || j.status === "running"),
                          ) ?? false;
                        return (
                          <div
                            key={s.id}
                            className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-muted/50"
                          >
                            <input
                              type="checkbox"
                              checked={selectedSources.has(s.id)}
                              onChange={() => toggleSource(s.id)}
                              disabled={pending}
                              className="size-4 shrink-0 accent-primary disabled:opacity-40"
                            />
                            <Icon className="size-4 shrink-0 text-muted-foreground" />
                            <button
                              onClick={() => !pending && previewSnapshot(s.id)}
                              disabled={pending}
                              className="min-w-0 flex-1 text-left"
                              title="View captured text"
                            >
                              <div className="truncate text-sm font-medium">{s.title}</div>
                              <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                                <span className="capitalize">{s.type}</span>
                                {s.category && <span>· {s.category}</span>}
                                {s.relevance != null && <span>· rel {s.relevance}</span>}
                                {s.credibility != null && <span>· cred {s.credibility}</span>}
                              </div>
                            </button>
                            {(s.status === "failed" || pending) && (
                              <Badge variant={statusVariant(s.status)} className="font-normal">
                                {s.status}
                              </Badge>
                            )}
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => previewSnapshot(s.id)}
                              title="Preview"
                            >
                              <Eye className="size-3.5" />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={pending || busy || distill.isPending}
                              onClick={() => onDistill(s)}
                              title={s.status === "distilled" ? "Re-learn" : "Learn"}
                            >
                              {busy ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="size-3.5" />
                              )}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            )}
              </TabsContent>

              <TabsContent value="distilled" className="mt-3 space-y-2">
            {data?.docs && data.docs.length > 0 ? (
              <div className="divide-y overflow-hidden rounded-lg border bg-card">
                {data.docs.map((d) => {
                  const src = sources.find((s) => s.id === d.sourceId);
                  const busy =
                    jobs?.some(
                      (j) =>
                        j.kind === "distill" &&
                        src != null &&
                        j.label.includes(src.title) &&
                        (j.status === "queued" || j.status === "running"),
                    ) ?? false;
                  return (
                    <div
                      key={d.id}
                      className="flex items-center gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <button
                        onClick={() => previewDoc(d.markdownPath)}
                        className="min-w-0 flex-1 truncate text-left font-medium"
                        title="Open"
                      >
                        {d.title}
                      </button>
                      {src && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={busy || distill.isPending}
                          onClick={() => onDistill(src)}
                          title="Re-learn"
                        >
                          {busy ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="size-3.5" />
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <Card className="p-6 text-sm text-muted-foreground">
                Nothing learned yet. Pick sources under <strong>Raw data</strong> and Learn them.
              </Card>
            )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* ASK — scoped retrieval */}
          <TabsContent value="ask" className="mt-0 space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose how much context to spend: learned summaries (cheap) or full transcripts
              (precise), across all sources, a category, or one source.
            </p>

            <div className="flex flex-wrap gap-2">
              <Select value={askMode} onValueChange={(v) => setAskMode(v as "summaries" | "full")}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="summaries">Learned summaries</SelectItem>
                  <SelectItem value="full">Full transcripts</SelectItem>
                </SelectContent>
              </Select>
              <Select value={askScope} onValueChange={setAskScope}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={`cat:${c.name}`}>Category: {c.name}</SelectItem>
                  ))}
                  {(askMode === "summaries" ? distilledSources : sources).map((s) => (
                    <SelectItem key={s.id} value={`src:${s.id}`}>{s.title.slice(0, 40)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="What game ideas / mechanics emerge from these sources?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && question.trim() && !ask.isPending && onAsk()}
              />
              <Button onClick={onAsk} disabled={!question.trim() || ask.isPending}>
                {ask.isPending ? <Loader2 className="size-4 animate-spin" /> : "Ask"}
              </Button>
            </div>

            {ask.isPending && <LoadingLine />}
            {askResult && !ask.isPending && (
              <Card className="space-y-3 p-4">
                <Markdown>{askResult.answer}</Markdown>
                {askResult.usedSources.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
                    <span>Sources ({askResult.mode}):</span>
                    {askResult.usedSources.map((u) => (
                      <Badge key={u.id} variant="outline" className="font-normal">
                        {u.title.slice(0, 36)}
                      </Badge>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </TabsContent>

          <TabsContent value="projects" className="mt-0">
            <ProjectsPage />
          </TabsContent>

          <TabsContent value="global-settings" className="mt-0">
            <GlobalSettings />
          </TabsContent>
        </div>
      </Tabs>

      {/* Source / doc preview — opens as a modal (Esc or the X button closes it). */}
      <Dialog open={preview !== null} onOpenChange={(open) => !open && closePreview()}>
        <DialogContent className="max-h-[88vh] w-[88vw] max-w-[1400px] overflow-y-auto sm:max-w-[88vw]">
          {!preview ? null : preview.kind === "doc" ? (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">Learned document</DialogTitle>
              </DialogHeader>
              {docLoading ? <LoadingLine /> : <Markdown>{docMarkdown ?? ""}</Markdown>}
            </>
          ) : snapLoading ? (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">Loading…</DialogTitle>
              </DialogHeader>
              <LoadingLine />
            </>
          ) : snapshot ? (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8 leading-snug">{snapshot.title}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex gap-4 border-b pb-4">
                  {snapshot.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={snapshot.thumbnail}
                      alt=""
                      className="h-24 w-40 shrink-0 rounded-md border object-cover"
                    />
                  )}
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <Badge variant="secondary">{snapshot.type}</Badge>
                      {snapshot.channel && <span>{snapshot.channel}</span>}
                      {snapshot.durationSeconds != null && <span>{formatDuration(snapshot.durationSeconds)}</span>}
                      {snapshot.viewCount != null && <span>{formatCount(snapshot.viewCount)} views</span>}
                      {snapshot.likeCount != null && <span>{formatCount(snapshot.likeCount)} likes</span>}
                      {snapshot.credibility != null && <span>credibility {snapshot.credibility}</span>}
                      {snapshot.relevance != null && <span>relevance {snapshot.relevance}</span>}
                      {snapshot.publishedAt && <span>{snapshot.publishedAt.slice(0, 10)}</span>}
                      {snapshot.type === "youtube" &&
                        (snapshot.transcriptFetched ? (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="size-3.5" /> transcript
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-600">
                            <AlertCircle className="size-3.5" /> no transcript
                          </span>
                        ))}
                      {snapshot.url && (
                        <a href={snapshot.url} target="_blank" rel="noreferrer" className="text-primary underline">
                          open ↗
                        </a>
                      )}
                    </div>
                    {snapshot.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {snapshot.keywords.slice(0, 10).map((k) => (
                          <Badge key={k} variant="outline" className="font-normal">{k}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {snapshot.description && (
                  <details className="group rounded-md border bg-muted/30">
                    <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground select-none">
                      <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
                      Description
                    </summary>
                    <p className="whitespace-pre-wrap px-3 pb-3 text-sm leading-relaxed text-foreground/70">
                      {snapshot.description}
                    </p>
                  </details>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {snapshot.type === "youtube"
                      ? "Transcript"
                      : snapshot.type === "pdf"
                        ? "Converted Markdown"
                        : "Captured text"}
                    <Badge variant="secondary" className="font-normal">
                      {snapshot.content.split(/\s+/).filter(Boolean).length} words
                    </Badge>
                  </div>
                  {snapshot.content ? (
                    snapshot.type === "pdf" ? (
                      <Markdown>{snapshot.content}</Markdown>
                    ) : (
                      <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground">
                        {snapshot.content}
                      </p>
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No text was captured for this source.
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">Preview</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">Snapshot unavailable.</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LoadingLine() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Working…
    </div>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
