'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useVoiceControl } from '../hooks/useVoiceControl';
import { VideoPlayerProps } from '@/types/video';
const VOICE_TRACE = process.env.NEXT_PUBLIC_VOICE_TRACE === 'true';

type VoiceCommandContext = {
  video: HTMLVideoElement;
  setIsPlaying: (playing: boolean) => void;
  setShowSubtitles: (show: boolean) => void;
};

type VoiceCommandDefinition = {
  phrases: string[];
  action: (context: VoiceCommandContext) => void;
};

/**
 * Map of voice commands to their corresponding actions
 * Includes common Whisper mishearings for robustness
 */
const VOICE_COMMANDS: Record<string, VoiceCommandDefinition> = {
  play: {
    phrases: ['play', 'resume', 'start', 'play movie', 'resume movie', 'start movie', 'plate', 'clay'],
    action: ({ video, setIsPlaying }: VoiceCommandContext) => {
      void video.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  },
  pause: {
    phrases: ['pause', 'stop', 'pause movie', 'stop movie', 'paws', 'pos', 'halls', 'cause'],
    action: ({ video, setIsPlaying }: VoiceCommandContext) => {
      video.pause();
      setIsPlaying(false);
    }
  },
  skipIntro: {
    phrases: ['skip intro', 'skip the intro', 'skip it', 'skipper', 'skip'],
    action: ({ video }: VoiceCommandContext) => {
      video.currentTime += 90;
    }
  },
  subtitlesOn: {
    phrases: [
      'turn on subtitles', 'subtitles on', 'captions on', 'turn on captions',
      'enable subtitles', 'show subtitles', 'sub titles on',
      // Common Whisper mishearings
      'sub pattles on', 'sub paddles on', 'sub battles on', 'sub tattles on',
      'subtle zon', 'subtiles on', 'suttles on', 'supples on'
    ],
    action: ({ setShowSubtitles }: VoiceCommandContext) => {
      setShowSubtitles(true);
    }
  },
  subtitlesOff: {
    phrases: [
      'turn off subtitles', 'subtitles off', 'captions off', 'turn off captions',
      'disable subtitles', 'hide subtitles', 'sub titles off',
      // Common Whisper mishearings
      'sub pattles off', 'sub paddles off', 'sub battles off', 'sub tattles off',
      'subtle zoff', 'subtiles off', 'suttles off', 'supples off',
      'sub pattles', 'sub paddles', 'sub battles' // Without "off" suffix
    ],
    action: ({ setShowSubtitles }: VoiceCommandContext) => {
      setShowSubtitles(false);
    }
  }
};

/**
 * Fuzzy match helper - checks if input contains words similar to target
 * Uses simple edit distance for short words
 */
const fuzzyMatch = (input: string, target: string): boolean => {
  // Exact match
  if (input.includes(target)) return true;
  
  // Check each word in input against target words
  const inputWords = input.split(' ');
  const targetWords = target.split(' ');
  
  let matchedWords = 0;
  for (const targetWord of targetWords) {
    for (const inputWord of inputWords) {
      if (inputWord === targetWord || 
          (inputWord.length > 3 && targetWord.length > 3 && 
           (inputWord.startsWith(targetWord.slice(0, 3)) || 
            targetWord.startsWith(inputWord.slice(0, 3))))) {
        matchedWords++;
        break;
      }
    }
  }
  
  // Match if at least half the target words are found
  return matchedWords >= Math.ceil(targetWords.length / 2);
};

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hasAutoPromptedRef = useRef(false);
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
   * Handles voice commands for video playback control
   * Uses exact matching first, then fuzzy matching as fallback
   */
  const handleCommand = useCallback((command: string) => {
    const video = videoRef.current;
    if (!video) return;

    const normalizedCommand = command
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // First pass: exact phrase matching (anywhere in command)
    for (const [key, { phrases, action }] of Object.entries(VOICE_COMMANDS)) {
      for (const phrase of phrases) {
        if (normalizedCommand.includes(phrase)) {
          if (VOICE_TRACE) {
            console.log('[VOICE][VideoPlayer] command.matched (exact)', {
              command: normalizedCommand,
              matched: key,
              phrase,
            });
          }
          action({ video, setIsPlaying, setShowSubtitles });
          return;
        }
      }
    }

    // Second pass: fuzzy matching for mishearings
    for (const [key, { phrases, action }] of Object.entries(VOICE_COMMANDS)) {
      for (const phrase of phrases) {
        if (fuzzyMatch(normalizedCommand, phrase)) {
          if (VOICE_TRACE) {
            console.log('[VOICE][VideoPlayer] command.matched (fuzzy)', {
              command: normalizedCommand,
              matched: key,
              phrase,
            });
          }
          action({ video, setIsPlaying, setShowSubtitles });
          return;
        }
      }
    }

    if (VOICE_TRACE) {
      console.log('[VOICE][VideoPlayer] command.unmatched', { command: normalizedCommand });
    }
  }, []);

  // Resolve engine safely (fallback to 'whisper' if env var is not present)
  const selectedEngine: 'google' | 'whisper' =
    (typeof process !== 'undefined' &&
      process?.env?.NEXT_PUBLIC_VOICE_ENGINE === 'google')
      ? 'google'
      : 'whisper';

  const {
    isInitialized,
    isListening,
    error,
    currentMode,
    pipelineState,
    wakeArmed,
    startListening,
    stopListening
  } = useVoiceControl(
    { onCommand: handleCommand },
    { mode: 'server', language: 'en-US', engine: selectedEngine}
  );

  /**
   * Attempt a one-time auto-start after speech recognition is initialized.
   */
  const attemptAutoStart = useCallback(async () => {
    if (hasAutoPromptedRef.current || !isInitialized) return;

    const didStart = await startListening();
    if (didStart) {
      hasAutoPromptedRef.current = true;
    }
  }, [isInitialized, startListening]);

  /**
   * Attach native video element and attempt browser autoplay.
   */
  const handleVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (!node) return;

    void node.play().catch(() => {
      // Autoplay can be blocked until user interaction.
    });
  }, []);

  /**
   * Run auto-start when the video exists and voice control has initialized.
   */
  useEffect(() => {
    if (!videoRef.current || hasAutoPromptedRef.current || !isInitialized) return;
    void attemptAutoStart();
  }, [attemptAutoStart, isInitialized]);

  /**
   * Firefox and some browsers can reject mic start without a user gesture.
   * Retry once on the first interaction if auto-start did not succeed.
   */
  useEffect(() => {
    if (hasAutoPromptedRef.current || !isInitialized) return;

    const retryOnInteraction = () => {
      void attemptAutoStart();
    };

    window.addEventListener('pointerdown', retryOnInteraction, { once: true });
    window.addEventListener('keydown', retryOnInteraction, { once: true });
    window.addEventListener('touchstart', retryOnInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', retryOnInteraction);
      window.removeEventListener('keydown', retryOnInteraction);
      window.removeEventListener('touchstart', retryOnInteraction);
    };
  }, [attemptAutoStart, isInitialized]);

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
        ref={handleVideoRef}
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

      <div
        className={`absolute top-4 left-4 text-white px-4 py-2 rounded flex items-center gap-2 ${
          pipelineState === 'listening'
            ? 'bg-green-600'
            : pipelineState === 'connecting'
              ? 'bg-amber-600'
              : pipelineState === 'error'
                ? 'bg-red-600'
                : 'bg-slate-700/90'
        }`}
      >
        <div className={`w-2 h-2 bg-white rounded-full ${isListening ? 'animate-pulse' : ''}`}></div>
        Voice: {pipelineState} ({currentMode}) {wakeArmed ? '• wake armed' : '• waiting wake'}
      </div>
    </div>
  );
};
