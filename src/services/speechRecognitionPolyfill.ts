/**
 * Speech Recognition Polyfill
 * Provides cross-browser speech recognition support using multiple fallback strategies
 */

import { SpeechRecognitionService } from './speechRecognition';

export interface SpeechRecognitionPolyfillOptions {
  continuous?: boolean;
  interimResults?: boolean;
  lang?: string;
  onResult?: (transcript: string, confidence: number) => void;
  onError?: (error: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

export class SpeechRecognitionPolyfill {
  private options: SpeechRecognitionPolyfillOptions;
  private recognition: any = null;
  private mediaRecorder: MediaRecorder | null = null;
  private isListening = false;
  private fallbackMode: 'native' | 'server' | 'annyang' = 'native';

  constructor(options: SpeechRecognitionPolyfillOptions = {}) {
    this.options = {
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

    // Last resort: use annyang.js polyfill
    this.fallbackMode = 'annyang';
    console.log('Using annyang.js polyfill');
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
              navigator.mediaDevices.getUserMedia && 
              'MediaRecorder' in window);
  }

  /**
   * Start speech recognition
   */
  async start(): Promise<void> {
    if (this.isListening) return;

    try {
      switch (this.fallbackMode) {
        case 'native':
          await this.startNativeRecognition();
          break;
        case 'annyang':
          await this.startAnnyangRecognition();
          break;
      }
      this.isListening = true;
      this.options.onStart?.();
    } catch (error) {
      this.options.onError?.(`Failed to start speech recognition: ${error}`);
    }
  }

  /**
   * Stop speech recognition
   */
  stop(): void {
    if (!this.isListening) return;

    try {
      switch (this.fallbackMode) {
        case 'native':
          this.recognition?.stop();
          break;
        case 'server':
          this.mediaRecorder?.stop();
          break;
        case 'annyang':
          // @ts-ignore
          if (window.annyang) window.annyang.pause();
          break;
      }
      this.isListening = false;
      this.options.onEnd?.();
    } catch (error) {
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

    this.recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1];
      const transcript = result[0].transcript;
      const confidence = result[0].confidence || 1.0;
      this.options.onResult?.(transcript, confidence);
    };

    this.recognition.onerror = (event: any) => {
      this.options.onError?.(`Speech recognition error: ${event.error}`);
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
  // private async startServerRecognition(): Promise<void> {
  //   const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  //   this.mediaRecorder = new MediaRecorder(stream);

  //   await SpeechRecognitionService.streamAudioToText(
  //     this.mediaRecorder,
  //     (transcript) => {
  //       this.options.onResult?.(transcript, 1.0);
  //     },
  //     'whisper'
  //   );
  // }

  /**
   * Start annyang.js polyfill recognition
   */
  private async startAnnyangRecognition(): Promise<void> {
    // Load annyang.js if not already loaded
    if (!window.annyang) {
      await this.loadAnnyangScript();
    }

    if (window.annyang) {
      // @ts-ignore
      window.annyang.setLanguage(this.options.lang || 'en-US');
      
      // @ts-ignore
      window.annyang.addCallback('result', (phrases: string[]) => {
        if (phrases && phrases.length > 0) {
          this.options.onResult?.(phrases[0], 1.0);
        }
      });

      // @ts-ignore
      window.annyang.addCallback('error', (error: any) => {
        this.options.onError?.(`Annyang error: ${error}`);
      });

      // @ts-ignore
      window.annyang.start({ continuous: this.options.continuous });
    } else {
      throw new Error('Failed to load annyang.js polyfill');
    }
  }

  /**
   * Load annyang.js script dynamically
   */
  private loadAnnyangScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src*="annyang"]')) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/annyang/2.6.1/annyang.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load annyang.js'));
      document.head.appendChild(script);
    });
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

// Extend window interface for annyang
declare global {
  interface Window {
    annyang: any;
  }
} 