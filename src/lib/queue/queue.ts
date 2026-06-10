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
  /** Serializable input for persistent jobs (so they can be rebuilt on restart). */
  payload?: JobPayload;
  /** Whether this job is persisted + resumable (true) or one-off in-memory (false). */
  persistent?: boolean;
  /** Gap (ms) to wait after this job before starting the next one. */
  throttleMs?: number;
};

type PendingItem = { id: string; run: JobRunner; throttleMs: number };

type QueueState = {
  jobs: Map<string, Job>;
  pending: PendingItem[];
  handlers: Map<JobKind, (payload: JobPayload) => Promise<Record<string, unknown> | void>>;
  draining: boolean;
  loaded: boolean;
};

const QUEUE_FILE =
  process.env.PROJECTFORGE_QUEUE ?? path.join(process.cwd(), "data", "queue.json");

const globalForQueue = globalThis as unknown as { __pfQueue?: QueueState };

function state(): QueueState {
  if (!globalForQueue.__pfQueue) {
    globalForQueue.__pfQueue = {
      jobs: new Map(),
      pending: [],
      handlers: new Map(),
      draining: false,
      loaded: false,
    };
  }
  return globalForQueue.__pfQueue;
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
    s.pending.push({ id: job.id, run: () => handler(payload), throttleMs: rec.throttleMs ?? 0 });
    resumed += 1;
  }
  if (resumed > 0) {
    persist();
    void drain();
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
  s.pending.push({ id: job.id, run, throttleMs: job.throttleMs ?? 0 });
  void drain();
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
  s.pending.push({ id: job.id, run: () => handler(payload), throttleMs: job.throttleMs ?? 0 });
  persist();
  void drain();
  return job;
}

async function drain(): Promise<void> {
  const s = state();
  if (s.draining) return;
  s.draining = true;
  try {
    while (s.pending.length > 0) {
      const next = s.pending.shift()!;
      const job = s.jobs.get(next.id);
      if (!job) continue;
      job.status = "running";
      touch(job);
      persist();
      try {
        const result = await next.run(job);
        job.status = "done";
        if (result) job.result = result;
      } catch (error) {
        job.status = "error";
        job.error = error instanceof Error ? error.message : "Job failed.";
      }
      touch(job);
      persist();
      // Rate-limit friendliness: wait before the next job (provider-specific gap).
      if (next.throttleMs > 0 && s.pending.length > 0) await sleep(next.throttleMs);
    }
  } finally {
    s.draining = false;
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

/** Recent jobs, newest first — capped so the in-memory map can't grow forever. */
export function listJobs(limit = 30): Job[] {
  const jobs = [...state().jobs.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  // Drop very old finished jobs beyond the cap to bound memory.
  if (jobs.length > 200) {
    const keep = new Set(jobs.slice(0, 200).map((j) => j.id));
    for (const id of state().jobs.keys()) if (!keep.has(id)) state().jobs.delete(id);
  }
  return jobs.slice(0, limit);
}
