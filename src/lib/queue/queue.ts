/**
 * Minimal in-process job queue. One worker drains a FIFO of jobs SEQUENTIALLY
 * (concurrency = 1) so a burst of captures/distills never fires N concurrent
 * model runs — the deliberate "no BullMQ/Redis until proven necessary" choice.
 *
 * Three resilience features for large batches:
 *  - Throttle: an optional per-job gap before the next job starts (rate-limit
 *    friendliness; set per provider by the caller).
 *  - Persistence: "persistent" jobs (declared by kind + serializable payload via
 *    a registered handler) are written to data/queue.json, so a dev restart
 *    mid-batch resumes the queued/interrupted jobs instead of losing them.
 *  - (Retry/backoff lives in the model layer — see lib/ai/index.ts.)
 *
 * State lives in a module global so it survives Next dev HMR.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type JobKind = "capture" | "distill";
export type JobStatus = "queued" | "running" | "done" | "error";

export type JobPayload = Record<string, unknown>;
export type JobRunner = (job: Job) => Promise<Record<string, unknown> | void>;

export type Job = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  label: string;
  /** Job-specific result payload (e.g. { sourceId } or { learningDocId }). */
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
  /** When the job actually started running (for duration/ETA measurement). */
  startedAt?: string;
  /** Measured run time once finished (ms) — feeds the empirical ETA. */
  durationMs?: number;
  /** Serializable input for persistent jobs (so they can be rebuilt on restart). */
  payload?: JobPayload;
  /** Whether this job is persisted + resumable (true) or one-off in-memory (false). */
  persistent?: boolean;
  /** Gap (ms) to wait after this job before starting the next one. */
  throttleMs?: number;
};

type PendingItem = { id: string; run: JobRunner; throttleMs: number };

/** One sequential lane per job kind, so distinct kinds (capture vs distill) run
 *  CONCURRENTLY while each kind stays sequential internally (no 200 parallel
 *  yt-dlp scrapes or model calls). */
type Lane = { pending: PendingItem[]; draining: boolean };

type QueueState = {
  jobs: Map<string, Job>;
  lanes: Map<JobKind, Lane>;
  handlers: Map<JobKind, (payload: JobPayload) => Promise<Record<string, unknown> | void>>;
  loaded: boolean;
};

const QUEUE_FILE =
  process.env.PROJECTFORGE_QUEUE ?? path.join(process.cwd(), "data", "queue.json");

const globalForQueue = globalThis as unknown as { __pfQueue?: QueueState };

function state(): QueueState {
  // Backfill defensively: the global survives HMR, so a hot-reload after the
  // queue's shape changed can leave an older object missing newer fields (e.g.
  // `lanes`). Initialize any missing map rather than crashing on `.get`.
  const s = (globalForQueue.__pfQueue ?? {}) as Partial<QueueState>;
  if (!s.jobs) s.jobs = new Map();
  if (!s.lanes) s.lanes = new Map();
  if (!s.handlers) s.handlers = new Map();
  if (s.loaded === undefined) s.loaded = false;
  globalForQueue.__pfQueue = s as QueueState;
  return s as QueueState;
}

/** Get (or create) the lane for a job kind. */
function lane(kind: JobKind): Lane {
  const s = state();
  let l = s.lanes.get(kind);
  if (!l) {
    l = { pending: [], draining: false };
    s.lanes.set(kind, l);
  }
  return l;
}

function touch(job: Job): void {
  job.updatedAt = new Date().toISOString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Persistence ──────────────────────────────────────────────────────────────

/** Write the resumable set (persistent jobs still queued/running) to disk. */
function persist(): void {
  const s = state();
  try {
    const data = [...s.jobs.values()]
      .filter((j) => j.persistent && (j.status === "queued" || j.status === "running"))
      .map((j) => ({
        id: j.id,
        kind: j.kind,
        label: j.label,
        payload: j.payload,
        throttleMs: j.throttleMs,
        createdAt: j.createdAt,
      }));
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(data), "utf8");
  } catch {
    /* best-effort — losing the journal only costs resumability */
  }
}

/** Register how to run a persistent job kind from its payload. Must be called
 *  (see queue/handlers.ts) before loadPersisted() can resume that kind. */
export function registerJobHandler(
  kind: JobKind,
  handler: (payload: JobPayload) => Promise<Record<string, unknown> | void>,
): void {
  state().handlers.set(kind, handler);
}

/** Re-enqueue persistent jobs left over from a previous run. Idempotent: runs at
 *  most once per process. A job that was "running" when the process died is
 *  re-queued from scratch (distill is re-runnable; capture dedupes by URL). */
export function loadPersisted(): void {
  const s = state();
  if (s.loaded) return;
  s.loaded = true;
  let records: Array<{
    id: string;
    kind: JobKind;
    label: string;
    payload?: JobPayload;
    throttleMs?: number;
    createdAt: string;
  }> = [];
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      records = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
    }
  } catch {
    return;
  }
  let resumed = 0;
  for (const rec of records) {
    if (s.jobs.has(rec.id)) continue; // already live
    const handler = s.handlers.get(rec.kind);
    if (!handler || !rec.payload) continue;
    const job: Job = {
      id: rec.id,
      kind: rec.kind,
      label: rec.label,
      status: "queued",
      createdAt: rec.createdAt,
      updatedAt: new Date().toISOString(),
      payload: rec.payload,
      persistent: true,
      throttleMs: rec.throttleMs,
    };
    s.jobs.set(job.id, job);
    const payload = rec.payload;
    lane(rec.kind).pending.push({
      id: job.id,
      run: () => handler(payload),
      throttleMs: rec.throttleMs ?? 0,
    });
    resumed += 1;
  }
  if (resumed > 0) {
    persist();
    for (const kind of s.lanes.keys()) void drain(kind);
  }
}

// ── Enqueue ──────────────────────────────────────────────────────────────────

/** Enqueue a one-off, in-memory job (NOT resumable across restarts). Use for
 *  jobs whose input can't be serialized (e.g. raw PDF bytes). */
export function enqueue(
  kind: JobKind,
  label: string,
  run: JobRunner,
  opts?: { throttleMs?: number },
): Job {
  const s = state();
  const now = new Date().toISOString();
  const job: Job = {
    id: randomUUID().slice(0, 8),
    kind,
    label,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    persistent: false,
    throttleMs: opts?.throttleMs ?? 0,
  };
  s.jobs.set(job.id, job);
  lane(kind).pending.push({ id: job.id, run, throttleMs: job.throttleMs ?? 0 });
  void drain(kind);
  return job;
}

/** Enqueue a persistent, resumable job built from a registered handler + a
 *  serializable payload. Survives a restart mid-batch. */
export function enqueueJob(
  kind: JobKind,
  label: string,
  payload: JobPayload,
  opts?: { throttleMs?: number },
): Job {
  const s = state();
  const handler = s.handlers.get(kind);
  if (!handler) throw new Error(`No handler registered for job kind "${kind}".`);
  const now = new Date().toISOString();
  const job: Job = {
    id: randomUUID().slice(0, 8),
    kind,
    label,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    payload,
    persistent: true,
    throttleMs: opts?.throttleMs ?? 0,
  };
  s.jobs.set(job.id, job);
  lane(kind).pending.push({ id: job.id, run: () => handler(payload), throttleMs: job.throttleMs ?? 0 });
  persist();
  void drain(kind);
  return job;
}

/** Drain ONE lane sequentially. Lanes run independently, so capture and distill
 *  progress in parallel (one job each at a time). */
async function drain(kind: JobKind): Promise<void> {
  const l = lane(kind);
  if (l.draining) return;
  l.draining = true;
  const s = state();
  try {
    while (l.pending.length > 0) {
      const next = l.pending.shift()!;
      const job = s.jobs.get(next.id);
      if (!job) continue;
      job.status = "running";
      job.startedAt = new Date().toISOString();
      touch(job);
      persist();
      const startMs = Date.now();
      try {
        const result = await next.run(job);
        job.status = "done";
        if (result) job.result = result;
      } catch (error) {
        job.status = "error";
        job.error = error instanceof Error ? error.message : "Job failed.";
      }
      job.durationMs = Date.now() - startMs;
      touch(job);
      persist();
      // Rate-limit friendliness: wait before the next job (provider-specific gap).
      if (next.throttleMs > 0 && l.pending.length > 0) await sleep(next.throttleMs);
    }
  } finally {
    l.draining = false;
  }
}

export function getJob(id: string): Job | undefined {
  return state().jobs.get(id);
}

/** Dismiss a finished/errored job from the list (acknowledge). Refuses to drop a
 *  job that is still queued/running so an in-flight job can't be orphaned. */
export function clearJob(id: string): boolean {
  const job = state().jobs.get(id);
  if (!job || job.status === "queued" || job.status === "running") return false;
  const ok = state().jobs.delete(id);
  if (ok && job.persistent) persist();
  return ok;
}

/**
 * Detail list for the activity panel: running first (the actual front of the
 * FIFO, otherwise hidden behind newer queued items), then the next queued, then
 * recent finished. Capped — see jobStats() for the true totals.
 */
export function listJobs(limit = 30): Job[] {
  const all = [...state().jobs.values()];
  const finished = all
    .filter((j) => j.status === "done" || j.status === "error")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Bound memory by dropping only OLD finished jobs (never queued/running, which
  // are still in `pending` and would be skipped if their job row vanished).
  if (finished.length > 200) {
    for (const j of finished.slice(200)) state().jobs.delete(j.id);
  }
  const running = all.filter((j) => j.status === "running");
  const queued = all
    .filter((j) => j.status === "queued")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest = next up
  return [...running, ...queued, ...finished].slice(0, limit);
}

export type JobStats = {
  queued: number;
  running: number;
  done: number;
  error: number;
  total: number;
  /** Avg measured run time of recent finished jobs (ms); 0 if none yet. */
  avgMs: number;
  /** Estimated time to clear the remaining queue (ms), from avgMs. */
  etaMs: number;
};

/** True totals across the whole queue (not capped like listJobs) + an empirical,
 *  model-aware ETA derived from how long recent jobs actually took. */
export function jobStats(): JobStats {
  const all = [...state().jobs.values()];
  let queued = 0;
  let running = 0;
  let done = 0;
  let error = 0;
  const durs: number[] = [];
  for (const j of all) {
    if (j.status === "queued") queued += 1;
    else if (j.status === "running") running += 1;
    else if (j.status === "done") {
      done += 1;
      if (j.durationMs) durs.push(j.durationMs);
    } else if (j.status === "error") {
      error += 1;
      if (j.durationMs) durs.push(j.durationMs);
    }
  }
  const recent = durs.slice(-10);
  const avgMs = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
  const perJob = avgMs || 120_000; // fallback ~2 min until we've measured some
  return { queued, running, done, error, total: all.length, avgMs, etaMs: (queued + running) * perJob };
}

/** Cancel every queued (not-yet-started) job; the running job is left to finish.
 *  Returns how many were dropped. */
export function clearQueued(): number {
  const s = state();
  const ids = [...s.jobs.values()].filter((j) => j.status === "queued").map((j) => j.id);
  for (const id of ids) s.jobs.delete(id);
  for (const l of s.lanes.values()) l.pending = l.pending.filter((p) => s.jobs.has(p.id));
  persist();
  return ids.length;
}
