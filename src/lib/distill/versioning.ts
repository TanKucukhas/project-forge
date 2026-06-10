/**
 * Distill versioning: deterministic hashes that capture WHICH instructions and
 * goal produced a learned doc, so the Learn page can detect when a doc is stale
 * (distilled under instructions/goal that have since changed).
 *
 * Server-only — uses node:crypto. The UI never hashes anything; it compares the
 * stored hashes on each doc against the "current" hashes the server computes
 * (see /api/sources), which keeps crypto off the client and the comparison a
 * plain string check.
 */
import "server-only";
import { createHash } from "node:crypto";
import { instructionSignature, LEARN_SCHEMA_VERSION } from "@/lib/settings";
import { taxonomyHashInput, type ProjectTaxonomy } from "@/lib/taxonomy";

export { LEARN_SCHEMA_VERSION };

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type DistillHashes = {
  /** sha256 of the FULL assembled instruction text (prose + goal + JSON contract)
   *  actually sent to the model. Changes if the prose OR the goal OR the contract
   *  changes — the broadest "was this distilled differently?" signal. */
  instructionHash: string;
  /** sha256 of the project goal text alone, so a goal change is attributable on
   *  its own (vs. an instruction-prose edit). */
  goalHash: string;
};

/**
 * Compute the hashes for a distill run from the goal + the editable prose.
 * Uses the same `buildLearnInstructions` the distill job uses, so the hash
 * always matches the prompt that ran.
 */
export function computeDistillHashes(goal: string, prose: string | undefined): DistillHashes {
  return {
    instructionHash: sha256Hex(instructionSignature(goal, prose)),
    goalHash: sha256Hex(goal ?? ""),
  };
}

/** Hash of the project taxonomy. A change here marks docs *metadata*-stale (their
 *  category/tag/entity normalization may need refresh) rather than fully stale. */
export function computeTaxonomyHash(taxonomy: ProjectTaxonomy): string {
  return sha256Hex(taxonomyHashInput(taxonomy));
}
