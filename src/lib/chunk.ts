/**
 * Naive word-window chunker for FTS5 indexing. Splits text into ~`size`-word
 * windows with `overlap` words of context carried between them. Good enough for
 * keyword retrieval — embeddings/semantic chunking are explicitly deferred
 * (FTS5 before any vector DB).
 */
export type Chunk = { index: number; content: string; tokenCount: number };

export function chunkText(text: string, size = 220, overlap = 40): Chunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const step = Math.max(1, size - overlap);
  const chunks: Chunk[] = [];
  for (let start = 0, index = 0; start < words.length; start += step, index += 1) {
    const slice = words.slice(start, start + size);
    chunks.push({
      index,
      content: slice.join(" "),
      // Rough token estimate — word count is a fine proxy for FTS sizing.
      tokenCount: slice.length,
    });
    if (start + size >= words.length) break;
  }
  return chunks;
}
