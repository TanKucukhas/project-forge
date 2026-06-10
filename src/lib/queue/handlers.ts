/**
 * Wires persistent job kinds to their runners and resumes any jobs left over
 * from a previous process. Kept separate from queue.ts to avoid a cycle
 * (queue.ts has no knowledge of jobs.ts). Every job-related route calls
 * `ensureQueueReady()` so handlers are registered before the first enqueue/poll.
 */
import "server-only";
import { registerJobHandler, loadPersisted, type JobPayload } from "./queue";
import { runCapture, runDistill, type CaptureInput } from "./jobs";

let wired = false;

export function ensureQueueReady(): void {
  if (wired) return;
  wired = true;
  registerJobHandler("capture", (p: JobPayload) => runCapture(p as unknown as CaptureInput));
  registerJobHandler("distill", (p: JobPayload) =>
    runDistill(p as unknown as { sourceId: string; modelId: string; instructions?: string }),
  );
  // PDF capture carries raw bytes (not serializable) → stays a one-off enqueue(),
  // so it has no persistent handler here.
  loadPersisted();
}
