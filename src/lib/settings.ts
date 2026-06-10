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
}

/** The default lead-in for the Learn prompt. Editable per project; the goal and
 *  the JSON output contract below are appended in code (not user-editable). */
export const DEFAULT_LEARN_INSTRUCTIONS =
  "You are distilling a source for a specific PROJECT GOAL. Keep ONLY what advances the goal; drop everything else.";

/** The fixed JSON output contract appended to every Learn prompt. The distill
 *  parser reads exactly this shape, so it is code-owned and shown read-only. */
export const LEARN_OUTPUT_CONTRACT = `Return ONE JSON object and nothing outside it, with exactly this shape:
{
  "category": "one short category for this source within the project",
  "tags": ["3 to 8 short tags"],
  "relevance": <integer 0-100: how useful this source is for the PROJECT GOAL>,
  "rationale": "one sentence justifying the relevance score",
  "summary_markdown": "A compact Markdown distillation containing ONLY goal-relevant ideas, concepts, techniques, and concrete action items. Use ## headings and bullet points. No preamble, no code fence around the whole thing."
}`;

/** Assemble the full Learn instruction block: editable prose + the project goal
 *  + the fixed JSON contract. Shared by the distill job and the UI's read-only
 *  prompt preview so the two never drift. */
export function buildLearnInstructions(goal: string, prose?: string): string {
  return `${prose?.trim() || DEFAULT_LEARN_INSTRUCTIONS}

PROJECT GOAL:
${goal || "(no explicit goal set — distill the generally most useful, reusable knowledge.)"}

${LEARN_OUTPUT_CONTRACT}`;
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
    };
  } catch {
    return {
      modelUsagePolicy: DEFAULT_MODEL_USAGE_POLICY,
      transcriptLanguage: DEFAULT_TRANSCRIPT_LANGUAGE,
      learnInstructions: "",
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
