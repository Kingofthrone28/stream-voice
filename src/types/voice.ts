/**
 * Props for components that use voice control functionality
 */
export interface VoiceControlProps {
  /** Callback function to handle recognized voice commands */
  onCommand: (command: string) => void;
}

/**
 * Web Speech API type declarations
 * These extend the global namespace to provide TypeScript support for the Web Speech API
 */
declare global {
  /**
   * Main interface for speech recognition functionality
   */
  interface SpeechRecognition extends EventTarget {
    /** Whether continuous recognition is enabled */
    continuous: boolean;
    /** Whether interim results should be returned */
    interimResults: boolean;
    /** Language for speech recognition */
    lang: string;
    /** Start speech recognition */
    start(): void;
    /** Stop speech recognition */
    stop(): void;
    /** Abort speech recognition */
    abort(): void;
    /** Handler for error events */
    onerror: (event: SpeechRecognitionErrorEvent) => void;
    /** Handler for recognition results */
    onresult: (event: SpeechRecognitionEvent) => void;
    /** Handler for end of speech */
    onend: () => void;
    /** Handler for start of speech */
    onstart: () => void;
  }

  /**
   * Constructor interface for SpeechRecognition
   */
  /* eslint-disable no-var */
  var SpeechRecognition: {
    prototype: SpeechRecognition;
    new(): SpeechRecognition;
  };
  /* eslint-enable no-var */

  /**
   * Extends Window interface to include speech recognition support
   */
  interface Window {
    /** Webkit-prefixed speech recognition for broader browser support */
    webkitSpeechRecognition: typeof SpeechRecognition;
    /** Standard speech recognition API */
    SpeechRecognition: typeof SpeechRecognition;
  }

  /**
   * Event interface for speech recognition errors
   */
  interface SpeechRecognitionErrorEvent extends Event {
    /** The type of error that occurred */
    error: string;
  }

  /**
   * Event interface for speech recognition results
   */
  interface SpeechRecognitionEvent extends Event {
    /** The results of speech recognition */
    results: {
      [index: number]: {
        [index: number]: {
          /** The recognized text */
          transcript: string;
          /** Confidence score between 0 and 1 */
          confidence: number;
        };
      };
      /** Number of results */
      length: number;
    };
  }
} 