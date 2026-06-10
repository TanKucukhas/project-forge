/**
 * Minimal in-process job queue. One worker drains a FIFO of jobs sequentially
 * so a burst of captures doesn't spawn N concurrent transcript scrapes / model
 * runs. State lives in a module global so it survives Next dev HMR. This is the
 * deliberate "no BullMQ/Redis until proven necessary" choice.
 */
import "server-only";
import { randomUUID } from "node:crypto";

export type JobKind = "capture" | "distill";
export type JobStatus = "queued" | "running" | "done" | "error";

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
};

type QueueState = {
  jobs: Map<string, Job>;
  pending: Array<{ id: string; run: (job: Job) => Promise<Record<string, unknown> | void> }>;
  draining: boolean;
};

const globalForQueue = globalThis as unknown as { __pfQueue?: QueueState };

function state(): QueueState {
  if (!globalForQueue.__pfQueue) {
    globalForQueue.__pfQueue = { jobs: new Map(), pending: [], draining: false };
  }
  return globalForQueue.__pfQueue;
}

function touch(job: Job): void {
  job.updatedAt = new Date().toISOString();
}

export function enqueue(
  kind: JobKind,
  label: string,
  run: (job: Job) => Promise<Record<string, unknown> | void>,
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
  };
  s.jobs.set(job.id, job);
  s.pending.push({ id: job.id, run });
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
      try {
        const result = await next.run(job);
        job.status = "done";
        if (result) job.result = result;
      } catch (error) {
        job.status = "error";
        job.error = error instanceof Error ? error.message : "Job failed.";
      }
      touch(job);
    }
  } finally {
    s.draining = false;
  }
}

export function getJob(id: string): Job | undefined {
  return state().jobs.get(id);
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
