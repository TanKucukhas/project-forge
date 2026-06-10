/**
 * YouTube channel enumeration via yt-dlp (a local binary, spawned server-side
 * like the model CLIs). Returns a flat list of videos for a channel so each can
 * be enqueued as its own capture job. Localhost-gated upstream.
 *
 * Set YTDLP_PATH to override the binary location; defaults to `yt-dlp` on PATH.
 *
 * Cost notes: flat listing is fast and gives id/title/duration/date (date via
 * the `approximate_date` extractor arg). View/like counts are NOT in flat mode —
 * they require a per-video page fetch, so they're enriched on demand and capped.
 */
import "server-only";
import { spawn } from "node:child_process";
import { CHANNEL_STATS_CAP } from "@/lib/settings";

export type ChannelVideo = {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  durationSeconds: number | null;
  uploadDate: string | null; // ISO yyyy-mm-dd (approximate)
  viewCount: number | null; // null unless stats were enriched
  likeCount: number | null;
};

const YTDLP_TIMEOUT_MS = 180_000;
const DEFAULT_LIMIT = 100;
/** Max videos we'll enrich with view/like counts in one preview. */
const STATS_CAP = CHANNEL_STATS_CAP;

function isPlaylistInput(s: string): boolean {
  return /[?&]list=/.test(s) || /\/playlist\?/.test(s);
}

/** A "bulk" source: a channel OR a playlist — both expand to many videos. */
export function isChannelInput(input: string): boolean {
  const s = input.trim();
  if (isPlaylistInput(s)) return true;
  if (/\/watch\?|youtu\.be\//.test(s)) return false; // a single video, not a channel
  return (
    /youtube\.com\/(@|channel\/|c\/|user\/)/.test(s) ||
    /youtube\.com\/.+\/videos/.test(s) ||
    s.startsWith("@")
  );
}

function toChannelUrl(input: string): string {
  const s = input.trim();
  // Playlists resolve directly — don't rewrite them to a /videos channel tab.
  if (isPlaylistInput(s)) return s;
  if (/^https?:\/\//.test(s)) {
    return /\/videos\/?$/.test(s) ? s : `${s.replace(/\/$/, "")}/videos`;
  }
  const handle = s.startsWith("@") ? s : `@${s.replace(/\s+/g, "")}`;
  return `https://www.youtube.com/${handle}/videos`;
}

function runYtdlp(args: string[], lenient = false): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const bin = process.env.YTDLP_PATH ?? "yt-dlp";
    const child = spawn(bin, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, YTDLP_TIMEOUT_MS);

    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error("yt-dlp was not found. Install it or set YTDLP_PATH.")
          : err,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error("yt-dlp timed out."));
      // Lenient (stats with --ignore-errors): keep whatever rows we got even if
      // a few videos fail and the exit code is non-zero.
      if (code !== 0 && !lenient) {
        return reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}.`));
      }
      resolve(stdout);
    });
  });
}

/**
 * Fetch view/like counts via yt-dlp (not raw page-scraping, which YouTube
 * rate-limits / bot-walls). Batched into a few parallel processes for speed.
 * Exported so the UI can enrich a page of the preview progressively.
 */
export async function fetchVideoStatsBatch(
  ids: string[],
): Promise<Map<string, { viewCount: number | null; likeCount: number | null }>> {
  const map = new Map<string, { viewCount: number | null; likeCount: number | null }>();
  const CHUNK = 8;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

  // Up to 8 parallel yt-dlp processes; each handles a chunk sequentially.
  await mapWithConcurrency(chunks, 8, async (chunk) => {
    const urls = chunk.map((id) => `https://www.youtube.com/watch?v=${id}`);
    let out = "";
    try {
      out = await runYtdlp(
        [
          "--no-warnings",
          "--ignore-errors",
          "--print",
          "%(id)s|%(view_count)s|%(like_count)s",
          ...urls,
        ],
        true,
      );
    } catch {
      return; // whole chunk failed — leave those null
    }
    for (const line of out.split("\n")) {
      const [id, vc, lc] = line.trim().split("|");
      if (!id) continue;
      const num = (s: string | undefined) =>
        s && s !== "NA" && /^\d+$/.test(s) ? Number(s) : null;
      map.set(id, { viewCount: num(vc), likeCount: num(lc) });
    }
  });
  return map;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export type ChannelSort = "popular" | "latest" | "oldest";

/** Fetch a single video's metadata (for the pre-capture preview) via yt-dlp. */
export async function fetchVideoPreview(url: string): Promise<ChannelVideo> {
  const out = await runYtdlp(["--no-warnings", "--no-playlist", "--dump-json", url], true);
  const line = out.trim().split("\n").find(Boolean);
  if (!line) throw new Error("Could not read that video.");
  const o = JSON.parse(line) as {
    id?: string;
    title?: string;
    duration?: number | null;
    view_count?: number | null;
    like_count?: number | null;
    upload_date?: string | null;
    channel?: string | null;
  };
  if (!o.id) throw new Error("Could not read that video.");
  return {
    id: o.id,
    title: o.title ?? o.id,
    url: `https://www.youtube.com/watch?v=${o.id}`,
    thumbnail: `https://i.ytimg.com/vi/${o.id}/mqdefault.jpg`,
    durationSeconds: typeof o.duration === "number" ? o.duration : null,
    uploadDate:
      typeof o.upload_date === "string" && o.upload_date.length === 8
        ? `${o.upload_date.slice(0, 4)}-${o.upload_date.slice(4, 6)}-${o.upload_date.slice(6, 8)}`
        : null,
    viewCount: typeof o.view_count === "number" ? o.view_count : null,
    likeCount: typeof o.like_count === "number" ? o.like_count : null,
  };
}

export type ListChannelOptions = {
  /** Page start (0-based) — for infinite scroll / "get more". */
  offset?: number;
  /** Page size. */
  count?: number;
  /** Enrich view/like counts for this page (for display + popular numbers). */
  withStats?: boolean;
  /** Which YouTube ordering to pull. "popular" uses the channel's real Popular tab. */
  sort?: ChannelSort;
};

// Cache resolved channel ids so switching sorts / re-previewing doesn't re-run
// the extra yt-dlp lookup each time. Survives dev HMR via a module global.
const channelIdCache = ((globalThis as { __pfChannelIds?: Map<string, string> }).__pfChannelIds ??=
  new Map<string, string>());

/** Resolve a channel's UC… id from a handle/URL (needed for the popular playlist). */
async function resolveChannelId(input: string): Promise<string | null> {
  const direct = input.match(/\/channel\/(UC[\w-]+)/);
  if (direct) return direct[1];
  const cached = channelIdCache.get(input);
  if (cached) return cached;
  try {
    const out = await runYtdlp(
      ["--playlist-items", "1", "--no-warnings", "--print", "%(channel_id)s", toChannelUrl(input)],
      true,
    );
    const id = out.trim().split("\n")[0]?.trim();
    if (id && /^UC[\w-]+$/.test(id)) {
      channelIdCache.set(input, id);
      return id;
    }
    return null;
  } catch {
    return null;
  }
}

export async function listChannelVideos(
  input: string,
  opts: ListChannelOptions = {},
): Promise<{ videos: ChannelVideo[]; hasMore: boolean; statsLoaded: number }> {
  const offset = Math.max(0, opts.offset ?? 0);
  const count = opts.count ?? DEFAULT_LIMIT;
  const sort: ChannelSort = opts.sort ?? "latest";
  const playlist = isPlaylistInput(input);

  // Choose the YouTube source by sort. Channels expose a hidden "popular videos"
  // playlist (UULP<id>) ordered by all-time views — exactly the Popular tab
  // (YouTube caps it at 200). Oldest has no playlist, so we reverse the uploads.
  let url = toChannelUrl(input);
  let reverse = false;
  if (!playlist && sort === "popular") {
    const cid = await resolveChannelId(input);
    if (cid) url = `https://www.youtube.com/playlist?list=UULP${cid.slice(2)}`;
  } else if (!playlist && sort === "oldest") {
    reverse = true;
  }

  // Ranged pagination (`-I a:b`) fetches only the requested page — except oldest,
  // which needs the full feed to reverse, then slices the page client-side.
  const args = [
    "--flat-playlist",
    "--dump-json",
    // approximate_date surfaces a per-video upload timestamp in flat mode.
    "--extractor-args",
    "youtubetab:approximate_date",
    ...(reverse ? [] : ["-I", `${offset + 1}:${offset + count}`]),
    url,
  ];
  const out = await runYtdlp(args);

  const videos: ChannelVideo[] = [];
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as {
        id?: string;
        title?: string;
        duration?: number | null;
        timestamp?: number | null;
      };
      if (obj.id) {
        videos.push({
          id: obj.id,
          title: obj.title ?? obj.id,
          url: `https://www.youtube.com/watch?v=${obj.id}`,
          thumbnail: `https://i.ytimg.com/vi/${obj.id}/mqdefault.jpg`,
          durationSeconds: typeof obj.duration === "number" ? obj.duration : null,
          uploadDate:
            typeof obj.timestamp === "number"
              ? new Date(obj.timestamp * 1000).toISOString().slice(0, 10)
              : null,
          viewCount: null,
          likeCount: null,
        });
      }
    } catch {
      // skip non-JSON noise lines
    }
  }
  if (!videos.length && offset === 0) throw new Error("No videos found for that channel.");

  // Compute this page + whether more remain.
  let page: ChannelVideo[];
  let hasMore: boolean;
  if (reverse) {
    const ordered = videos.reverse();
    page = ordered.slice(offset, offset + count);
    hasMore = offset + count < ordered.length;
  } else {
    // -I already returned exactly the requested window.
    page = videos;
    // Popular is fetched in one shot (its own configured count, YouTube-capped at
    // 200), so there's nothing to paginate. Latest paginates while pages stay full.
    hasMore = sort === "popular" && !playlist ? false : videos.length >= count;
  }

  let statsLoaded = 0;
  if (opts.withStats && page.length) {
    const stats = await fetchVideoStatsBatch(page.slice(0, STATS_CAP).map((v) => v.id));
    for (const v of page) {
      const s = stats.get(v.id);
      if (s) {
        v.viewCount = s.viewCount;
        v.likeCount = s.likeCount;
        if (s.viewCount != null) statsLoaded += 1;
      }
    }
  }

  return { videos: page, hasMore, statsLoaded };
}
