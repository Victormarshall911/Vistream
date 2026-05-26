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
  StyleSheet,
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

  // Parsed numerics — default series to S1E1 when not provided.
  const seasonNum = season ? parseInt(season, 10) : (type === 'series' ? 1 : undefined);
  const episodeNum = episode ? parseInt(episode, 10) : (type === 'series' || type === 'anime' ? 1 : undefined);
  const effectiveSeason = type === 'series' ? (seasonNum ?? 1) : seasonNum;
  const effectiveEpisode = (type === 'series' || type === 'anime') ? (episodeNum ?? 1) : episodeNum;

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
        setStatusText('Contacting AllManga…');
        results = await scrapeAllManga(id, effectiveEpisode ?? 1);
      } else {
        // movie or series — series defaults to S1E1 if not specified
        setStatusText('Contacting VidSrc…');
        results = await scrapeVidSrc(id, type, effectiveSeason, effectiveEpisode);
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
  }, [id, type, effectiveSeason, effectiveEpisode, localUri]);

  // Run on mount.
  useEffect(() => {
    void runScraper();
  }, [runScraper]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const activeStream = streams[activeStreamIndex] ?? null;
  const dispSeason = season ?? (type === 'series' ? '1' : undefined);
  const dispEpisode = episode ?? (type === 'series' || type === 'anime' ? '1' : undefined);
  const episodeLabel = buildEpisodeLabel(type ?? '', dispSeason, dispEpisode);
  const displayTitle = title ?? id ?? 'Watch';
  const headerTitle = episodeLabel
    ? `${displayTitle} · ${episodeLabel}`
    : displayTitle;

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderLoading() {
    return (
      <View style={ws.centered}>
        <ActivityIndicator size="large" color="#ef4444" />
        <Text style={ws.statusText}>{statusText}</Text>
      </View>
    );
  }

  function renderError() {
    return (
      <View style={ws.centered}>
        <View style={ws.errorIcon}>
          <Text style={ws.errorIconText}>✕</Text>
        </View>
        <Text style={ws.errorTitle}>Stream Unavailable</Text>
        <Text style={ws.errorBody}>{errorMessage}</Text>
        <Pressable onPress={() => void runScraper()} style={ws.retryBtn}>
          <Text style={ws.retryBtnText}>Retry</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} style={ws.backBtn}>
          <Text style={ws.backBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  function renderServerPicker() {
    if (streams.length <= 1) return null;
    return (
      <View style={ws.serverPickerWrap}>
        <Text style={ws.serverPickerLabel}>Available Servers</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {streams.map((stream, index) => {
            const isActive = index === activeStreamIndex;
            return (
              <Pressable
                key={`${stream.serverName}-${index}`}
                onPress={() => setActiveStreamIndex(index)}
                style={[ws.serverChip, isActive && ws.serverChipActive]}
              >
                <View style={[ws.typeBadge, stream.type === 'mp4' ? ws.typeBadgeMp4 : ws.typeBadgeHls]}>
                  <Text style={[ws.typeBadgeText, stream.type === 'mp4' ? ws.typeBadgeTextMp4 : ws.typeBadgeTextHls]}>
                    {stream.type.toUpperCase()}
                  </Text>
                </View>
                <Text style={[ws.serverChipName, isActive && ws.serverChipNameActive]}>
                  {stream.serverName}
                </Text>
                {stream.quality && <Text style={ws.serverChipQuality}>{stream.quality}</Text>}
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
      <ScrollView style={ws.successScroll} contentContainerStyle={ws.successContent} bounces={false}>
        <Player streamUrl={activeStream.url} autoPlay />
        {renderServerPicker()}
        <View style={ws.metaWrap}>
          <Text style={ws.metaTitle} numberOfLines={2}>{displayTitle}</Text>
          {!!episodeLabel && <Text style={ws.metaEpisode}>{episodeLabel}</Text>}
          <View style={ws.metaRow}>
            <View style={[ws.formatBadge, activeStream.type === 'mp4' ? ws.formatBadgeMp4 : ws.formatBadgeHls]}>
              <Text style={[ws.formatBadgeText, activeStream.type === 'mp4' ? ws.formatBadgeTextMp4 : ws.formatBadgeTextHls]}>
                {activeStream.type === 'mp4' ? 'MP4 · Offline Ready' : 'HLS Stream'}
              </Text>
            </View>
            <Text style={ws.metaServer}>via {activeStream.serverName}</Text>
          </View>
        </View>
        <View style={ws.divider} />
        <View style={ws.streamInfoWrap}>
          <Text style={ws.streamInfoLabel}>Stream Info</Text>
          <Text style={ws.streamInfoUrl} numberOfLines={2}>{activeStream.url}</Text>
        </View>
      </ScrollView>
    );
  }

  // ---------------------------------------------------------------------------
  // Root render
  // ---------------------------------------------------------------------------

  return (
    <>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerStyle: { backgroundColor: '#09090b' },
          headerTintColor: '#ffffff',
          headerTitleStyle: { fontSize: 14 },
        }}
      />
      <View style={ws.root}>
        {loadState === 'loading' && renderLoading()}
        {loadState === 'error' && renderError()}
        {loadState === 'success' && renderSuccess()}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles (StyleSheet guarantees web + native parity)
// ---------------------------------------------------------------------------
const ws = StyleSheet.create({
  root:               { flex: 1, backgroundColor: '#000' },
  centered:           { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', paddingHorizontal: 32, gap: 16 },
  statusText:         { color: '#a1a1aa', fontSize: 13 },
  errorIcon:          { width: 64, height: 64, borderRadius: 32, backgroundColor: '#450a0a', alignItems: 'center', justifyContent: 'center' },
  errorIconText:      { color: '#f87171', fontSize: 28 },
  errorTitle:         { color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  errorBody:          { color: '#71717a', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  retryBtn:           { marginTop: 8, backgroundColor: '#dc2626', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 100 },
  retryBtnText:       { color: '#fff', fontWeight: '600', fontSize: 14 },
  backBtn:            { marginTop: 4 },
  backBtnText:        { color: '#52525b', fontSize: 13 },
  serverPickerWrap:   { marginTop: 16, paddingHorizontal: 16 },
  serverPickerLabel:  { color: '#a1a1aa', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 },
  serverChip:         { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, borderWidth: 1, borderColor: '#3f3f46', backgroundColor: '#18181b' },
  serverChipActive:   { borderColor: '#ef4444', backgroundColor: '#450a0a' },
  serverChipName:     { color: '#a1a1aa', fontSize: 13 },
  serverChipNameActive: { color: '#fff', fontWeight: '600' },
  serverChipQuality:  { color: '#52525b', fontSize: 11 },
  typeBadge:          { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  typeBadgeMp4:       { backgroundColor: '#052e16' },
  typeBadgeHls:       { backgroundColor: '#0c1a4e' },
  typeBadgeText:      { fontSize: 10, fontWeight: '700' },
  typeBadgeTextMp4:   { color: '#6ee7b7' },
  typeBadgeTextHls:   { color: '#93c5fd' },
  successScroll:      { flex: 1, backgroundColor: '#000' },
  successContent:     { paddingBottom: 48 },
  metaWrap:           { marginTop: 20, paddingHorizontal: 16, gap: 4 },
  metaTitle:          { color: '#fff', fontSize: 20, fontWeight: '700' },
  metaEpisode:        { color: '#71717a', fontSize: 13 },
  metaRow:            { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  formatBadge:        { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  formatBadgeMp4:     { backgroundColor: '#052e16' },
  formatBadgeHls:     { backgroundColor: '#0c1a4e' },
  formatBadgeText:    { fontSize: 11, fontWeight: '600' },
  formatBadgeTextMp4: { color: '#6ee7b7' },
  formatBadgeTextHls: { color: '#93c5fd' },
  metaServer:         { color: '#52525b', fontSize: 11 },
  divider:            { height: 1, backgroundColor: '#27272a', marginHorizontal: 16, marginTop: 20 },
  streamInfoWrap:     { marginTop: 14, paddingHorizontal: 16, gap: 6 },
  streamInfoLabel:    { color: '#71717a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5 },
  streamInfoUrl:      { color: '#a1a1aa', fontSize: 11, fontFamily: 'monospace' },
});
