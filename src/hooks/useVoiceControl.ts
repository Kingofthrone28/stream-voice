import { useState, useCallback, useRef, useEffect } from 'react';
import { VoiceControlProps } from '@/types/voice';
import { SpeechRecognitionPolyfill } from '@/services/speechRecognitionPolyfill';

// Confidence threshold for commands (0-1). Set to 0 to accept all.
const COMMAND_CONFIDENCE_MIN = Number(process.env.NEXT_PUBLIC_COMMAND_CONFIDENCE_MIN || '0');
// Wake phrase is DISABLED by default for simpler UX. Set to 'true' to require wake phrase.
const ENABLE_WAKE_PHRASE = process.env.NEXT_PUBLIC_ENABLE_WAKE_PHRASE === 'true';
const WAKE_PHRASE_WINDOW_MS = Number(process.env.NEXT_PUBLIC_WAKE_WINDOW_MS || '5000');
const WAKE_PHRASE = (process.env.NEXT_PUBLIC_WAKE_PHRASE || 'hey stream').toLowerCase();
const WAKE_ALIASES = (process.env.NEXT_PUBLIC_WAKE_ALIASES || 'ok stream,okay stream')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const WAKE_PHRASES = [WAKE_PHRASE, ...WAKE_ALIASES];
const VOICE_DEBUG = process.env.NEXT_PUBLIC_VOICE_TRACE === 'true';

/**
 * Configuration options for voice control
 */
interface VoiceControlOptions {
  /** Recognition mode: 'auto' for automatic detection, 'browser' for Web Speech API, 'server' for backend API */
  mode?: 'auto' | 'browser' | 'server';
  /** Speech recognition engine to use when in server mode */
  engine?: 'whisper' | 'google';
  /** Language for speech recognition */
  language?: string;
}

export type VoicePipelineState = 'idle' | 'connecting' | 'ready' | 'listening' | 'error';

/**
 * Custom hook for voice control functionality with cross-browser support
 * Automatically detects the best speech recognition method available
 * 
 * @param props - Voice control configuration props
 * @param options - Additional options for recognition mode and engine
 * @returns Object containing voice control state and methods
 * 
 * @example
 * ```tsx
 * const { isListening, error, startListening, stopListening, currentMode } = useVoiceControl(
 *   { onCommand: handleCommand },
 *   { mode: 'auto', language: 'en-US' }
 * );
 * ```
 */
export const useVoiceControl = (
  { onCommand }: VoiceControlProps,
  options: VoiceControlOptions = { mode: 'auto' }
) => {
  const [isListening, setIsListening] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentMode, setCurrentMode] = useState<string>('detecting...');
  const [pipelineState, setPipelineState] = useState<VoicePipelineState>('idle');
  const [wakeArmed, setWakeArmed] = useState(false);
  const speechRecognitionRef = useRef<SpeechRecognitionPolyfill | null>(null);
  const lastCommandRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const startPromiseRef = useRef<Promise<boolean> | null>(null);
  const wakeArmedUntilRef = useRef<number>(0);
  const dispatchCommand = useCallback((command: string, confidence: number): void => {
    const now = Date.now();
    // Deduplicate commands within 1.5s window
    const isDuplicate = (
      command === lastCommandRef.current.text &&
      now - lastCommandRef.current.at < 1500
    );
    if (isDuplicate) {
      if (VOICE_DEBUG) console.log(`[VOICE] Duplicate skipped: "${command}"`);
      return;
    }
    lastCommandRef.current = { text: command, at: now };
    console.log(`[VOICE] Command dispatched: "${command}" (confidence: ${confidence.toFixed(2)})`);
    onCommand(command);
  }, [onCommand]);

  /**
   * Initialize speech recognition polyfill
   */
  useEffect(() => {
    const initializeSpeechRecognition = () => {
      speechRecognitionRef.current = new SpeechRecognitionPolyfill({
        mode: options.mode || 'auto',
        engine: options.engine || 'whisper',
        continuous: true,
        interimResults: false,
        lang: options.language || 'en-US',
        onResult: (transcript: string, confidence: number, eventType) => {
          // Normalize: lowercase, remove punctuation, collapse whitespace
          const normalized = transcript.trim().toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
          if (!normalized) return;

          if (VOICE_DEBUG) {
            console.log(`[VOICE] Received: "${normalized}" (confidence: ${confidence.toFixed(2)}, type: ${eventType})`);
          }

          // Only process final transcripts (not partials)
          if (eventType !== 'final') {
            return;
          }

          // Check confidence threshold (0 means accept all, or unknown confidence)
          if (COMMAND_CONFIDENCE_MIN > 0 && confidence > 0 && confidence < COMMAND_CONFIDENCE_MIN) {
            if (VOICE_DEBUG) console.log(`[VOICE] Below confidence threshold: ${confidence.toFixed(2)} < ${COMMAND_CONFIDENCE_MIN}`);
            return;
          }

          const now = Date.now();

          // Wake phrase handling (only if enabled)
          if (ENABLE_WAKE_PHRASE) {
            const matchedWake = WAKE_PHRASES.find((phrase) => normalized.includes(phrase));
            
            if (matchedWake) {
              // Wake phrase detected - arm the window and extract trailing command
              wakeArmedUntilRef.current = now + WAKE_PHRASE_WINDOW_MS;
              setWakeArmed(true);
              const trailing = normalized.slice(normalized.lastIndexOf(matchedWake) + matchedWake.length).trim();
              if (trailing) {
                dispatchCommand(trailing, confidence);
                wakeArmedUntilRef.current = 0;
                setWakeArmed(false);
              }
              return;
            }

            // No wake phrase - check if we're in armed window
            if (now > wakeArmedUntilRef.current) {
              if (wakeArmed) setWakeArmed(false);
              if (VOICE_DEBUG) console.log(`[VOICE] Blocked (wake phrase required): "${normalized}"`);
              return;
            }
          }

          // Dispatch the command directly
          dispatchCommand(normalized, confidence);
          
          if (ENABLE_WAKE_PHRASE) {
            wakeArmedUntilRef.current = 0;
            setWakeArmed(false);
          }
        },
        onError: (errorMessage: string) => {
          console.error('Speech recognition error:', errorMessage);
          setError(errorMessage);
          setIsListening(false);
          setPipelineState('error');
        },
        onStart: () => {
          setIsListening(true);
          setError(null);
          setCurrentMode(speechRecognitionRef.current?.getCurrentMode() || 'unknown');
          setPipelineState('listening');
          console.log('Speech recognition started');
        },
        onEnd: () => {
          setIsListening(false);
          setPipelineState('ready');
          if (ENABLE_WAKE_PHRASE) {
            const armed = Date.now() <= wakeArmedUntilRef.current;
            setWakeArmed(armed);
          }
          console.log('Speech recognition ended');
        }
      });

      // Update current mode after initialization
      setCurrentMode(speechRecognitionRef.current.getCurrentMode());
      setIsInitialized(true);
      setPipelineState('ready');
    };

    initializeSpeechRecognition();

    // Cleanup on unmount
    return () => {
      if (speechRecognitionRef.current?.isCurrentlyListening()) {
        speechRecognitionRef.current.stop();
      }
      speechRecognitionRef.current = null;
      setIsInitialized(false);
      setPipelineState('idle');
      setWakeArmed(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.engine, options.language, options.mode]);

  /**
   * Start speech recognition
   */
  const startListening = useCallback(async (): Promise<boolean> => {
    if (startPromiseRef.current) {
      return startPromiseRef.current;
    }

    const startOperation = (async (): Promise<boolean> => {
    if (!speechRecognitionRef.current) {
      setError('Speech recognition not initialized');
      return false;
    }

    if (speechRecognitionRef.current.isCurrentlyListening()) {
      console.log('Speech recognition already active');
      return true;
    }

    try {
      setPipelineState('connecting');
      setError(null);
      await speechRecognitionRef.current.start();
      const isActive = speechRecognitionRef.current.isCurrentlyListening();
      if (!isActive) {
        setPipelineState('ready');
      }
      return isActive;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(`Failed to start speech recognition: ${errorMessage}`);
      setPipelineState('error');
      console.error('Failed to start speech recognition:', err);
      return false;
    }
    })();

    startPromiseRef.current = startOperation;
    const result = await startOperation;
    startPromiseRef.current = null;
    return result;
  }, []);

  /**
   * Stop speech recognition
   */
  const stopListening = useCallback(() => {
    if (!speechRecognitionRef.current) {
      return;
    }

    try {
      speechRecognitionRef.current.stop();
      setPipelineState('ready');
      setWakeArmed(false);
      wakeArmedUntilRef.current = 0;
    } catch (err) {
      console.error('Failed to stop speech recognition:', err);
    }
  }, []);

  /**
   * Toggle speech recognition on/off
   */
  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  return {
    isInitialized,
    isListening,
    error,
    currentMode,
    pipelineState,
    wakeArmed,
    startListening,
    stopListening,
    toggleListening,
  };
}; 
