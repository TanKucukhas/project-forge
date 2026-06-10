/**
 * Credibility heuristic — a transparent popularity proxy, NOT a truth signal.
 * Combines reach (view count, log-scaled) with engagement (like/view ratio).
 * Returns 0-100, or null when we have no view data (e.g. non-YouTube sources).
 */
export function credibilityScore(
  viewCount: number | null,
  likeCount: number | null,
): number | null {
  if (viewCount == null || viewCount <= 0) return null;

  // Reach: 10^7 (10M) views ≈ full 60 points; scales by order of magnitude.
  const reach = Math.min(60, Math.round((Math.log10(viewCount + 1) / 7) * 60));

  // Engagement: a ~5% like/view ratio ≈ full 40 points (typical YT is 1–5%).
  const ratio = likeCount && viewCount ? likeCount / viewCount : 0;
  const engagement = Math.min(40, Math.round((ratio / 0.05) * 40));

  return Math.max(0, Math.min(100, reach + engagement));
}
