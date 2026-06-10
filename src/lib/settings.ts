/**
 * Per-project settings — the project container's guardrails, stored as JSON in
 * `projects.settings`. Client- and server-safe (no server-only imports).
 *
 * Model/cost policy is the only setting today. It is deliberately boring: the
 * project *goal* is the steering input; this is just the guardrail that keeps
 * paid API spend explicit. Capture is always free; paid spend only ever happens
 * after a manual Distill / Ask / Generate.
 */
import { modelOptions, getModelOption, isLocalProvider, type ModelOption } from "./ai/models";
import {
  renderTaxonomyForPrompt,
  DEFAULT_TAXONOMY,
  type CanonicalCategory,
  type ProjectTaxonomy,
} from "./taxonomy";

export type ModelUsagePolicy =
  | "local_only"
  | "confirm_paid_each_time"
  | "paid_allowed_for_manual_actions";

/** Default: paid is available but always confirmed, so an unconfigured user
 *  never hits a hard wall, and never burns credits by surprise. */
export const DEFAULT_MODEL_USAGE_POLICY: ModelUsagePolicy = "confirm_paid_each_time";

/** Preferred caption language for YouTube transcripts (ISO 639-1). "" = auto
 *  (whatever YouTube serves by default). We fall back to auto if the preferred
 *  language has no caption track. */
export type TranscriptLanguage = string;

export const DEFAULT_TRANSCRIPT_LANGUAGE: TranscriptLanguage = "en";

export const TRANSCRIPT_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "tr", label: "Turkish" },
  { value: "ru", label: "Russian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "hi", label: "Hindi" },
  { value: "ar", label: "Arabic" },
  { value: "", label: "Auto (any available)" },
];

export interface ProjectSettings {
  modelUsagePolicy: ModelUsagePolicy;
  transcriptLanguage: TranscriptLanguage;
  /** Editable instruction prose that steers Learn (distill) for this project.
   *  "" means "use DEFAULT_LEARN_INSTRUCTIONS", so improvements to the default
   *  flow through to projects that never customized it. */
  learnInstructions: string;
  /** Per-project canonical taxonomy (categories, tag policy, entity-extraction
   *  flags). Guides distillation + normalization + filtering. */
  taxonomy: ProjectTaxonomy;
}

/** Tolerant parse of a stored taxonomy object, falling back to the default for
 *  any missing/invalid part. Existing projects (no taxonomy) get the default. */
function parseTaxonomy(raw: unknown): ProjectTaxonomy {
  if (!raw || typeof raw !== "object") return DEFAULT_TAXONOMY;
  const o = raw as Record<string, unknown>;
  const categories = Array.isArray(o.categories)
    ? (o.categories as unknown[])
        .map((c) => {
          const cc = c as Record<string, unknown>;
          const name = typeof cc.name === "string" ? cc.name.trim() : "";
          if (!name) return null;
          return {
            id: typeof cc.id === "string" && cc.id ? cc.id : name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            name,
            description: typeof cc.description === "string" ? cc.description : "",
            aliases: Array.isArray(cc.aliases)
              ? (cc.aliases as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
              : [],
          } as CanonicalCategory;
        })
        .filter((c): c is CanonicalCategory => c != null)
    : DEFAULT_TAXONOMY.categories;
  const tp = (o.tagPolicy ?? {}) as Record<string, unknown>;
  const ee = (o.entityExtraction ?? {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    version: typeof o.version === "number" ? o.version : DEFAULT_TAXONOMY.version,
    template: typeof o.template === "string" ? o.template : DEFAULT_TAXONOMY.template,
    categories: categories.length ? categories : DEFAULT_TAXONOMY.categories,
    tagPolicy: {
      mode: typeof tp.mode === "string" ? tp.mode : DEFAULT_TAXONOMY.tagPolicy.mode,
      format: typeof tp.format === "string" ? tp.format : DEFAULT_TAXONOMY.tagPolicy.format,
      maxTagsPerSource:
        typeof tp.maxTagsPerSource === "number" ? tp.maxTagsPerSource : DEFAULT_TAXONOMY.tagPolicy.maxTagsPerSource,
    },
    outputUseCases: Array.isArray(o.outputUseCases)
      ? (o.outputUseCases as unknown[]).map(String)
      : DEFAULT_TAXONOMY.outputUseCases,
    entityExtraction: {
      extract_authors: bool(ee.extract_authors, true),
      extract_referenced_games: bool(ee.extract_referenced_games, true),
      extract_referenced_people: bool(ee.extract_referenced_people, true),
      extract_referenced_studios: bool(ee.extract_referenced_studios, true),
      extract_key_terms: bool(ee.extract_key_terms, true),
      extract_synonyms: bool(ee.extract_synonyms, true),
    },
  };
}

/** Bump when the distill output contract / parsing changes in a backward-
 *  incompatible way. Stored on each learned doc so stale docs can be detected
 *  after the contract evolves. v1 = original 5-field shape; v2 = structured
 *  metadata (authors, referenced games, key terms, utility); v3 = disciplined
 *  metadata (canonical category + original, importance-tiered entities, entity
 *  confidence + review flag). */
export const LEARN_SCHEMA_VERSION = 3;

/** The default lead-in for the Learn prompt. Editable per project; the goal and
 *  the JSON output contract below are appended in code (not user-editable). */
export const DEFAULT_LEARN_INSTRUCTIONS = `You are distilling a source for a specific PROJECT GOAL.

Your job is not to summarize the source generally. Your job is to extract only the reusable knowledge that can improve future project outputs.

Keep only ideas that help with:
- generating stronger concepts
- writing better design documents
- writing better technical specs
- creating better AI-agent build prompts
- evaluating whether an idea is actually good

Discard:
- biography, greetings, jokes, filler, anecdotes that do not teach a reusable pattern
- generic advice not clearly supported by the source
- motivational fluff
- repeated points
- implementation details unrelated to the PROJECT GOAL

When distilling, prioritize:
1. Design principles: reusable rules, frameworks, mental models
2. Actionable techniques: methods, tests, checklists, workflows
3. Concrete examples: games, mechanics, systems, production examples
4. Anti-patterns: mistakes, traps, weak approaches
5. Transfer notes: how this applies to future concepts, prototypes, specs, or AI-agent prompts
6. Evaluation criteria: how to judge whether an output is strong or weak
7. Open questions: useful uncertainties or missing information

Write the summary_markdown with these sections when relevant:
## Core Takeaways
## Reusable Principles
## Concrete Techniques
## Examples / Case Studies
## Anti-Patterns
## Application To The Project Goal
## Prompt / Spec Ingredients
## Questions To Revisit

Rules:
- Be compact but dense.
- Prefer specific claims over vague summaries.
- Do not invent facts not present in the source.
- If the source is weak, say so in the rationale and give a lower relevance score.
- If the source contains one excellent reusable idea but lots of filler, keep the idea and score accordingly.
- Tags should be reusable across the whole project, not one-off phrases.
- Authors and referenced games should only be extracted when clearly present or strongly implied by the source metadata/content.
- If the author/speaker has a recognizable design philosophy in this source, include it in the summary_markdown under Application To The Project Goal. If not, do not invent one.`;

/** The fixed JSON output contract appended to every Learn prompt. The distill
 *  parser reads exactly this shape, so it is code-owned and shown read-only.
 *  v2: richer structured metadata. Every field is parsed defensively — missing
 *  or malformed fields never break a distill run (graceful fallback). */
export const LEARN_OUTPUT_CONTRACT = `Return ONE JSON object and nothing outside it, with exactly this shape:
{
  "category": "the closest canonical category from PROJECT TAXONOMY",
  "original_category": "your own natural label for this source (may differ from canonical)",
  "tags": ["3 to 8 reusable short tags"],
  "relevance": <integer 0-100: how useful this source is for the PROJECT GOAL>,
  "utility": "low | medium | high",
  "use_for": ["answer", "concept", "gdd", "prototype_spec", "technical_spec", "agent_prompt", "evaluation"],
  "authors": [
    { "name": "person who MADE this source", "role": "speaker | writer | designer | interviewer | host", "confidence": "low | medium | high" }
  ],
  "referenced_people": [
    { "name": "person discussed but NOT an author of this source", "relation": "subject | comparison | mentioned", "confidence": "low | medium | high" }
  ],
  "primary_games": ["the game(s) this source is mainly about"],
  "secondary_games": ["games discussed with meaningful design detail"],
  "mentioned_games": ["games only briefly mentioned or used as comparisons"],
  "primary_studios": ["studios central to this source"],
  "mentioned_studios": ["studios only briefly mentioned"],
  "key_terms": ["important source-specific terms useful for retrieval"],
  "synonyms": ["alternative words users might search for"],
  "source_quality": { "authority": "low | medium | high", "confidence": "low | medium | high", "bias_or_limits": "short note" },
  "needs_entity_review": <true if any extracted name looks uncertain / transcript-corrupted / out of context, else false>,
  "entity_review_notes": ["short note on each uncertain entity, e.g. 'Power Manga may be a transcript error for Powermonger'"],
  "rationale": "one sentence justifying the relevance and utility",
  "why_keep": "one sentence explaining what this source is useful for",
  "why_not": "one sentence explaining limitations, filler, or reasons it may not be useful",
  "summary_markdown": "compact Markdown distillation containing only goal-relevant material"
}`;

/** Entity discipline rules appended after the contract — keeps extraction from
 *  flattening every name to equal importance (the main retrieval failure mode). */
export const LEARN_ENTITY_RULES = `ENTITY RULES:
- Do not treat every referenced entity as equally important. Use the tiers above honestly: most games in a source are "mentioned", few are "primary".
- An author MADE this source (speaker/writer/host). A referenced person is discussed but did not make it. Never list the same person as both an author and a referenced person.
- Only extract people/games/studios that are clearly present or strongly implied. Do not invent entities.
- Transcripts corrupt names easily. If a name looks uncertain or out of context, still include it but set needs_entity_review = true and explain in entity_review_notes.
- Pay special attention to people's names (designers, composers, musicians). If a name is close to a well-known industry name (e.g. a C64/Amiga composer), flag it for review with the likely correction in entity_review_notes.
- Tags must be short and reusable across the whole project (they will be normalized to lowercase kebab-case).`;

/** Assemble the full Learn instruction block: editable prose + the project goal
 *  + the fixed JSON contract. Shared by the distill job and the UI's read-only
 *  prompt preview so the two never drift. */
function instructionCore(goal: string, prose?: string): string {
  return `${prose?.trim() || DEFAULT_LEARN_INSTRUCTIONS}

PROJECT GOAL:
${goal || "(no explicit goal set — distill the generally most useful, reusable knowledge.)"}`;
}

/**
 * The text whose hash is the doc's `instruction_hash`. Deliberately EXCLUDES the
 * project taxonomy block: taxonomy edits should mark docs *metadata*-stale (via
 * taxonomy_hash), not fully stale. Includes the fixed contract + entity rules so
 * a contract change (also covered by LEARN_SCHEMA_VERSION) shifts the signature.
 */
export function instructionSignature(goal: string, prose?: string): string {
  return `${instructionCore(goal, prose)}

${LEARN_OUTPUT_CONTRACT}

${LEARN_ENTITY_RULES}`;
}

/** The full prompt actually sent to the model: core + taxonomy + contract + rules. */
export function buildLearnInstructions(
  goal: string,
  prose?: string,
  categories?: CanonicalCategory[],
): string {
  return `${instructionCore(goal, prose)}

PROJECT TAXONOMY:
Choose the single closest canonical category from this list for "category". If none fits, use "Other". Do not invent a new canonical category.
${renderTaxonomyForPrompt(categories)}

${LEARN_OUTPUT_CONTRACT}

${LEARN_ENTITY_RULES}`;
}

/** Max videos we enrich with view/like counts in one channel preview. Each needs
 *  a per-video page fetch, so this bounds the cost. "Popular" sort and view/like
 *  counts apply within this window. Shared by the server (channel.ts) and the UI. */
export const CHANNEL_STATS_CAP = 300;

export const MODEL_USAGE_OPTIONS: {
  value: ModelUsagePolicy;
  label: string;
  blurb: string;
}[] = [
  {
    value: "local_only",
    label: "Free / local only",
    blurb: "Only local/free providers (Claude, Codex CLIs) are shown.",
  },
  {
    value: "confirm_paid_each_time",
    label: "Ask before using paid models",
    blurb: "Paid providers are available, but Distill / Ask / Generate confirm first.",
  },
  {
    value: "paid_allowed_for_manual_actions",
    label: "Allow paid models for manual actions",
    blurb: "Paid models run after you click Distill / Ask / Generate — never during capture.",
  },
];

export function isModelUsagePolicy(v: unknown): v is ModelUsagePolicy {
  return (
    v === "local_only" ||
    v === "confirm_paid_each_time" ||
    v === "paid_allowed_for_manual_actions"
  );
}

function isTranscriptLanguage(v: unknown): v is TranscriptLanguage {
  return typeof v === "string" && /^[a-z]{0,5}$/.test(v);
}

/** Tolerant parse of the JSON `settings` column into a complete settings object. */
export function parseSettings(raw: string | null | undefined): ProjectSettings {
  try {
    const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return {
      modelUsagePolicy: isModelUsagePolicy(obj.modelUsagePolicy)
        ? obj.modelUsagePolicy
        : DEFAULT_MODEL_USAGE_POLICY,
      transcriptLanguage: isTranscriptLanguage(obj.transcriptLanguage)
        ? obj.transcriptLanguage
        : DEFAULT_TRANSCRIPT_LANGUAGE,
      learnInstructions:
        typeof obj.learnInstructions === "string" ? obj.learnInstructions : "",
      taxonomy: parseTaxonomy(obj.taxonomy),
    };
  } catch {
    return {
      modelUsagePolicy: DEFAULT_MODEL_USAGE_POLICY,
      transcriptLanguage: DEFAULT_TRANSCRIPT_LANGUAGE,
      learnInstructions: "",
      taxonomy: DEFAULT_TAXONOMY,
    };
  }
}

/** Paid = any provider that needs an API key (not a local CLI). */
export function isPaidModel(modelId: string): boolean {
  return !isLocalProvider(getModelOption(modelId).provider);
}

/** Models the user is allowed to pick under a given policy. */
export function availableModels(policy: ModelUsagePolicy): ModelOption[] {
  return policy === "local_only"
    ? modelOptions.filter((m) => isLocalProvider(m.provider))
    : modelOptions;
}

/** Should a manual action with this model ask the user to confirm paid spend? */
export function needsPaidConfirm(policy: ModelUsagePolicy, modelId: string): boolean {
  return policy === "confirm_paid_each_time" && isPaidModel(modelId);
}
