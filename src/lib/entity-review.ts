/**
 * Lightweight entity-review heuristic (no external data, no LLM). Transcript
 * pipelines corrupt proper names ("Rob Hubbard" → "Ron Hubbard"), and a corrupted
 * name that becomes a retrieval signal quietly pollutes the knowledge base. We
 * flag names that are a near-miss (edit distance 1) of a well-known industry name
 * so they stay visible but marked for review — and are kept OUT of retrieval
 * boosting until confirmed. Deliberately small + domain-curated, not exhaustive.
 *
 * Client- AND server-safe.
 */

/** Well-known game-industry people prone to transcript corruption. Extend as
 *  needed; this is a safety net, not an authority. */
export const KNOWN_PEOPLE = [
  "Rob Hubbard",
  "Peter Molyneux",
  "Will Wright",
  "Sid Meier",
  "David Braben",
  "Glenn Corpes",
  "Les Edgar",
  "Martin Galway",
  "Tim Follin",
  "Jeroen Tel",
  "Chris Sawyer",
  "Shigeru Miyamoto",
  "Hideo Kojima",
  "Warren Spector",
  "Richard Garriott",
  "John Carmack",
  "John Romero",
];

/** Classic Levenshtein edit distance (small strings, simple DP). */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export type EntityReview = { suspects: Set<string>; notes: string[] };

/**
 * Flag person names that are a likely corruption of a known name: exact known
 * names pass; a name within edit-distance 1 (and similar length) of a known name
 * but not equal to it is flagged with the likely correction.
 */
export function reviewPeopleNames(names: string[]): EntityReview {
  const suspects = new Set<string>();
  const notes: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (KNOWN_PEOPLE.some((k) => k.toLowerCase() === lower)) continue; // exact, trusted
    for (const known of KNOWN_PEOPLE) {
      const k = known.toLowerCase();
      if (Math.abs(k.length - lower.length) > 1) continue;
      if (levenshtein(lower, k) === 1) {
        suspects.add(name);
        notes.push(`${name} -> likely ${known}`);
        break;
      }
    }
  }
  return { suspects, notes };
}
