/**
 * Stale detection for learned docs/sources. A doc is "stale" when it was
 * distilled under instructions/goal that have since changed — compared by hash,
 * never by re-running the model. Pure string comparison; the server supplies the
 * current hashes (see /api/sources → `current`).
 */
import type { CurrentDistill } from "@/lib/api";

export type Staleness = "fresh" | "goal" | "instructions" | "schema" | "metadata" | "unknown";

type HashedDoc = {
  instructionHash: string | null;
  goalHash: string | null;
  taxonomyHash?: string | null;
  learnSchemaVersion?: number | null;
};

/**
 * Note: instruction_hash already incorporates the goal (it hashes the full
 * assembled prompt), so a goal change flips both hashes. We check goalHash first
 * to attribute the more specific reason ("goal changed") before the broader one.
 *
 * Taxonomy is hashed separately and checked LAST: a taxonomy change only means
 * category/tag/entity metadata may need re-normalization (metadata-stale) — the
 * summary itself is still valid — so it ranks below the full-stale reasons.
 */
export function docStaleness(doc: HashedDoc, current: CurrentDistill | undefined): Staleness {
  if (!current) return "fresh";
  // Distilled before versioning existed — we can't tell, so flag as unknown.
  if (!doc.instructionHash && !doc.goalHash) return "unknown";
  if (doc.goalHash && doc.goalHash !== current.goalHash) return "goal";
  if (doc.instructionHash && doc.instructionHash !== current.instructionHash) return "instructions";
  if (
    doc.learnSchemaVersion != null &&
    current.learnSchemaVersion != null &&
    doc.learnSchemaVersion < current.learnSchemaVersion
  ) {
    return "schema";
  }
  if (doc.taxonomyHash && current.taxonomyHash && doc.taxonomyHash !== current.taxonomyHash) {
    return "metadata";
  }
  return "fresh";
}

export const STALE_LABEL: Record<Exclude<Staleness, "fresh">, string> = {
  goal: "goal changed",
  instructions: "instructions changed",
  schema: "older format",
  metadata: "taxonomy changed",
  unknown: "unversioned",
};

/** Short tooltip explaining what to do — re-learning is always optional/manual. */
export const STALE_HINT: Record<Exclude<Staleness, "fresh">, string> = {
  goal: "The project goal changed since this was learned. Re-learn to refresh it.",
  instructions: "The Learn instructions changed since this was learned. Re-learn to refresh it.",
  schema: "Learned under an older distill format. Re-learn to capture the newer metadata.",
  metadata:
    "The project taxonomy changed since this was learned. The summary is still valid; re-learn to refresh category/tags/entities.",
  unknown: "Learned before version tracking. Re-learn to record provenance + richer metadata.",
};
