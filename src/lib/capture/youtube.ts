/**
 * YouTube capture helpers — video id parsing, oEmbed metadata, transcript scrape.
 *
 * `youtube-transcript` scrapes YouTube and is the fragile link: when YouTube
 * blocks or changes, it throws. Callers must catch and degrade gracefully (we
 * still save a snapshot from the title/URL) — never let a transcript failure
 * lose the source.
 */
import { YoutubeTranscript } from "youtube-transcript";

export type TranscriptItem = { text: string; duration: number; offset: number };

export type YoutubeMetadata = {
  authorName: string | null;
  thumbnailUrl: string | null;
  title: string | null;
  videoId: string | null;
  description: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  publishedAt: string | null;
  keywords: string[];
};

export function extractVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.hostname === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0] ?? null;
  }
  if (url.hostname.endsWith("youtube.com")) {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const parts = url.pathname.split("/").filter(Boolean);
    if (new Set(["embed", "shorts", "live"]).has(parts[0])) return parts[1] ?? null;
  }
  return null;
}

export function isYoutubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/.test(url);
}

function normalizeTranscript(items: TranscriptItem[]): string {
  return items
    .map((item) => item.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Fetch a transcript, preferring `lang` (ISO 639-1) when given. If that language
 * has no caption track we fall back to YouTube's default track rather than fail —
 * so a video that only has, say, Japanese captions is still captured.
 */
export async function fetchYoutubeTranscript(
  url: string,
  lang?: string,
): Promise<{ segments: TranscriptItem[]; transcript: string; videoId: string; lang: string | null }> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Enter a valid YouTube video URL.");

  const preferred = lang?.trim() || "";
  let segments: TranscriptItem[] | null = null;
  let usedLang: string | null = preferred || null;

  if (preferred) {
    try {
      segments = (await YoutubeTranscript.fetchTranscript(videoId, {
        lang: preferred,
      })) as TranscriptItem[];
    } catch {
      segments = null; // preferred language unavailable — fall through to default
    }
  }
  if (!segments || segments.length === 0) {
    segments = (await YoutubeTranscript.fetchTranscript(videoId)) as TranscriptItem[];
    usedLang = null; // default track
  }

  const transcript = normalizeTranscript(segments);
  if (!transcript) throw new Error("No transcript text was returned for this video.");

  return { segments, transcript, videoId, lang: usedLang };
}

/** oEmbed gives title/author/thumbnail with no key. Never throws — fingerprints the id. */
async function fetchOEmbed(
  url: string,
): Promise<{ authorName: string | null; thumbnailUrl: string | null; title: string | null }> {
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("url", url);
  try {
    const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("oEmbed unavailable.");
    const p = (await response.json()) as {
      author_name?: string;
      thumbnail_url?: string;
      title?: string;
    };
    return {
      authorName: p.author_name ?? null,
      thumbnailUrl: p.thumbnail_url ?? null,
      title: p.title ?? null,
    };
  } catch {
    return { authorName: null, thumbnailUrl: null, title: null };
  }
}

/** Pull a JSON string field out of the raw watch-page HTML and unescape it. */
function readJsonString(html: string, key: string): string | null {
  const match = html.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`));
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return null;
  }
}

/**
 * Scrape the watch page for the free metadata YouTube embeds in
 * `ytInitialPlayerResponse` (description, duration, views, keywords) plus the
 * publish date from a meta tag. Best-effort: any failure degrades to null.
 */
async function fetchWatchPageDetails(videoId: string): Promise<{
  description: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  publishedAt: string | null;
  keywords: string[];
}> {
  const empty = {
    description: null,
    durationSeconds: null,
    viewCount: null,
    likeCount: null,
    publishedAt: null,
    keywords: [] as string[],
  };
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 ProjectForge-local-app",
        "Accept-Language": "en-US,en;q=0.9",
        // Skip the EU consent interstitial so we get the real page.
        Cookie: "CONSENT=YES+1",
      },
      // Bound each fetch so one slow video can't stall a batch enrichment.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return empty;
    const html = await res.text();

    const lengthSeconds = readJsonString(html, "lengthSeconds");
    const viewCount = readJsonString(html, "viewCount");
    const publishedAt =
      html.match(/<meta itemprop="datePublished" content="([^"]+)"/)?.[1] ??
      readJsonString(html, "publishDate");

    let keywords: string[] = [];
    const keywordBlock = html.match(/"keywords":\[((?:[^\]]|\\.)*)\]/)?.[1];
    if (keywordBlock) {
      try {
        keywords = (JSON.parse(`[${keywordBlock}]`) as string[]).filter(Boolean).slice(0, 12);
      } catch {
        keywords = [];
      }
    }

    // Like count isn't in playerResponse; scrape it from ytInitialData best-effort.
    let likeCount: number | null = null;
    const likeExact = html.match(/"likeCount":"(\d+)"/);
    if (likeExact) {
      likeCount = Number(likeExact[1]);
    } else {
      const likeLabel = html.match(/like this video along with ([\d,]+) other/);
      if (likeLabel) likeCount = Number(likeLabel[1].replace(/,/g, "")) + 1;
    }

    return {
      description: readJsonString(html, "shortDescription"),
      durationSeconds: lengthSeconds ? Number(lengthSeconds) : null,
      viewCount: viewCount ? Number(viewCount) : null,
      likeCount,
      publishedAt: publishedAt ?? null,
      keywords,
    };
  } catch {
    return empty;
  }
}

/** Just the engagement stats for one video (used to enrich channel previews). */
export async function fetchVideoStats(
  videoId: string,
): Promise<{ viewCount: number | null; likeCount: number | null }> {
  const d = await fetchWatchPageDetails(videoId);
  return { viewCount: d.viewCount, likeCount: d.likeCount };
}

/** All the metadata we can get for free: oEmbed + watch-page scrape. */
export async function fetchYoutubeMetadata(url: string): Promise<YoutubeMetadata> {
  const videoId = extractVideoId(url);
  const [oembed, details] = await Promise.all([
    fetchOEmbed(url),
    videoId
      ? fetchWatchPageDetails(videoId)
      : Promise.resolve({
          description: null,
          durationSeconds: null,
          viewCount: null,
          likeCount: null,
          publishedAt: null,
          keywords: [] as string[],
        }),
  ]);

  return {
    authorName: oembed.authorName,
    title: oembed.title,
    videoId,
    // Prefer oEmbed's thumbnail; fall back to the always-available hqdefault.
    thumbnailUrl:
      oembed.thumbnailUrl ??
      (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null),
    description: details.description,
    durationSeconds: details.durationSeconds,
    viewCount: details.viewCount,
    likeCount: details.likeCount,
    publishedAt: details.publishedAt,
    keywords: details.keywords,
  };
}
