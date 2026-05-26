/**
 * Player.tsx
 *
 * A reusable, self-contained video player component built on `expo-video`.
 * Responsibilities:
 *   - Creates and owns its VideoPlayer instance via `useVideoPlayer`.
 *   - Handles fullscreen transitions and hooks orientation locking so the
 *     device rotates to landscape on enter and returns to portrait on exit.
 *   - Cleans up the player on unmount to release native memory and resources.
 *
 * Design decisions:
 *   - `nativeControls` is left ON for stability in Phase 3 (per directive).
 *   - The outer wrapper takes full width and preserves a 16:9 ratio using a
 *     paddingTop trick — this keeps the player anchored without a fixed height
 *     so it adapts cleanly across device sizes.
 *   - Orientation locking is performed inside `onFullscreenEnter/Exit` callbacks
 *     rather than a `useEffect` so it runs synchronously with the native event.
 */

import { useRef, useCallback, useEffect } from 'react';
import { View, Platform } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as ScreenOrientation from 'expo-screen-orientation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlayerProps {
  /** The HLS (.m3u8) or direct (.mp4) stream URL to play. */
  streamUrl: string;
  /**
   * Whether to start playback immediately once the source is ready.
   * Defaults to true.
   */
  autoPlay?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Player({ streamUrl, autoPlay = true }: PlayerProps) {
  const videoRef = useRef<VideoView>(null);

  // `useVideoPlayer` creates and owns the native player instance.
  // The setup callback runs once on mount; changing `streamUrl` later
  // is handled by a separate effect below.
  const player = useVideoPlayer(streamUrl, (p) => {
    p.loop = false;
    if (autoPlay) p.play();
  });

  // Sync the stream URL if it changes after mount (e.g. user picks a different
  // server from the stream picker). We replace the source and replay.
  useEffect(() => {
    if (!streamUrl) return;
    player.replace(streamUrl);
    if (autoPlay) player.play();
  }, [streamUrl]);

  // Release the native player when the component unmounts.
  // This frees the decoder, DRM session, and any buffered segments.
  useEffect(() => {
    return () => {
      player.release();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Orientation management
  // ---------------------------------------------------------------------------

  const handleFullscreenEnter = useCallback(async () => {
    // Orientation locking is a no-op on web.
    if (Platform.OS === 'web') return;
    try {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.LANDSCAPE,
      );
    } catch (e) {
      // Some Android skins or split-screen modes reject orientation locks.
      // Not fatal — the player will still be in fullscreen, just not rotated.
      console.warn('[Player] Could not lock orientation to landscape:', e);
    }
  }, []);

  const handleFullscreenExit = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      );
    } catch (e) {
      // Fallback: at least unlock so the OS can handle rotation naturally.
      try {
        await ScreenOrientation.unlockAsync();
      } catch {
        /* ignore */
      }
      console.warn('[Player] Could not restore portrait orientation:', e);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    // Outer shell: full width, 16:9 aspect ratio via paddingTop trick.
    // `relative` positions the absolute VideoView inside correctly.
    <View className="w-full bg-black" style={{ aspectRatio: 16 / 9 }}>
      <VideoView
        ref={videoRef}
        player={player}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        nativeControls
        contentFit="contain"
        onFullscreenEnter={handleFullscreenEnter}
        onFullscreenExit={handleFullscreenExit}
      />
    </View>
  );
}
