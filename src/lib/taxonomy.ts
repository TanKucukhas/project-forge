/**
 * Canonical knowledge taxonomy + normalization helpers (Phase 3).
 *
 * Letting the model invent categories causes drift ("game design postmortem",
 * "gameplay design", "postmortem" all meaning different rows). We give the model
 * a fixed category list in the distill prompt AND normalize whatever it returns
 * here as a safety net, preserving its raw label as `original_category`.
 *
 * Client- AND server-safe (no node imports) so the UI can render tag labels and
 * the distill job can normalize — keep it free of `server-only` imports.
 */

export type CanonicalCategory = { id: string; name: string; description: string; aliases: string[] };

/** Default taxonomy for a game-design research project. A code constant for now
 *  (Phase 3: "do not overbuild"); a per-project editable taxonomy can layer on
 *  top of this later without changing the normalization contract. */
export const DEFAULT_CATEGORIES: CanonicalCategory[] = [
  {
    id: "game-design-principles",
    name: "Game Design Principles",
    description: "Reusable design rules, player psychology, agency, feedback, decision design, and mental models.",
    aliases: ["gameplay design", "game design", "player agency", "design theory", "core design", "player motivation"],
  },
  {
    id: "mechanics-and-systems",
    name: "Mechanics & Systems",
    description: "Mechanics, systems, economies, progression, and how they interlock.",
    aliases: ["game mechanics", "systems design", "combat systems", "economy systems", "progression systems"],
  },
  {
    id: "level-and-encounter-design",
    name: "Level & Encounter Design",
    description: "Levels, encounters, enemy placement, maps, and spatial design.",
    aliases: ["level design", "encounter design", "enemy placement", "map design", "spatial design"],
  },
  {
    id: "narrative-and-worldbuilding",
    name: "Narrative & Worldbuilding",
    description: "Story, writing, worldbuilding, characters, lore, environmental storytelling.",
    aliases: ["story", "writing", "worldbuilding", "characters", "lore", "environmental storytelling"],
  },
  {
    id: "ux-and-onboarding",
    name: "UX & Onboarding",
    description: "Tutorials, onboarding, controls, readability, feedback, affordance, UI.",
    aliases: ["tutorial", "onboarding", "controls", "readability", "feedback", "affordance", "ui"],
  },
  {
    id: "production-and-scope",
    name: "Production & Scope",
    description: "Scope control, production, solo/indie dev, MVP, prototype scope.",
    aliases: ["scope", "production", "solo dev", "indie production", "mvp", "prototype scope"],
  },
  {
    id: "technical-implementation",
    name: "Technical Implementation",
    description: "Engineering, architecture, engines, tooling, implementation, technical design.",
    aliases: ["engineering", "architecture", "engine", "tooling", "implementation", "technical design"],
  },
  {
    id: "market-and-positioning",
    name: "Market & Positioning",
    description: "Market, Steam, positioning, audience, genre fit, trailers, store pages.",
    aliases: ["market", "steam", "positioning", "audience", "genre fit", "trailer", "store page"],
  },
  {
    id: "case-studies",
    name: "Case Studies",
    description: "Postmortems, breakdowns, retrospectives, and analyses of specific games.",
    aliases: ["postmortem", "breakdown", "example", "classic game postmortem", "game analysis", "case study", "case studies"],
  },
  {
    id: "creative-direction",
    name: "Creative Direction",
    description: "Art direction, visual style, audio, mood, tone, references.",
    aliases: ["art direction", "visual style", "audio", "mood", "tone", "reference"],
  },
  {
    id: "evaluation-and-playtesting",
    name: "Evaluation & Playtesting",
    description: "Playtesting, metrics, validation, evaluation, checklists, QA.",
    aliases: ["playtest", "metrics", "validation", "evaluation", "checklist", "qa"],
  },
  {
    id: "anti-patterns",
    name: "Anti-Patterns",
    description: "Mistakes, pitfalls, bad design, failures, what-not-to-do.",
    aliases: ["mistakes", "pitfalls", "bad design", "failure", "what not to do"],
  },
  {
    id: "other",
    name: "Other",
    description: "Does not fit any category above.",
    aliases: [],
  },
];

export const CATEGORY_NAMES = DEFAULT_CATEGORIES.map((c) => c.name);

/** Source-shape keywords that should win regardless of topical content: a
 *  postmortem about design principles is still a Case Study by source type. */
const SOURCE_TYPE_CASE_STUDY = [
  "postmortem",
  "post-mortem",
  "post mortem",
  "case study",
  "case studies",
  "breakdown",
  "retrospective",
  "deep dive",
  "deep-dive",
];

/**
 * Map a free-form category to the closest canonical name. Order of attempts:
 * exact name/alias → source-shape precedence → longest substring alias → "Other".
 * `categories` defaults to the built-in taxonomy; pass a project's taxonomy to
 * normalize against its customized category list.
 */
export function normalizeCategory(
  input?: string | null,
  categories: CanonicalCategory[] = DEFAULT_CATEGORIES,
): string {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return "Other";
  const hasOther = categories.some((c) => c.name === "Other");

  for (const c of categories) {
    if (c.name.toLowerCase() === raw) return c.name;
    if (c.aliases.some((a) => a.toLowerCase() === raw)) return c.name;
  }

  if (SOURCE_TYPE_CASE_STUDY.some((k) => raw.includes(k))) {
    const cs = categories.find((c) => c.name === "Case Studies");
    if (cs) return cs.name;
  }

  let best: string | null = null;
  let bestLen = 0;
  for (const c of categories) {
    for (const key of [c.name, ...c.aliases]) {
      const k = key.toLowerCase();
      if ((raw.includes(k) || k.includes(raw)) && k.length > bestLen) {
        best = c.name;
        bestLen = k.length;
      }
    }
  }
  return best ?? (hasOther ? "Other" : (categories[0]?.name ?? "Other"));
}

/** Lowercase kebab-case slug for tags (storage + retrieval). "Indirect Control"
 *  → "indirect-control". Empty input → "". */
export function normalizeTag(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Normalize + dedupe a tag list for storage. Drops empties and sentence-like
 *  tags (kept short and reusable per the tag policy). */
export function normalizeTags(tags: string[], max = 8): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const slug = normalizeTag(t);
    // Skip empty or sentence-like (too many words) tags.
    if (!slug || slug.split("-").length > 5) continue;
    if (!out.includes(slug)) out.push(slug);
    if (out.length >= max) break;
  }
  return out;
}

/** Render a stored kebab tag back to a readable label for the UI. */
export function tagLabel(slug: string): string {
  return slug.replace(/-/g, " ");
}

/** Slug for a person/author @mention target: "Sid Meier" → "sid_meier". Uses
 *  underscores (the @sid_meier convention), distinct from hyphenated tags. */
export function normalizeAuthorSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Slug for any non-person entity (game/studio/concept): same underscore form. */
export function normalizeEntitySlug(name: string): string {
  return normalizeAuthorSlug(name);
}

/** Render the canonical category list for the distill prompt. */
export function renderTaxonomyForPrompt(
  categories: CanonicalCategory[] = DEFAULT_CATEGORIES,
): string {
  return categories
    .filter((c) => c.name !== "Other")
    .map((c) => `- ${c.name}: ${c.description}`)
    .join("\n");
}

// ── Per-project taxonomy (stored in project settings) ────────────────────────

export type TagPolicy = { mode: string; format: string; maxTagsPerSource: number };
export type EntityExtraction = {
  extract_authors: boolean;
  extract_referenced_games: boolean;
  extract_referenced_people: boolean;
  extract_referenced_studios: boolean;
  extract_key_terms: boolean;
  extract_synonyms: boolean;
};
export type ProjectTaxonomy = {
  version: number;
  template: string;
  categories: CanonicalCategory[];
  tagPolicy: TagPolicy;
  outputUseCases: string[];
  entityExtraction: EntityExtraction;
};

export const DEFAULT_OUTPUT_USE_CASES = [
  "answer",
  "concept",
  "gdd",
  "prototype_spec",
  "technical_spec",
  "agent_prompt",
  "evaluation",
];

export const DEFAULT_ENTITY_EXTRACTION: EntityExtraction = {
  extract_authors: true,
  extract_referenced_games: true,
  extract_referenced_people: true,
  extract_referenced_studios: true,
  extract_key_terms: true,
  extract_synonyms: true,
};

export const DEFAULT_TAXONOMY: ProjectTaxonomy = {
  version: 1,
  template: "game_design_research",
  categories: DEFAULT_CATEGORIES,
  tagPolicy: { mode: "free_with_normalization", format: "kebab-case", maxTagsPerSource: 8 },
  outputUseCases: DEFAULT_OUTPUT_USE_CASES,
  entityExtraction: DEFAULT_ENTITY_EXTRACTION,
};

/** Stable string for hashing a taxonomy — order-independent on the parts that
 *  matter so cosmetic reordering doesn't churn the hash. */
export function taxonomyHashInput(t: ProjectTaxonomy): string {
  const cats = t.categories
    .map((c) => `${c.name}|${[...c.aliases].sort().join(",")}`)
    .sort()
    .join(";");
  return JSON.stringify({
    cats,
    tagPolicy: t.tagPolicy,
    outputUseCases: [...t.outputUseCases].sort(),
    entityExtraction: t.entityExtraction,
  });
}
