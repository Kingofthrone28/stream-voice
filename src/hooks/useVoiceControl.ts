import { useState, useCallback, useRef, useEffect } from 'react';
import { VoiceControlProps } from '@/types/voice';
import { SpeechRecognitionPolyfill } from '@/services/speechRecognitionPolyfill';

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
  const [error, setError] = useState<string | null>(null);
  const [currentMode, setCurrentMode] = useState<string>('detecting...');
  const speechRecognitionRef = useRef<SpeechRecognitionPolyfill | null>(null);

  /**
   * Initialize speech recognition polyfill
   */
  useEffect(() => {
    const initializeSpeechRecognition = () => {
      speechRecognitionRef.current = new SpeechRecognitionPolyfill({
        continuous: true,
        interimResults: false,
        lang: options.language || 'en-US',
        onResult: (transcript: string, confidence: number) => {
          console.log(`Speech recognized: "${transcript}" (confidence: ${confidence})`);
          onCommand(transcript.toLowerCase());
        },
        onError: (errorMessage: string) => {
          console.error('Speech recognition error:', errorMessage);
          setError(errorMessage);
          setIsListening(false);
        },
        onStart: () => {
          setIsListening(true);
          setError(null);
          console.log('Speech recognition started');
        },
        onEnd: () => {
          setIsListening(false);
          console.log('Speech recognition ended');
        }
      });

      // Update current mode after initialization
      setCurrentMode(speechRecognitionRef.current.getCurrentMode());
    };

    initializeSpeechRecognition();

    // Cleanup on unmount
    return () => {
      if (speechRecognitionRef.current?.isCurrentlyListening()) {
        speechRecognitionRef.current.stop();
      }
    };
  }, [onCommand, options.language]);

  /**
   * Start speech recognition
   */
  const startListening = useCallback(async () => {
    if (!speechRecognitionRef.current) {
      setError('Speech recognition not initialized');
      return;
    }

    if (isListening) {
      console.log('Speech recognition already active');
      return;
    }

    try {
      await speechRecognitionRef.current.start();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(`Failed to start speech recognition: ${errorMessage}`);
      console.error('Failed to start speech recognition:', err);
    }
  }, [isListening]);

  /**
   * Stop speech recognition
   */
  const stopListening = useCallback(() => {
    if (!speechRecognitionRef.current) {
      return;
    }

    try {
      speechRecognitionRef.current.stop();
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
    isListening,
    error,
    currentMode,
    startListening,
    stopListening,
    toggleListening,
  };
}; 