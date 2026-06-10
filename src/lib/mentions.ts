/**
 * Query mention parser (Phase 4 / Phase 12 readiness). Lets a user steer Ask /
 * retrieval inline without a heavy filter UI:
 *   @sid_meier            → author/person slug
 *   #meaningful-choice     → tag slug
 *   category:Game Design   → category (quote multi-word: category:"Case Studies")
 *   game:Civilization      → game entity
 *   use:prototype_spec     → output use-case
 * Everything else is the free-text query. Client- AND server-safe.
 */
import { normalizeAuthorSlug, normalizeTag } from "@/lib/taxonomy";

export type ParsedMentions = {
  authors: string[]; // slugs
  tags: string[]; // slugs
  categories: string[]; // raw category text (normalized by caller)
  games: string[]; // raw game names
  uses: string[]; // output use-cases
  text: string; // remaining free-text query
};

// key:value where value may be "quoted with spaces" or a single bare token.
const FIELD_RE = /(\w+):(?:"([^"]+)"|(\S+))/g;
const AT_RE = /(?:^|\s)@([a-zA-Z0-9_]+)/g;
const HASH_RE = /(?:^|\s)#([a-zA-Z0-9-]+)/g;

export function parseMentions(input: string): ParsedMentions {
  const out: ParsedMentions = { authors: [], tags: [], categories: [], games: [], uses: [], text: "" };
  let text = input;

  // Typed fields first (so e.g. game:"X Y" doesn't get split).
  text = text.replace(FIELD_RE, (_m, key: string, quoted?: string, bare?: string) => {
    const value = (quoted ?? bare ?? "").trim();
    if (!value) return " ";
    switch (key.toLowerCase()) {
      case "category":
      case "cat":
        out.categories.push(value);
        return " ";
      case "game":
        out.games.push(value);
        return " ";
      case "use":
      case "use_for":
        out.uses.push(value.toLowerCase());
        return " ";
      case "tag":
        out.tags.push(normalizeTag(value));
        return " ";
      case "author":
      case "by":
        out.authors.push(normalizeAuthorSlug(value));
        return " ";
      default:
        return _m; // unknown field — leave it in the query
    }
  });

  text = text.replace(AT_RE, (_m, slug: string) => {
    out.authors.push(normalizeAuthorSlug(slug));
    return " ";
  });
  text = text.replace(HASH_RE, (_m, slug: string) => {
    out.tags.push(normalizeTag(slug));
    return " ";
  });

  out.text = text.replace(/\s+/g, " ").trim();
  // Dedupe.
  out.authors = [...new Set(out.authors.filter(Boolean))];
  out.tags = [...new Set(out.tags.filter(Boolean))];
  out.uses = [...new Set(out.uses.filter(Boolean))];
  return out;
}

/** True if the parsed query carries any structured mention (vs. plain text). */
export function hasMentions(m: ParsedMentions): boolean {
  return Boolean(
    m.authors.length || m.tags.length || m.categories.length || m.games.length || m.uses.length,
  );
}
