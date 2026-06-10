/**
 * Fetch a raw snapshot from a URL — YouTube (transcript + metadata) or a web
 * page (stripped text). The returned `content` is the durable raw text that
 * gets persisted as the source snapshot BEFORE any model touches it.
 */
import {
  fetchYoutubeMetadata,
  fetchYoutubeTranscript,
  isYoutubeUrl,
} from "./youtube";
import type { SourceType } from "@/lib/types";

export type ResourceSnapshot = {
  type: SourceType;
  url: string;
  title: string | null;
  author: string | null;
  description: string | null;
  thumbnail: string | null;
  content: string;
  transcriptFetched: boolean;
  /** Relative path to a saved raw binary (e.g. the original PDF), if any. */
  rawFilePath?: string | null;
  /** Free YouTube extras (null/empty for other source types). */
  channel: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  publishedAt: string | null;
  keywords: string[];
};

const MAX_WEB_TEXT = 12_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function readMeta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyFirst = html.match(
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i",
    ),
  );
  const contentFirst = html.match(
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
      "i",
    ),
  );
  return propertyFirst?.[1] ?? contentFirst?.[1] ?? null;
}

function readTitle(html: string): string | null {
  return (
    readMeta(html, "og:title") ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ??
    null
  );
}

// A realistic desktop-Chrome header set. Many publishers (Medium, Substack, news
// sites) reject requests whose User-Agent isn't a real browser with a flat 403,
// so we present as one. No cookies/credentials are sent — public pages only.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

function fetchWebPage(url: string): Promise<Response> {
  return fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
}

export type FetchOptions = { transcriptLanguage?: string };

export async function fetchResourceSnapshot(
  url: string,
  opts: FetchOptions = {},
): Promise<ResourceSnapshot> {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) throw new Error("Resource URL is empty.");

  if (isYoutubeUrl(normalizedUrl)) {
    const metadata = await fetchYoutubeMetadata(normalizedUrl);
    let transcript = "";
    let transcriptFetched = false;
    try {
      transcript = (await fetchYoutubeTranscript(normalizedUrl, opts.transcriptLanguage)).transcript;
      transcriptFetched = transcript.length > 0;
    } catch {
      // YouTube blocked it or there are no captions — degrade to title/URL.
      transcript = "";
    }

    return {
      type: "youtube",
      url: normalizedUrl,
      title: metadata.title,
      author: metadata.authorName,
      description: metadata.description,
      thumbnail: metadata.thumbnailUrl,
      // Prefer the transcript; if unavailable, fall back to the description, then title/URL.
      content: transcript || metadata.description || metadata.title || normalizedUrl,
      transcriptFetched,
      channel: metadata.authorName,
      durationSeconds: metadata.durationSeconds,
      viewCount: metadata.viewCount,
      likeCount: metadata.likeCount,
      publishedAt: metadata.publishedAt,
      keywords: metadata.keywords,
    };
  }

  const response = await fetchWebPage(normalizedUrl);
  if (!response.ok) {
    if (response.status === 403 || response.status === 401) {
      throw new Error(
        `${normalizedUrl} blocked the request (${response.status}). Some sites (e.g. Medium) ` +
          `refuse non-browser fetches or require login — open the article and paste its text into the notes box instead.`,
      );
    }
    throw new Error(`Could not fetch ${normalizedUrl}: ${response.status}`);
  }

  const html = await response.text();
  return {
    type: "website",
    url: normalizedUrl,
    title: readTitle(html),
    author: readMeta(html, "author"),
    description: readMeta(html, "description") ?? readMeta(html, "og:description"),
    thumbnail: readMeta(html, "og:image"),
    content: stripHtml(html).slice(0, MAX_WEB_TEXT),
    transcriptFetched: false,
    channel: null,
    durationSeconds: null,
    viewCount: null,
    likeCount: null,
    publishedAt: null,
    keywords: [],
  };
}

/** Build a snapshot from raw pasted text (no fetch). */
export function snapshotFromNotes(text: string, title?: string): ResourceSnapshot {
  const trimmed = text.trim();
  return {
    type: "note",
    url: "",
    title: title?.trim() || "Pasted note",
    author: null,
    description: null,
    thumbnail: null,
    content: trimmed,
    transcriptFetched: false,
    channel: null,
    durationSeconds: null,
    viewCount: null,
    likeCount: null,
    publishedAt: null,
    keywords: [],
  };
}
