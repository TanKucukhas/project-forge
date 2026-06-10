/**
 * PDF capture — convert an uploaded PDF into Markdown for indexing/distillation.
 * The raw PDF bytes are persisted separately (see `saveSourcePdf`); this produces
 * the Markdown snapshot the rest of the pipeline (FTS, Ask, Distill) works on.
 * Conversion is deterministic parsing (@opendocsg/pdf2md) — no model runs here.
 */
import "server-only";
import pdf2md from "@opendocsg/pdf2md";
import type { ResourceSnapshot } from "./resource-fetch";

// PDFs can be book-length; keep a generous cap so chapters survive but a runaway
// file can't blow up the index.
const MAX_PDF_TEXT = 500_000;

export async function snapshotFromPdf(
  data: Uint8Array,
  filename: string,
  title?: string,
): Promise<ResourceSnapshot> {
  let markdown = "";
  try {
    // pdf2md consumes the buffer, so pass a copy — the caller still needs the
    // original bytes to save the raw PDF to disk. It infers Markdown structure
    // (headings, lists) from the PDF's layout/font sizes.
    markdown = await pdf2md(new Uint8Array(data));
  } catch (e) {
    throw new Error(
      `Could not convert the PDF to Markdown: ${e instanceof Error ? e.message : "unknown error"}.`,
    );
  }

  const content = markdown.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_PDF_TEXT);
  const cleanName = filename.replace(/\.pdf$/i, "").trim();

  return {
    type: "pdf",
    url: "",
    title: title?.trim() || cleanName || "PDF document",
    author: null,
    description: null,
    thumbnail: null,
    content,
    transcriptFetched: false,
    channel: null,
    durationSeconds: null,
    viewCount: null,
    likeCount: null,
    publishedAt: null,
    keywords: [],
  };
}
