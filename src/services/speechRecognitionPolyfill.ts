/**
 * Speech Recognition Polyfill
 * Provides cross-browser speech recognition support using multiple fallback strategies
 */

import { SpeechRecognitionService, TranscriptEventType } from './speechRecognition';
const VOICE_TRACE = process.env.NEXT_PUBLIC_VOICE_TRACE === 'true';

const voiceTrace = (event: string, data?: Record<string, unknown>) => {
  if (!VOICE_TRACE) return;
  console.log(`[VOICE][Polyfill] ${event}`, data || {});
};

export interface SpeechRecognitionPolyfillOptions {
  mode?: 'auto' | 'browser' | 'server';
  engine?: 'whisper' | 'google';
  continuous?: boolean;
  interimResults?: boolean;
  lang?: string;
  onResult?: (transcript: string, confidence: number, eventType: TranscriptEventType) => void;
  onError?: (error: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

export class SpeechRecognitionPolyfill {
  private options: SpeechRecognitionPolyfillOptions;
  private recognition: any = null;
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private isListening = false;
  private isStarting = false;
  private streamSessionId = 0;
  private streamPromise: Promise<void> | null = null;
  private fallbackMode: 'native' | 'server' = 'server';

  constructor(options: SpeechRecognitionPolyfillOptions = {}) {
    this.options = {
      mode: 'auto',
      engine: 'whisper',
      continuous: true,
      interimResults: false,
      lang: 'en-US',
      ...options
    };
    
    this.detectBestMode();
  }

  /**
   * Detect the best speech recognition mode for the current browser
   */
  private detectBestMode(): void {
    if (this.options.mode === 'server') {
      this.fallbackMode = 'server';
      console.log('Using server-side speech recognition (forced)');
      return;
    }

    if (this.options.mode === 'browser') {
      if (this.hasNativeSupport()) {
        this.fallbackMode = 'native';
        console.log('Using native Web Speech API (forced)');
      } else {
        this.fallbackMode = 'server';
        console.log('Native Web Speech API unavailable, using server-side speech recognition');
      }
      return;
    }

    // Check for native Web Speech API support
    if (this.hasNativeSupport()) {
      this.fallbackMode = 'native';
      console.log('Using native Web Speech API');
      return;
    }

    // Check if we can use server-side processing
    if (this.hasMediaRecorderSupport()) {
      this.fallbackMode = 'server';
      console.log('Using server-side speech recognition');
      return;
    }

    // Fallback to server mode; start() will produce a capability error if capture is unsupported.
    this.fallbackMode = 'server';
    console.log('Defaulting to server-side speech recognition');
  }

  /**
   * Check if browser has native Web Speech API support
   */
  private hasNativeSupport(): boolean {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /**
   * Check if browser supports MediaRecorder for server-side processing
   */
  private hasMediaRecorderSupport(): boolean {
    return !!(navigator.mediaDevices && 
             typeof navigator.mediaDevices.getUserMedia === 'function' && 
             'MediaRecorder' in window);
  }

  private getSupportedMediaRecorderMimeType(): string | undefined {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return undefined;
    }

    const userAgent = navigator.userAgent.toLowerCase();
    const isChromium = userAgent.includes('chrome') || userAgent.includes('edg') || userAgent.includes('opr');

    const preferredTypes = isChromium
      ? ['audio/webm;codecs=opus', 'audio/webm']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];

    return preferredTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
  }

  /**
   * Start speech recognition
   */
  async start(): Promise<void> {
    if (this.isListening || this.isStarting) return;
    this.isStarting = true;
    voiceTrace('start.requested', { fallbackMode: this.fallbackMode });

    try {
      switch (this.fallbackMode) {
        case 'native':
          await this.startNativeRecognition();
          break;
        case 'server':
          if (!this.hasMediaRecorderSupport()) {
            throw new Error('Microphone capture not supported in this browser.');
          }
          await this.startServerRecognition();
          this.isListening = true;
          this.options.onStart?.();
          voiceTrace('start.success', { fallbackMode: this.fallbackMode });
          break;
      }
    } catch (error) {
      voiceTrace('start.failed', { error: String(error) });
      this.options.onError?.(`Failed to start speech recognition: ${error}`);
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Stop speech recognition
   */
  stop(): void {
    if (!this.isListening) return;
    voiceTrace('stop.requested', { fallbackMode: this.fallbackMode });

    try {
      switch (this.fallbackMode) {
        case 'native':
          this.recognition?.stop();
          break;
        case 'server':
          if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
          }
          this.stopAllMediaTracks();
          this.isListening = false;
          this.options.onEnd?.();
          voiceTrace('stop.success', { fallbackMode: this.fallbackMode });
          break;
      }
    } catch (error) {
      voiceTrace('stop.failed', { error: String(error) });
      this.options.onError?.(`Failed to stop speech recognition: ${error}`);
    }
  }

  /**
   * Start native Web Speech API recognition
   */
  private async startNativeRecognition(): Promise<void> {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();

    this.recognition.continuous = this.options.continuous;
    this.recognition.interimResults = this.options.interimResults;
    this.recognition.lang = this.options.lang;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.options.onStart?.();
    };

    this.recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1];
      const transcript = result[0].transcript;
      const confidence = result[0].confidence || 1.0;
      this.options.onResult?.(transcript, confidence, 'final');
    };

    this.recognition.onerror = (event: any) => {
      const error = String(event.error || 'unknown');
      this.options.onError?.(`Speech recognition error: ${error}`);
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        this.isListening = false;
        this.options.onEnd?.();
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.options.onEnd?.();
    };

    this.recognition.start();
  }

  /**
   * Start server-side speech recognition
   */
  private async startServerRecognition(): Promise<void> {
    // Ensure old recorder state cannot leak into a new listening session.
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.stopAllMediaTracks();

    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceTrace('server.mic.granted');

    const mimeType = this.getSupportedMediaRecorderMimeType();
    this.mediaRecorder = mimeType
      ? new MediaRecorder(this.mediaStream, { mimeType })
      : new MediaRecorder(this.mediaStream);

    const audioTrack = this.mediaStream.getAudioTracks()[0];
    console.log('Voice recorder initialized', {
      mimeType: this.mediaRecorder.mimeType,
      recorderState: this.mediaRecorder.state,
      trackReadyState: audioTrack?.readyState || 'missing-track'
    });

    const sessionId = ++this.streamSessionId;
    voiceTrace('server.stream.start', { sessionId, engine: this.options.engine || 'whisper' });
    this.streamPromise = SpeechRecognitionService.streamAudioToText(
      this.mediaRecorder,
      (event) => {
        this.options.onResult?.(event.text, event.confidence || 0, event.eventType);
      },
      this.options.engine || 'whisper'
    )
      .catch((error) => {
        if (sessionId !== this.streamSessionId) return;
        this.options.onError?.(`Server speech recognition error: ${error}`);
        this.stop();
      })
      .finally(() => {
        if (sessionId === this.streamSessionId) {
          this.streamPromise = null;
        }
      });
  }

  private stopAllMediaTracks(): void {
    this.streamSessionId += 1;
    this.streamPromise = null;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    this.mediaRecorder = null;
  }

  /**
   * Get current recognition mode
   */
  getCurrentMode(): string {
    return this.fallbackMode;
  }

  /**
   * Check if currently listening
   */
  isCurrentlyListening(): boolean {
    return this.isListening;
  }
}
