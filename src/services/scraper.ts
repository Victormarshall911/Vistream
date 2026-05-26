/**
 * Vistream Scraping Service
 *
 * Client-side media scraping using `fetch` + `cheerio`.
 * All requests spoof a standard Chrome User-Agent to avoid basic bot-detection.
 * Failures at any stage return null/[] gracefully — the app never crashes from
 * a scrape failure.
 *
 * Pipeline overview:
 *   VidSrc (movies/TV):  embed page → server list → player iframe → script scan → m3u8
 *   AllManga (anime):    search/resolve ID → episode page → __NEXT_DATA__ JSON → mp4
 */

import * as cheerio from 'cheerio';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10_000;

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

// ---------------------------------------------------------------------------
// TypeScript Interfaces
// ---------------------------------------------------------------------------

/** Represents a search result returned from any media source. */
export interface MediaResult {
  /** Unique internal ID — either a TMDB ID (VidSrc) or AniList ID (AllManga). */
  id: string;
  /** Human-readable title as scraped from the source. */
  title: string;
  /** The media category. Determines which scraper to call downstream. */
  type: 'movie' | 'series' | 'anime';
  /** Absolute URL to the poster/thumbnail image. Empty string if unavailable. */
  posterUrl: string;
}

/** Represents a single streamable source for a piece of media. */
export interface StreamResult {
  /** Human-readable label for the streaming server (e.g. "VidSrc", "Filemoon"). */
  serverName: string;
  /** Direct URL to the media resource. */
  url: string;
  /**
   * Format of the stream.
   * - `m3u8`: HLS playlist — stream live via expo-video. NOT downloadable offline.
   * - `mp4`:  Direct file — streamable AND downloadable offline.
   */
  type: 'm3u8' | 'mp4';
  /** Optional quality descriptor (e.g. "1080p", "720p", "Auto"). */
  quality?: string;
}

/** Represents a subtitle/caption track associated with a stream. */
export interface Subtitle {
  /** Full language name or ISO 639-1 code (e.g. "English", "en"). */
  language: string;
  /** Direct URL to the subtitle file (.vtt or .srt). */
  url: string;
}

// ---------------------------------------------------------------------------
// Internal utility types
// ---------------------------------------------------------------------------

/** Raw shape of a VidSrc server entry parsed from the embed page. */
interface VidSrcServer {
  name: string;
  dataHash: string; // Used to construct the player iframe URL
}

/** Shape of the AllManga __NEXT_DATA__ props we care about. */
interface AllMangaNextData {
  props?: {
    pageProps?: {
      episode?: {
        video?: Array<{
          server?: string;
          link?: string;
          type?: string;
        }>;
        sources?: Array<{
          file?: string;
          label?: string;
          type?: string;
        }>;
      };
    };
  };
}

// ---------------------------------------------------------------------------
// Core Utilities
// ---------------------------------------------------------------------------

/**
 * Fetches a URL and returns the raw response text plus the final resolved URL
 * (after any redirects). Returns null on any error.
 */
async function fetchRaw(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ text: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { ...DEFAULT_HEADERS, ...headers },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Vistream] HTTP ${response.status} for: ${url}`);
      return null;
    }

    const text = await response.text();
    return { text, finalUrl: response.url };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[Vistream] Timed out after ${timeoutMs}ms: ${url}`);
    } else {
      console.error('[Vistream] Fetch failed:', error);
    }
    return null;
  }
}

/**
 * Fetches an HTML page and returns a loaded Cheerio instance.
 * Returns null on any failure.
 */
export async function fetchCheerio(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<cheerio.CheerioAPI | null> {
  const result = await fetchRaw(url, headers, timeoutMs);
  if (!result) return null;
  return cheerio.load(result.text);
}

/**
 * Fetches a JSON endpoint and returns the parsed result typed as T.
 * Returns null on any failure.
 */
export async function fetchJSON<T = unknown>(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...DEFAULT_HEADERS,
        Accept: 'application/json, text/plain, */*',
        ...headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Vistream] JSON HTTP ${response.status} for: ${url}`);
      return null;
    }

    return (await response.json()) as T;
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[Vistream] JSON timed out: ${url}`);
    } else {
      console.error('[Vistream] JSON fetch failed:', error);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers: URL resolution and stream extraction
// ---------------------------------------------------------------------------

/**
 * Resolves a potentially protocol-relative or path-relative URL against a base.
 * e.g. ("//cdn.example.com/v.m3u8", "https://vidsrc.net") → "https://cdn.example.com/v.m3u8"
 */
function resolveUrl(href: string, base: string): string {
  if (!href) return '';
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/**
 * Scans raw script/HTML text for a `.m3u8` URL using multiple strategies:
 *   1. Direct regex scan for any string containing `.m3u8`.
 *   2. Base64-encoded segment scan — finds base64 blobs and decodes them,
 *      then rescans for `.m3u8` in the decoded output.
 *
 * Returns the first found m3u8 URL, or null.
 */
function extractM3u8FromText(text: string): string | null {
  // Strategy 1: Direct scan — matches http(s) URLs ending with .m3u8 (with
  // optional query strings). The negative lookahead prevents matching inside
  // JSON escaped sequences that would produce invalid URLs.
  const directMatch = text.match(
    /https?:\/\/[^\s"'\\]+\.m3u8(?:[^"'\s\\]*)?/,
  );
  if (directMatch?.[0]) {
    return directMatch[0];
  }

  // Strategy 2: Protocol-relative URL scan.
  const protoRelativeMatch = text.match(
    /\/\/[^\s"'\\]+\.m3u8(?:[^"'\s\\]*)?/,
  );
  if (protoRelativeMatch?.[0]) {
    return `https:${protoRelativeMatch[0]}`;
  }

  // Strategy 3: Base64 decode scan.
  // Looks for base64 strings that are at least 40 chars long (enough to encode
  // a meaningful URL). Decodes each candidate and rescans for .m3u8.
  const base64Candidates = text.matchAll(/["']([A-Za-z0-9+/=]{40,})["']/g);
  for (const candidate of base64Candidates) {
    try {
      // atob is available in the React Native / Hermes runtime
      const decoded = atob(candidate[1]);
      const m3u8InDecoded = decoded.match(
        /https?:\/\/[^\s"'\\]+\.m3u8(?:[^"'\s\\]*)?/,
      );
      if (m3u8InDecoded?.[0]) {
        return m3u8InDecoded[0];
      }
    } catch {
      // Not valid base64 — skip silently.
    }
  }

  return null;
}

/**
 * Scans raw script/HTML text for direct `.mp4` URLs.
 * Returns all unique mp4 URLs found.
 */
function extractMp4UrlsFromText(text: string): string[] {
  const matches = text.matchAll(
    /https?:\/\/[^\s"'\\]+\.mp4(?:[^"'\s\\]*)?/g,
  );
  const urls = [...matches].map((m) => m[0]);
  return [...new Set(urls)]; // deduplicate
}

// ---------------------------------------------------------------------------
// Provider: VidSrc  (https://vidsrc.net)
// Content-Type: Movies & TV Series — identified by TMDB ID
//
// Pipeline:
//   Step 1 – Fetch embed page (vidsrc.net/embed/movie?tmdb=... or /embed/tv?...)
//   Step 2 – Parse the list of available servers from the embed page HTML.
//             Each server has a `data-hash` attribute used to build its iframe URL.
//   Step 3 – For each server, fetch its player iframe page.
//   Step 4 – Scan inline <script> tags in the player page for an m3u8 URL
//             using direct regex and/or base64 decode strategies.
//   Step 5 – Return a StreamResult per successfully resolved server.
// ---------------------------------------------------------------------------

const VIDSRC_BASE = 'https://vidsrc.net';
const VIDSRC_REFERER = 'https://vidsrc.net/';

/**
 * Step 2 helper: parses available server entries from the VidSrc embed page.
 * VidSrc renders a server list like:
 *   <div class="server" data-hash="abc123" data-name="Vidplay">...</div>
 */
function parseVidSrcServers($: cheerio.CheerioAPI): VidSrcServer[] {
  const servers: VidSrcServer[] = [];

  // Primary selector pattern for vidsrc.net server list items.
  $('[data-hash]').each((_i, el) => {
    const dataHash = $(el).attr('data-hash')?.trim() ?? '';
    const name =
      $(el).attr('data-name')?.trim() ||
      $(el).find('.server-name, .name, span').first().text().trim() ||
      `Server ${_i + 1}`;
    if (dataHash) {
      servers.push({ name, dataHash });
    }
  });

  // Fallback: some embed page versions use <a> tags with data-id.
  if (servers.length === 0) {
    $('a[data-id], li[data-id]').each((_i, el) => {
      const dataHash = $(el).attr('data-id')?.trim() ?? '';
      const name = $(el).text().trim() || `Server ${_i + 1}`;
      if (dataHash) {
        servers.push({ name, dataHash });
      }
    });
  }

  return servers;
}

/**
 * Step 3–4 helper: given a VidSrc server data-hash, constructs the player iframe
 * URL, fetches it, and scans all inline scripts for an m3u8 source string.
 * Returns the m3u8 URL or null if extraction fails.
 */
async function resolveVidSrcServerUrl(
  dataHash: string,
  referer: string,
): Promise<string | null> {
  // The player iframe URL pattern for vidsrc.net servers.
  const playerUrl = `${VIDSRC_BASE}/rcp/${dataHash}`;

  const result = await fetchRaw(playerUrl, {
    Referer: referer,
    Origin: VIDSRC_BASE,
  });

  if (!result) return null;

  const { text: playerHtml, finalUrl } = result;

  // Scan 1: Search the raw page HTML directly for m3u8.
  const directM3u8 = extractM3u8FromText(playerHtml);
  if (directM3u8) return directM3u8;

  // Scan 2: Parse the player page and check each inline <script> block.
  const $player = cheerio.load(playerHtml);
  let found: string | null = null;

  $player('script').each((_i, scriptEl) => {
    if (found) return false; // Break cheerio iteration once found.
    const scriptContent = $player(scriptEl).html() ?? '';
    const m3u8 = extractM3u8FromText(scriptContent);
    if (m3u8) found = m3u8;
  });

  if (found) return found;

  // Scan 3: Sometimes VidSrc's player redirects to a CDN URL via a second iframe.
  // Extract that iframe src and fetch one level deeper.
  const nestedIframeSrc = $player('iframe[src]').first().attr('src');
  if (nestedIframeSrc) {
    const nestedUrl = resolveUrl(nestedIframeSrc, finalUrl);
    const nestedResult = await fetchRaw(nestedUrl, {
      Referer: finalUrl,
      Origin: VIDSRC_BASE,
    });
    if (nestedResult) {
      const nestedM3u8 = extractM3u8FromText(nestedResult.text);
      if (nestedM3u8) return nestedM3u8;
    }
  }

  return null;
}

/**
 * Scrapes stream sources from VidSrc for a movie or TV series episode.
 *
 * @param tmdbId  - The TMDB numeric ID or IMDb tt-ID of the title.
 * @param type    - "movie" or "series".
 * @param season  - Season number (required for series).
 * @param episode - Episode number (required for series).
 * @returns An array of `StreamResult` objects. Empty array on total failure.
 *
 * @example
 * const streams = await scrapeVidSrc('550', 'movie');
 * const streams = await scrapeVidSrc('1396', 'series', 1, 1);
 */
export async function scrapeVidSrc(
  tmdbId: string,
  type: 'movie' | 'series',
  season?: number,
  episode?: number,
): Promise<StreamResult[]> {
  try {
    // Step 1: Build the embed URL.
    let embedUrl: string;
    if (type === 'series') {
      if (season == null || episode == null) {
        console.warn('[VidSrc] season and episode are required for series.');
        return [];
      }
      embedUrl = `${VIDSRC_BASE}/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
    } else {
      embedUrl = `${VIDSRC_BASE}/embed/movie?tmdb=${tmdbId}`;
    }

    const $ = await fetchCheerio(embedUrl, { Referer: VIDSRC_REFERER });
    if (!$) {
      console.warn('[VidSrc] Failed to fetch embed page:', embedUrl);
      return [];
    }

    // Step 2: Parse available servers.
    const servers = parseVidSrcServers($);
    if (servers.length === 0) {
      console.warn('[VidSrc] No servers found on embed page. HTML may have changed.');
      return [];
    }

    // Steps 3–4: Resolve each server concurrently with Promise.allSettled so
    // that one failing server does not block the others.
    const resolutionPromises = servers.map((server) =>
      resolveVidSrcServerUrl(server.dataHash, embedUrl).then((url) => ({
        server,
        url,
      })),
    );

    const settled = await Promise.allSettled(resolutionPromises);
    const results: StreamResult[] = [];

    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        console.warn('[VidSrc] Server resolution rejected:', outcome.reason);
        continue;
      }
      const { server, url } = outcome.value;
      if (!url) {
        console.warn(`[VidSrc] Could not resolve stream for server: ${server.name}`);
        continue;
      }
      results.push({
        serverName: server.name,
        url,
        type: 'm3u8',
        quality: 'Auto',
      });
    }

    return results;
  } catch (error) {
    console.warn('[VidSrc] Unexpected error:', error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Provider: AllManga  (https://allmanga.to)
// Content-Type: Anime — identified by AniList ID
//
// Pipeline:
//   Step 1 – Resolve AniList ID → AllManga internal slug via the search page.
//             AllManga's search is at: /manga-list?filterType=anime&aniId=<id>
//   Step 2 – Fetch the episode watch page for the resolved slug.
//   Step 3 – Extract the <script id="__NEXT_DATA__"> JSON payload.
//   Step 4 – Traverse the JSON for video source entries (episode.sources or
//             episode.video arrays), collecting .mp4 links.
//   Step 5 – Fallback: raw regex scan of the full page HTML for .mp4 URLs.
// ---------------------------------------------------------------------------

const ALLMANGA_BASE = 'https://allmanga.to';
const ALLMANGA_REFERER = 'https://allmanga.to/';

/**
 * Step 1: Resolves an AniList ID to an AllManga internal series slug.
 * AllManga's search/filter page lists anime with their AniList ID embedded,
 * so we can pick the first result's href to get the slug.
 *
 * Returns the slug string (e.g. "one-piece") or null if not found.
 */
async function resolveAllMangaSlug(anilistId: string): Promise<string | null> {
  const searchUrl = `${ALLMANGA_BASE}/manga-list?filterType=anime&aniId=${anilistId}`;

  const $ = await fetchCheerio(searchUrl, {
    Referer: ALLMANGA_REFERER,
  });

  if (!$) return null;

  // AllManga renders results as card links with href="/anime/<slug>".
  const firstCard = $('a[href*="/anime/"]').first().attr('href');
  if (!firstCard) {
    // Fallback: check for any link containing the aniId in a data attribute.
    const dataLink = $(`[data-aniid="${anilistId}"]`).first().closest('a').attr('href');
    if (!dataLink) return null;
    const slugFromData = dataLink.split('/anime/')[1]?.split('/')[0] ?? null;
    return slugFromData || null;
  }

  // Extract slug from "/anime/<slug>" href.
  const slug = firstCard.split('/anime/')[1]?.split('/')[0] ?? null;
  return slug || null;
}

/**
 * Step 3–4: Given the raw HTML of an AllManga episode page, extracts video
 * source URLs from the embedded __NEXT_DATA__ JSON script tag.
 *
 * AllManga (Next.js app) injects full page state as JSON in:
 *   <script id="__NEXT_DATA__" type="application/json">{ ... }</script>
 *
 * The video sources live at:
 *   props.pageProps.episode.sources[]  → { file, label, type }
 *   props.pageProps.episode.video[]    → { link, server, type }
 */
function extractAllMangaSources(html: string): StreamResult[] {
  const results: StreamResult[] = [];

  const $ = cheerio.load(html);
  const nextDataRaw = $('#__NEXT_DATA__').html();

  if (!nextDataRaw) {
    console.warn('[AllManga] __NEXT_DATA__ script tag not found.');
    return results;
  }

  let nextData: AllMangaNextData;
  try {
    nextData = JSON.parse(nextDataRaw) as AllMangaNextData;
  } catch {
    console.warn('[AllManga] Failed to parse __NEXT_DATA__ JSON.');
    return results;
  }

  const episode = nextData?.props?.pageProps?.episode;
  if (!episode) {
    console.warn('[AllManga] episode key missing from __NEXT_DATA__.');
    return results;
  }

  // Path A: episode.sources array (common for newer site versions).
  if (Array.isArray(episode.sources)) {
    for (const source of episode.sources) {
      const url = source.file?.trim() ?? '';
      if (!url) continue;
      const isM3u8 = url.endsWith('.m3u8') || source.type === 'hls';
      results.push({
        serverName: source.label?.trim() || 'AllManga',
        url,
        type: isM3u8 ? 'm3u8' : 'mp4',
        quality: source.label?.trim() ?? 'Auto',
      });
    }
  }

  // Path B: episode.video array (older site versions).
  if (Array.isArray(episode.video)) {
    for (const vid of episode.video) {
      const url = vid.link?.trim() ?? '';
      if (!url) continue;
      const isM3u8 = url.endsWith('.m3u8') || vid.type === 'hls';
      results.push({
        serverName: vid.server?.trim() || 'AllManga',
        url,
        type: isM3u8 ? 'm3u8' : 'mp4',
        quality: 'Auto',
      });
    }
  }

  return results;
}

/**
 * Scrapes stream sources from AllManga for a specific anime episode.
 *
 * @param anilistId     - The AniList numeric ID of the anime series.
 * @param episodeNumber - The episode number to load (1-indexed).
 * @returns An array of `StreamResult` objects. Empty array on total failure.
 *
 * @example
 * const streams = await scrapeAllManga('21', 1); // One Piece Episode 1
 */
export async function scrapeAllManga(
  anilistId: string,
  episodeNumber: number,
): Promise<StreamResult[]> {
  try {
    // Step 1: Resolve AniList ID → AllManga slug.
    const slug = await resolveAllMangaSlug(anilistId);
    if (!slug) {
      console.warn(`[AllManga] Could not resolve slug for AniList ID: ${anilistId}`);
      return [];
    }

    // Step 2: Fetch the episode watch page.
    const episodeUrl = `${ALLMANGA_BASE}/anime/${slug}/episode-${episodeNumber}`;
    const result = await fetchRaw(episodeUrl, {
      Referer: ALLMANGA_REFERER,
    });

    if (!result) {
      console.warn('[AllManga] Failed to fetch episode page:', episodeUrl);
      return [];
    }

    // Steps 3–4: Try structured __NEXT_DATA__ extraction first.
    const structuredSources = extractAllMangaSources(result.text);
    if (structuredSources.length > 0) {
      return structuredSources;
    }

    // Step 5: Fallback — raw regex scan for .mp4 URLs in the page HTML.
    // This covers edge cases where Next.js SSR is bypassed or the JSON
    // structure changes between site releases.
    console.warn('[AllManga] __NEXT_DATA__ yielded no sources. Falling back to regex scan.');
    const mp4Urls = extractMp4UrlsFromText(result.text);

    if (mp4Urls.length === 0) {
      console.warn('[AllManga] Regex fallback also found no sources for:', episodeUrl);
      return [];
    }

    return mp4Urls.map((url, i) => ({
      serverName: `AllManga Source ${i + 1}`,
      url,
      type: 'mp4' as const,
      quality: 'Auto',
    }));
  } catch (error) {
    console.warn('[AllManga] Unexpected error:', error);
    return [];
  }
}
