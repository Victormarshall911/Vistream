/**
 * Vistream Scraping Service
 *
 * A client-side media scraping architecture built on `fetch` + `cheerio`.
 * All requests spoof a standard Chrome User-Agent to avoid basic bot-detection.
 * Each function gracefully handles failures (network errors, timeouts, DOM
 * mis-matches) by returning null or an empty array — the app should never crash
 * due to a scrape failure.
 *
 * IMPORTANT: VidSrc and AllManga DOM selectors are intentionally left as TODOs.
 * Specific selector logic will be added in the next phase once the desktop
 * reference implementation has been reviewed.
 */

import * as cheerio from 'cheerio';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10_000;

const DEFAULT_HEADERS: HeadersInit = {
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
   * - `m3u8`: HLS playlist — play live via expo-video, NOT downloadable offline.
   * - `mp4`: Direct file — both streamable AND downloadable offline.
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
// Core Utility: fetchCheerio
// ---------------------------------------------------------------------------

/**
 * Fetches an HTML page and returns a loaded Cheerio instance for DOM parsing.
 *
 * @param url     - The URL to fetch.
 * @param headers - Optional extra headers merged on top of DEFAULT_HEADERS.
 *                  Useful for passing Referer, Cookie, or API tokens.
 * @param timeoutMs - Request timeout in milliseconds. Defaults to 10 seconds.
 * @returns A loaded `CheerioAPI` instance, or `null` on any failure.
 *
 * @example
 * const $ = await fetchCheerio('https://vidsrc.to/embed/movie/tt0816692');
 * if (!$) return [];
 * const title = $('h1.title').text().trim();
 */
export async function fetchCheerio(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<cheerio.CheerioAPI | null> {
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
      console.warn(
        `[Vistream Scraper] HTTP ${response.status} for: ${url}`,
      );
      return null;
    }

    const html = await response.text();
    return cheerio.load(html);
  } catch (error: unknown) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[Vistream Scraper] Request timed out after ${timeoutMs}ms: ${url}`);
    } else {
      console.error('[Vistream Scraper] Fetch failed:', error);
    }

    return null; // Always return null gracefully — never let the app crash.
  }
}

/**
 * Convenience wrapper: performs a raw `fetch` and returns the response JSON.
 * Useful for API endpoints that return JSON rather than HTML pages.
 *
 * @param url     - The JSON API endpoint to fetch.
 * @param headers - Optional extra headers merged on top of DEFAULT_HEADERS.
 * @returns Parsed JSON object (unknown type, caller must cast), or `null` on failure.
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
      console.warn(`[Vistream Scraper] JSON HTTP ${response.status} for: ${url}`);
      return null;
    }

    return (await response.json()) as T;
  } catch (error: unknown) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[Vistream Scraper] JSON request timed out: ${url}`);
    } else {
      console.error('[Vistream Scraper] JSON fetch failed:', error);
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider: VidSrc
// Source: https://vidsrc.to
// Content-Type: Movies & TV Series (identified by TMDB ID)
// ---------------------------------------------------------------------------

const VIDSRC_BASE = 'https://vidsrc.to';

/**
 * Scrapes stream sources from VidSrc for a movie or TV series episode.
 *
 * @param tmdbId  - The TMDB ID of the title (e.g. "tt0816692" or "550").
 * @param type    - "movie" or "series".
 * @param season  - Season number (series only).
 * @param episode - Episode number (series only).
 * @returns An array of `StreamResult` objects, or an empty array on failure.
 *
 * @example
 * // Movie
 * const streams = await scrapeVidSrc('550', 'movie');
 *
 * // Series
 * const streams = await scrapeVidSrc('1396', 'series', 1, 1);
 */
export async function scrapeVidSrc(
  tmdbId: string,
  type: 'movie' | 'series',
  season?: number,
  episode?: number,
): Promise<StreamResult[]> {
  // Build the embed URL based on content type.
  let embedUrl: string;
  if (type === 'series') {
    if (season == null || episode == null) {
      console.warn('[VidSrc] Season and episode are required for series type.');
      return [];
    }
    embedUrl = `${VIDSRC_BASE}/embed/tv/${tmdbId}/${season}-${episode}`;
  } else {
    embedUrl = `${VIDSRC_BASE}/embed/movie/${tmdbId}`;
  }

  const $ = await fetchCheerio(embedUrl, {
    Referer: VIDSRC_BASE,
  });

  if (!$) return [];

  const results: StreamResult[] = [];

  // -------------------------------------------------------------------
  // TODO: Insert VidSrc-specific DOM scraping logic here.
  // The desktop reference app's VidSrc implementation will be reviewed
  // and the selectors ported in the next phase.
  //
  // Expected work:
  //   1. Locate the list of server iframes/links on the embed page.
  //   2. For each server, follow the iframe `src` to extract the raw stream URL.
  //   3. Detect whether the stream is .m3u8 or .mp4 and populate StreamResult.
  //
  // Example structure (placeholder, NOT real selectors):
  //   $('ul.servers-list li').each((_i, el) => {
  //     const serverName = $(el).find('.server-name').text().trim();
  //     const iframeSrc  = $(el).find('iframe').attr('src') ?? '';
  //     results.push({ serverName, url: iframeSrc, type: 'm3u8' });
  //   });
  // -------------------------------------------------------------------

  return results;
}

// ---------------------------------------------------------------------------
// Provider: AllManga
// Source: https://allmanga.to
// Content-Type: Anime (identified by AniList ID)
// ---------------------------------------------------------------------------

const ALLMANGA_BASE = 'https://allmanga.to';

/**
 * Scrapes stream sources from AllManga for a specific anime episode.
 *
 * @param anilistId - The AniList ID of the anime series.
 * @param episode   - The episode number to load.
 * @returns An array of `StreamResult` objects, or an empty array on failure.
 *
 * @example
 * const streams = await scrapeAllManga('21', 1); // One Piece Episode 1
 */
export async function scrapeAllManga(
  anilistId: string,
  episode: number,
): Promise<StreamResult[]> {
  const embedUrl = `${ALLMANGA_BASE}/watch/${anilistId}/episode-${episode}`;

  const $ = await fetchCheerio(embedUrl, {
    Referer: ALLMANGA_BASE,
  });

  if (!$) return [];

  const results: StreamResult[] = [];

  // -------------------------------------------------------------------
  // TODO: Insert AllManga-specific DOM scraping logic here.
  // The desktop reference app's AllManga implementation will be reviewed
  // and the selectors ported in the next phase.
  //
  // Expected work:
  //   1. Locate the episode video player and available server list.
  //   2. Extract the stream URL (likely an m3u8 HLS playlist via a CDN).
  //   3. Optionally extract subtitle tracks (.vtt) for each stream.
  //
  // Example structure (placeholder, NOT real selectors):
  //   $('div.video-server a').each((_i, el) => {
  //     const serverName = $(el).text().trim();
  //     const streamUrl  = $(el).attr('data-src') ?? '';
  //     results.push({ serverName, url: streamUrl, type: 'm3u8' });
  //   });
  // -------------------------------------------------------------------

  return results;
}
