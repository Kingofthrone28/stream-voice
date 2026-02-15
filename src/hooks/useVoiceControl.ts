import { useState, useCallback, useRef, useEffect } from 'react';
import { VoiceControlProps } from '@/types/voice';
import { SpeechRecognitionPolyfill } from '@/services/speechRecognitionPolyfill';
const COMMAND_CONFIDENCE_MIN = Number(process.env.NEXT_PUBLIC_COMMAND_CONFIDENCE_MIN || '0.55');
const ENABLE_WAKE_PHRASE = process.env.NEXT_PUBLIC_ENABLE_WAKE_PHRASE !== 'false';
const WAKE_PHRASE_WINDOW_MS = Number(process.env.NEXT_PUBLIC_WAKE_WINDOW_MS || '5000');
const WAKE_PHRASE = (process.env.NEXT_PUBLIC_WAKE_PHRASE || 'hey stream').toLowerCase();
const WAKE_ALIASES = (process.env.NEXT_PUBLIC_WAKE_ALIASES || 'ok stream,okay stream')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const WAKE_PHRASES = [WAKE_PHRASE, ...WAKE_ALIASES];

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
        onResult: (transcript: string, confidence: number) => {
          // A confidence value of 0 from backend is treated as "unknown",
          // not low-confidence rejection.
          if (confidence > 0 && confidence < COMMAND_CONFIDENCE_MIN) {
            return;
          }
          const normalized = transcript.trim().toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
          if (!normalized) return;

          if (ENABLE_WAKE_PHRASE) {
            const now = Date.now();
            const matchedWake = WAKE_PHRASES.find((phrase) => normalized.includes(phrase));
            if (matchedWake) {
              wakeArmedUntilRef.current = now + WAKE_PHRASE_WINDOW_MS;
              setWakeArmed(true);
              const trailing = normalized
                .slice(normalized.lastIndexOf(matchedWake) + matchedWake.length)
                .trim();
              if (!trailing) {
                return;
              }
              // Use command words spoken after wake phrase in same utterance.
              if (trailing) {
                const nowForTrailing = Date.now();
                const isDuplicateTrailing = (
                  trailing === lastCommandRef.current.text &&
                  nowForTrailing - lastCommandRef.current.at < 700
                );
                if (isDuplicateTrailing) return;
                lastCommandRef.current = { text: trailing, at: nowForTrailing };
                console.log(`Speech recognized: "${trailing}" (confidence: ${confidence})`);
                onCommand(trailing);
                return;
              }
            }

            if (now > wakeArmedUntilRef.current) {
              if (wakeArmed) setWakeArmed(false);
              return;
            }
          }

          const now = Date.now();
          const isDuplicate = (
            normalized === lastCommandRef.current.text &&
            now - lastCommandRef.current.at < 700
          );
          if (isDuplicate) return;

          lastCommandRef.current = { text: normalized, at: now };
          console.log(`Speech recognized: "${normalized}" (confidence: ${confidence})`);
          onCommand(normalized);
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
  }, [onCommand, options.engine, options.language, options.mode]);

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
