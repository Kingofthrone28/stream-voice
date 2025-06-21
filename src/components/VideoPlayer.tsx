'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useVoiceControl } from '../hooks/useVoiceControl';
import { VideoPlayerProps } from '@/types/video';

/**
 * Map of voice commands to their corresponding actions
 */
const VOICE_COMMANDS = {
  play: {
    match: (cmd: string) => cmd.includes('play'),
    action: (video: HTMLVideoElement, setIsPlaying: (playing: boolean) => void) => {
      video.play();
      setIsPlaying(true);
    }
  },
  pause: {
    match: (cmd: string) => cmd.includes('pause'),
    action: (video: HTMLVideoElement, setIsPlaying: (playing: boolean) => void) => {
      video.pause();
      setIsPlaying(false);
    }
  },
  skipIntro: {
    match: (cmd: string) => cmd.includes('skip intro'),
    action: (video: HTMLVideoElement) => {
      video.currentTime += 90;
    }
  },
  subtitlesOn: {
    match: (cmd: string) => cmd.includes('subtitles on'),
    action: (_: HTMLVideoElement, setIsPlaying: (playing: boolean) => void, setShowSubtitles: (show: boolean) => void) => {
      setShowSubtitles(true);
    }
  },
  subtitlesOff: {
    match: (cmd: string) => cmd.includes('subtitles off'),
    action: (_: HTMLVideoElement, setIsPlaying: (playing: boolean) => void, setShowSubtitles: (show: boolean) => void) => {
      setShowSubtitles(false);
    }
  }
} as const;

/**
 * Type for video event handlers
 */
type VideoEventHandler = (event: Event) => void;

/**
 * Map of video events to their handlers
 */
type VideoEventHandlers = {
  [K in keyof HTMLMediaElementEventMap]?: (event: HTMLMediaElementEventMap[K]) => void;
};

/**
 * VideoPlayer Component
 * A feature-rich video player with voice control capabilities, custom controls,
 * and subtitle support.
 *
 * @component
 * @example
 * ```tsx
 * <VideoPlayer
 *   src="https://example.com/video.mp4"
 *   title="Example Video"
 *   poster="https://example.com/thumbnail.jpg"
 *   subtitleUrl="/subtitles/example.vtt"
 * />
 * ```
 */
export const VideoPlayer = ({ src, title, poster, subtitleUrl }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [quality, setQuality] = useState<'auto' | '1080p' | '720p' | '480p'>('auto');
  const [showSubtitles, setShowSubtitles] = useState(false);

  /**
   * Effect to control subtitle visibility
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.textTracks || video.textTracks.length === 0) return;

    // Find the English subtitles track
    const subtitlesTrack = Array.from(video.textTracks).find(
      (track) => track.label === 'English'
    );

    if (subtitlesTrack) {
      subtitlesTrack.mode = showSubtitles ? 'showing' : 'hidden';
    }
  }, [showSubtitles, subtitleUrl]);

  /**
   * Handles voice commands for video playback control using a command pattern
   * @param command - The voice command to execute
   */
  const handleCommand = (command: string) => {
    const video = videoRef.current;
    if (!video) return;

    // Find and execute the matching command
    Object.values(VOICE_COMMANDS).some(({ match, action }) => {
      if (match(command)) {
        action(video, setIsPlaying, setShowSubtitles);
        return true; // Stop iteration after first match
      }
      return false;
    });
  };

  const { isListening, error, currentMode, startListening, stopListening } = useVoiceControl(
    { onCommand: handleCommand },
    { mode: 'auto', language: 'en-US' }
  );

  /**
   * Memoized event handlers to prevent recreating on every render
   */
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  }, []);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  /**
   * Map of event names to their handlers
   * Using a constant outside of the effect to prevent recreation
   */
  const VIDEO_EVENT_HANDLERS: VideoEventHandlers = {
    timeupdate: handleTimeUpdate,
    loadedmetadata: handleLoadedMetadata,
    play: handlePlay,
    pause: handlePause,
  };

  /**
   * Set up video event listeners
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    /**
     * Helper function to manage event listeners
     * @param action - 'add' or 'remove' to determine the operation
     */
    const manageEventListeners = (action: 'addEventListener' | 'removeEventListener') => {
      Object.entries(VIDEO_EVENT_HANDLERS).forEach(([event, handler]) => {
        video[action](event, handler as VideoEventHandler);
      });
    };

    // Attach event listeners
    manageEventListeners('addEventListener');

    // Cleanup event listeners
    return () => manageEventListeners('removeEventListener');
  }, [VIDEO_EVENT_HANDLERS]); // Only re-run if handlers change

  /**
   * Formats time in seconds to MM:SS format
   *
   * @param time - Time in seconds
   * @returns Formatted time string
   */
  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative w-full aspect-video bg-black">
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="w-full h-full"
        controls
        crossOrigin="anonymous"
      >
        {subtitleUrl && (
          <track
            src={subtitleUrl}
            kind="subtitles"
            srcLang="en"
            label="English"
            default={showSubtitles}
          />
        )}
      </video>

      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-4">
            <button
              onClick={() => isPlaying ? videoRef.current?.pause() : videoRef.current?.play()}
              className="p-2 hover:bg-white/20 rounded-full transition"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '⏸️' : '▶️'}
            </button>
            <div className="text-sm">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as any)}
              className="bg-transparent border border-white/20 rounded px-2 py-1"
              aria-label="Video quality"
            >
              <option value="auto">Auto</option>
              <option value="1080p">1080p</option>
              <option value="720p">720p</option>
              <option value="480p">480p</option>
            </select>

            <button
              onClick={() => setShowSubtitles(!showSubtitles)}
              className="p-2 hover:bg-white/20 rounded-full transition"
              aria-label={showSubtitles ? 'Disable subtitles' : 'Enable subtitles'}
            >
              {showSubtitles ? 'CC active' : 'cc'}
            </button>

            <button
              onClick={() => isListening ? stopListening() : startListening()}
              className={`p-2 rounded-full transition ${
                isListening ? 'bg-red-500 hover:bg-red-600' : 'hover:bg-white/20'
              }`}
              aria-label={isListening ? 'Stop voice control' : 'Start voice control'}
              title={`Voice Recognition Mode: ${currentMode}`}
            >
              🎤
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="absolute top-4 right-4 bg-red-500 text-white px-4 py-2 rounded" role="alert">
          {error}
        </div>
      )}

      {/* Voice Recognition Status */}
      {isListening && (
        <div className="absolute top-4 left-4 bg-green-500 text-white px-4 py-2 rounded flex items-center gap-2">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
          Listening ({currentMode})
        </div>
      )}
    </div>
  );
}; 