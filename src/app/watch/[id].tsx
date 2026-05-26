/**
 * src/app/watch/[id].tsx — Watch Screen
 *
 * Dynamic route that accepts the following query/route parameters:
 *   - id      (string)  — TMDB numeric/IMDb ID (movies/series) or AniList ID (anime)
 *   - type    (string)  — "movie" | "series" | "anime"
 *   - season  (string)  — season number, series only
 *   - episode (string)  — episode number, series or anime
 *   - title   (string)  — human-readable title for the header (optional)
 *
 * Scraping lifecycle:
 *   1. On mount, fire the correct scraper based on `type`.
 *   2. Show a loading spinner + status text while scraping.
 *   3. On success, pick the first valid stream and pass it to <Player />.
 *   4. If multiple servers are returned, render a server picker below the player.
 *   5. On total failure, show a friendly error state with a retry button.
 *
 * Memory management:
 *   - A `cancelled` ref (closure guard) prevents setState calls after unmount
 *     in case the scraper resolves after the user has already navigated back.
 *   - Player.tsx handles its own native cleanup via player.release().
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';

import Player from '@/components/Player';
import { scrapeVidSrc, scrapeAllManga, StreamResult } from '@/services/scraper';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState = 'idle' | 'loading' | 'success' | 'error';

type WatchParams = {
  id: string;
  type: 'movie' | 'series' | 'anime';
  title?: string;
  season?: string;
  episode?: string;
  localUri?: string; // Add support for playing downloaded files
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a readable label like "S2 E5" or "Episode 3". */
function buildEpisodeLabel(
  type: string,
  season?: string,
  episode?: string,
): string {
  if (type === 'anime' && episode) return `Episode ${episode}`;
  if (type === 'series' && season && episode) return `S${season} E${episode}`;
  return '';
}

/** Maps a stream type to a badge style class. */
function streamTypeBadgeClass(type: 'm3u8' | 'mp4'): string {
  return type === 'mp4'
    ? 'bg-emerald-900 text-emerald-300'
    : 'bg-blue-900 text-blue-300';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WatchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<WatchParams>();

  const { id, type, title, season, episode, localUri } = params;

  // Parsed numerics (season/episode arrive as strings from the router).
  const seasonNum = season ? parseInt(season, 10) : undefined;
  const episodeNum = episode ? parseInt(episode, 10) : undefined;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [statusText, setStatusText] = useState('Resolving source streams...');
  const [streams, setStreams] = useState<StreamResult[]>([]);
  const [activeStreamIndex, setActiveStreamIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  // Guard: prevents setState after unmount if the scraper resolves late.
  const cancelledRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Screen orientation cleanup on unmount
  // Ensures portrait is restored if the user navigates back from fullscreen.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (Platform.OS !== 'web') {
        ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.PORTRAIT_UP,
        ).catch(() => ScreenOrientation.unlockAsync().catch(() => {}));
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Scraping pipeline
  // ---------------------------------------------------------------------------

  const runScraper = useCallback(async () => {
    // If playing an offline file, skip scraping completely
    if (localUri) {
      setStreams([{
        serverName: 'Local Storage',
        url: localUri,
        type: 'mp4',
        quality: 'Offline',
      }]);
      setLoadState('success');
      return;
    }

    if (!id || !type) {
      setErrorMessage('Missing required parameters (id, type).');
      setLoadState('error');
      return;
    }

    setLoadState('loading');
    setErrorMessage('');
    setStreams([]);
    setActiveStreamIndex(0);

    setStatusText('Resolving source streams...');

    let results: StreamResult[] = [];

    try {
      if (type === 'anime') {
        if (!episodeNum) {
          throw new Error('Episode number is required for anime.');
        }
        setStatusText('Contacting AllManga…');
        results = await scrapeAllManga(id, episodeNum);
      } else {
        // movie or series
        if (type === 'series' && (seasonNum == null || episodeNum == null)) {
          throw new Error('Season and episode are required for series.');
        }
        setStatusText('Contacting VidSrc…');
        results = await scrapeVidSrc(id, type, seasonNum, episodeNum);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An unknown scraping error occurred.';
      if (!cancelledRef.current) {
        setErrorMessage(message);
        setLoadState('error');
      }
      return;
    }

    if (cancelledRef.current) return;

    if (results.length === 0) {
      setErrorMessage(
        'No streams were found for this title.\n\nThe provider may have changed its structure, or the content is unavailable in your region.',
      );
      setLoadState('error');
      return;
    }

    setStreams(results);
    setActiveStreamIndex(0);
    setLoadState('success');
  }, [id, type, seasonNum, episodeNum]);

  // Run on mount.
  useEffect(() => {
    void runScraper();
  }, [runScraper]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const activeStream = streams[activeStreamIndex] ?? null;
  const episodeLabel = buildEpisodeLabel(type ?? '', season, episode);
  const displayTitle = title ?? id ?? 'Watch';
  const headerTitle = episodeLabel
    ? `${displayTitle} · ${episodeLabel}`
    : displayTitle;

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderLoading() {
    return (
      <View className="flex-1 items-center justify-center bg-black gap-y-4">
        <ActivityIndicator size="large" color="#ef4444" />
        <Text className="text-zinc-400 text-sm tracking-wide">{statusText}</Text>
      </View>
    );
  }

  function renderError() {
    return (
      <View className="flex-1 items-center justify-center bg-black px-8 gap-y-6">
        {/* Error icon placeholder */}
        <View className="w-16 h-16 rounded-full bg-red-950 items-center justify-center">
          <Text className="text-red-400 text-3xl">✕</Text>
        </View>

        <Text className="text-white text-lg font-semibold text-center">
          Stream Unavailable
        </Text>
        <Text className="text-zinc-500 text-sm text-center leading-relaxed">
          {errorMessage}
        </Text>

        <Pressable
          onPress={() => void runScraper()}
          className="mt-2 bg-red-600 px-8 py-3 rounded-full active:opacity-70"
        >
          <Text className="text-white font-semibold text-sm tracking-wide">
            Retry
          </Text>
        </Pressable>

        <Pressable onPress={() => router.back()} className="active:opacity-60">
          <Text className="text-zinc-500 text-sm">Go back</Text>
        </Pressable>
      </View>
    );
  }

  function renderServerPicker() {
    if (streams.length <= 1) return null;

    return (
      <View className="mt-4 px-4">
        <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-3">
          Available Servers
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-x-2"
        >
          {streams.map((stream, index) => {
            const isActive = index === activeStreamIndex;
            return (
              <Pressable
                key={`${stream.serverName}-${index}`}
                onPress={() => setActiveStreamIndex(index)}
                className={`flex-row items-center gap-x-2 px-4 py-2 rounded-full border ${
                  isActive
                    ? 'border-red-500 bg-red-950'
                    : 'border-zinc-700 bg-zinc-900'
                } active:opacity-70`}
              >
                {/* Format badge */}
                <View
                  className={`px-1.5 py-0.5 rounded text-xs font-bold ${streamTypeBadgeClass(
                    stream.type,
                  )}`}
                >
                  <Text
                    className={`text-xs font-bold ${
                      stream.type === 'mp4'
                        ? 'text-emerald-300'
                        : 'text-blue-300'
                    }`}
                  >
                    {stream.type.toUpperCase()}
                  </Text>
                </View>

                <Text
                  className={`text-sm ${
                    isActive ? 'text-white font-semibold' : 'text-zinc-400'
                  }`}
                >
                  {stream.serverName}
                </Text>

                {stream.quality && (
                  <Text className="text-xs text-zinc-500">{stream.quality}</Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  function renderSuccess() {
    if (!activeStream) return renderError();

    return (
      <ScrollView
        className="flex-1 bg-black"
        contentContainerClassName="pb-12"
        bounces={false}
      >
        {/* Video player — pinned to top, 16:9 */}
        <Player streamUrl={activeStream.url} autoPlay />

        {/* Server picker */}
        {renderServerPicker()}

        {/* Metadata row */}
        <View className="mt-6 px-4 gap-y-1">
          <Text className="text-white text-xl font-bold" numberOfLines={2}>
            {displayTitle}
          </Text>
          {!!episodeLabel && (
            <Text className="text-zinc-500 text-sm">{episodeLabel}</Text>
          )}
          <View className="flex-row items-center gap-x-3 mt-1">
            <View
              className={`px-2 py-0.5 rounded ${
                activeStream.type === 'mp4' ? 'bg-emerald-900' : 'bg-blue-900'
              }`}
            >
              <Text
                className={`text-xs font-semibold ${
                  activeStream.type === 'mp4'
                    ? 'text-emerald-300'
                    : 'text-blue-300'
                }`}
              >
                {activeStream.type === 'mp4' ? 'MP4 · Offline Ready' : 'HLS Stream'}
              </Text>
            </View>
            <Text className="text-zinc-600 text-xs">
              via {activeStream.serverName}
            </Text>
          </View>
        </View>

        {/* Divider */}
        <View className="h-px bg-zinc-800 mx-4 mt-6" />

        {/* Stream info */}
        <View className="mt-4 px-4 gap-y-2">
          <Text className="text-zinc-500 text-xs uppercase tracking-widest">
            Stream Info
          </Text>
          <Text className="text-zinc-400 text-xs font-mono" numberOfLines={2}>
            {activeStream.url}
          </Text>
        </View>
      </ScrollView>
    );
  }

  // ---------------------------------------------------------------------------
  // Root render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Configure the Expo Router stack header for this screen */}
      <Stack.Screen
        options={{
          title: headerTitle,
          headerStyle: { backgroundColor: '#09090b' },
          headerTintColor: '#ffffff',
          headerTitleStyle: { fontSize: 14 },
        }}
      />

      <View className="flex-1 bg-black">
        {loadState === 'loading' && renderLoading()}
        {loadState === 'error' && renderError()}
        {loadState === 'success' && renderSuccess()}
      </View>
    </>
  );
}
