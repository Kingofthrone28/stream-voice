/**
 * Base URL for the speech recognition API
 * Can be overridden using NEXT_PUBLIC_API_URL environment variable
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const VOICE_API_KEY = process.env.NEXT_PUBLIC_VOICE_API_KEY;
const VOICE_TRACE = process.env.NEXT_PUBLIC_VOICE_TRACE === 'true';
const FORCE_HTTP_ONLY = process.env.NEXT_PUBLIC_FORCE_HTTP_ONLY !== 'false';
/**
 * Audio chunk timeslice in milliseconds for MediaRecorder.
 * Lower values reduce latency but increase network overhead.
 * Note: WebM format requires sufficient data for proper encoding.
 * Values below 500ms may produce chunks that fail to decode.
 * Default: 500ms balances latency with reliable audio encoding.
 */
const AUDIO_TIMESLICE_MS = Number(process.env.NEXT_PUBLIC_AUDIO_TIMESLICE_MS || '500');

const voiceTrace = (event: string, data?: Record<string, unknown>) => {
  if (!VOICE_TRACE) return;
  console.log(`[VOICE][SpeechService] ${event}`, data || {});
};

// Add WebkitAudioContext type declaration
declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

/**
 * Interface representing the response from the transcription API
 */
export interface TranscriptionResponse {
  /** The transcribed text from the audio */
  text: string;
  /** Confidence score of the transcription (0-1) */
  confidence: number;
}

export type TranscriptEventType = 'partial' | 'final';

export interface TranscriptEvent {
  text: string;
  confidence: number;
  eventType: TranscriptEventType;
}

type SpeechServiceError = Error & {
  status?: number;
};

/**
 * Service class for handling speech recognition functionality
 */
export class SpeechRecognitionService {
  private static readonly SAMPLE_RATE = 16000; // Standard sample rate for speech recognition
  private static readonly BUFFER_SIZE = 4096;
  private static readonly CHANNELS = 1; // Mono audio

  private static blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Failed to encode audio chunk.'));
          return;
        }
        const base64 = result.split(',')[1];
        if (!base64) {
          reject(new Error('Invalid base64 audio chunk.'));
          return;
        }
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read audio chunk.'));
      reader.readAsDataURL(blob);
    });
  }

  private static getWebSocketUrl(engine: 'whisper' | 'google'): string {
    const baseUrl = new URL(API_BASE_URL);
    baseUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    baseUrl.pathname = '/api/voice/ws';
    baseUrl.searchParams.set('engine', engine);
    if (VOICE_API_KEY) {
      baseUrl.searchParams.set('token', VOICE_API_KEY);
    }
    return baseUrl.toString();
  }

  private static isFatalServiceError(error: unknown): boolean {
    const typed = error as SpeechServiceError;
    const status = typed?.status;
    const message = String(typed?.message || '').toLowerCase();

    if (status && [400, 401, 403, 413, 415, 429, 500, 501, 503].includes(status)) {
      return true;
    }

    return (
      message.includes('unauthorized') ||
      message.includes('too many requests') ||
      message.includes('unsupported') ||
      message.includes('faster-whisper is not installed') ||
      message.includes('not implemented')
    );
  }

  private static isRecoverableChunkDecodeError(error: unknown): boolean {
    const message = String((error as SpeechServiceError)?.message || '').toLowerCase();
    return message.includes('invalid data found when processing input');
  }

  private static getRecorderDebugInfo(mediaRecorder: MediaRecorder): Record<string, string> {
    const firstTrack = mediaRecorder.stream.getAudioTracks()[0];
    return {
      recorderState: mediaRecorder.state,
      mimeType: mediaRecorder.mimeType || 'unknown',
      trackReadyState: firstTrack?.readyState || 'missing-track',
    };
  }

  private static async startMediaRecorderWithRetry(
    mediaRecorder: MediaRecorder,
    timeslice?: number
  ): Promise<void> {
    if (mediaRecorder.state !== 'inactive') return;

    try {
      if (typeof timeslice === 'number') {
        mediaRecorder.start(timeslice);
      } else {
        mediaRecorder.start();
      }
      return;
    } catch (firstError) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (mediaRecorder.state === 'inactive') {
        try {
          if (typeof timeslice === 'number') {
            mediaRecorder.start(timeslice);
          } else {
            mediaRecorder.start();
          }
          return;
        } catch (secondError) {
          const debug = this.getRecorderDebugInfo(mediaRecorder);
          throw new Error(
            `MediaRecorder start failed after retry: ${String(secondError)} | state=${debug.recorderState} mime=${debug.mimeType} track=${debug.trackReadyState}`
          );
        }
      }

      const debug = this.getRecorderDebugInfo(mediaRecorder);
      throw new Error(
        `MediaRecorder start failed: ${String(firstError)} | state=${debug.recorderState} mime=${debug.mimeType} track=${debug.trackReadyState}`
      );
    }
  }

  private static async ensureRecorderInactive(mediaRecorder: MediaRecorder): Promise<void> {
    if (mediaRecorder.state === 'inactive') return;

    await new Promise<void>((resolve) => {
      const finish = () => {
        mediaRecorder.removeEventListener('stop', finish);
        mediaRecorder.removeEventListener('error', finish as EventListener);
        resolve();
      };

      mediaRecorder.addEventListener('stop', finish, { once: true });
      mediaRecorder.addEventListener('error', finish as EventListener, { once: true });

      try {
        mediaRecorder.stop();
      } catch {
        finish();
      }
    });
  }

  /**
   * Transcribe an audio blob using the specified engine
   * 
   * @param audioBlob - The audio data to transcribe
   * @param engine - The speech recognition engine to use ('whisper' or 'google')
   * @returns Promise resolving to the transcription response
   * @throws Error if transcription fails
   */
  static async transcribeAudio(
    audioBlob: Blob,
    engine: 'whisper' | 'google' = 'whisper'
  ): Promise<TranscriptionResponse> {
    voiceTrace('http.transcribe.begin', {
      engine,
      size: audioBlob.size,
      type: audioBlob.type || 'unknown',
    });

    const formData = new FormData();
    const fileName = (() => {
      if (audioBlob.type.includes('webm')) return 'audio.webm';
      if (audioBlob.type.includes('ogg')) return 'audio.ogg';
      if (audioBlob.type.includes('mpeg')) return 'audio.mp3';
      if (audioBlob.type.includes('mp4')) return 'audio.m4a';
      return 'audio.wav';
    })();
    formData.append('file', audioBlob, fileName);

    const headers: HeadersInit = {};
    if (VOICE_API_KEY) {
      headers['x-api-key'] = VOICE_API_KEY;
    }

    const response = await fetch(`${API_BASE_URL}/api/transcribe/${engine}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      let detail = 'Failed to transcribe audio';
      try {
        const error = await response.json();
        detail = error.detail || detail;
      } catch {
        // Keep default detail when response is not JSON.
      }
      const serviceError: SpeechServiceError = new Error(detail);
      serviceError.status = response.status;
      voiceTrace('http.transcribe.error', { status: response.status, detail });
      throw serviceError;
    }

    const parsed = await response.json();
    voiceTrace('http.transcribe.ok', {
      textLength: String(parsed?.text || '').length,
      confidence: Number(parsed?.confidence ?? 0),
    });
    return parsed;
  }

  /**
   * Stream audio to text using a MediaRecorder instance
   * Continuously captures audio and sends it for transcription
   * 
   * @param mediaRecorder - The MediaRecorder instance to use for recording
   * @param onTranscription - Callback function to handle transcribed text
   * @param engine - The speech recognition engine to use ('whisper' or 'google')
   * @returns Promise that resolves when streaming ends
   * @throws Error if streaming or transcription fails
   */
  static async streamAudioToText(
    mediaRecorder: MediaRecorder,
    onTranscription: (event: TranscriptEvent) => void,
    engine: 'whisper' | 'google' = 'whisper'
  ): Promise<void> {
    const traceId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    voiceTrace('stream.begin', {
      traceId,
      engine,
      recorderState: mediaRecorder.state,
      mimeType: mediaRecorder.mimeType || 'unknown',
    });

    if (!FORCE_HTTP_ONLY) {
      try {
        await this.streamAudioToTextWebSocket(mediaRecorder, onTranscription, engine, traceId);
        voiceTrace('stream.ws.complete', { traceId });
        return;
      } catch (error) {
        voiceTrace('stream.ws.error', {
          traceId,
          error: error instanceof Error ? error.message : String(error),
        });
        if (this.isFatalServiceError(error)) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        console.warn('WebSocket transcription unavailable, falling back to HTTP chunking.', error);
      }

      await this.ensureRecorderInactive(mediaRecorder);
      voiceTrace('stream.http.fallback', { traceId });
    } else {
      voiceTrace('stream.http.forced', { traceId });
    }

    await this.streamAudioToTextHttp(mediaRecorder, onTranscription, engine, traceId);
    voiceTrace('stream.http.complete', { traceId });
  }

  /**
   * Stream audio to text using WebSocket endpoint.
   */
  private static async streamAudioToTextWebSocket(
    mediaRecorder: MediaRecorder,
    onTranscription: (event: TranscriptEvent) => void,
    engine: 'whisper' | 'google' = 'whisper',
    traceId?: string
  ): Promise<void> {
    const wsUrl = this.getWebSocketUrl(engine);

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      let sessionClosed = false;
      let stopSent = false;
      let lastDeliveredTranscript = '';
      let chunksSent = 0;

      const cleanup = () => {
        mediaRecorder.ondataavailable = null;
        mediaRecorder.onstop = null;
        mediaRecorder.onerror = null;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
      };

      socket.onopen = () => {
        voiceTrace('ws.open', { traceId, wsUrl });
        socket.send(JSON.stringify({ type: 'start' }));
        void this.startMediaRecorderWithRetry(mediaRecorder, AUDIO_TIMESLICE_MS).catch((error) => {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      };

      mediaRecorder.ondataavailable = async (event) => {
        if (!event.data || event.data.size === 0 || socket.readyState !== WebSocket.OPEN) return;
        try {
          const payload = await this.blobToBase64(event.data);
          chunksSent += 1;
          if (chunksSent === 1 || chunksSent % 10 === 0) {
            voiceTrace('ws.chunk.sent', {
              traceId,
              chunksSent,
              size: event.data.size,
              type: event.data.type || 'audio/webm',
            });
          }
          socket.send(JSON.stringify({
            type: 'audio_chunk',
            payload,
            mimeType: event.data.type || 'audio/webm'
          }));
        } catch (error) {
          reject(error);
        }
      };

      mediaRecorder.onstop = () => {
        voiceTrace('ws.media.stop', { traceId, socketState: socket.readyState });
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'stop' }));
          stopSent = true;
          return;
        }
        cleanup();
        resolve();
      };

      mediaRecorder.onerror = (event) => {
        cleanup();
        reject(event.error);
      };

      socket.onmessage = (event) => {
        let message: any;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message.type === 'partial_transcript' || message.type === 'final_transcript') {
          const text = String(message.text || '').trim().toLowerCase();
          voiceTrace('ws.transcript', {
            traceId,
            type: message.type,
            textLength: text.length,
          });
          if (text && text !== lastDeliveredTranscript) {
            lastDeliveredTranscript = text;
            onTranscription({
              text,
              confidence: Number(message.confidence ?? 0),
              eventType: message.type === 'final_transcript' ? 'final' : 'partial',
            });
          }
          return;
        }

        if (message.type === 'session_summary') {
          voiceTrace('ws.session.summary', { traceId, chunksSent });
          sessionClosed = true;
          cleanup();
          resolve();
          return;
        }

        if (message.type === 'error') {
          voiceTrace('ws.server.error', { traceId, message: String(message.message || '') });
          cleanup();
          reject(new Error(String(message.message || 'WebSocket transcription error')));
        }
      };

      socket.onerror = () => {
        voiceTrace('ws.error.event', { traceId });
        cleanup();
        reject(new Error('WebSocket connection failed'));
      };

      socket.onclose = () => {
        voiceTrace('ws.closed', {
          traceId,
          sessionClosed,
          stopSent,
          mediaState: mediaRecorder.state,
        });
        if (sessionClosed) return;
        if (!stopSent && mediaRecorder.state !== 'inactive') {
          cleanup();
          reject(new Error('WebSocket closed before recording completed'));
          return;
        }
        cleanup();
        resolve();
      };
    });
  }

  /**
   * Fallback stream method using HTTP transcription calls.
   */
  private static async streamAudioToTextHttp(
    mediaRecorder: MediaRecorder,
    onTranscription: (event: TranscriptEvent) => void,
    engine: 'whisper' | 'google' = 'whisper',
    traceId?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let hasFatalError = false;
      let uploads = 0;
      let processing = false;
      let initChunk: Blob | null = null;
      const recentChunks: Blob[] = [];

      const processChunk = async (chunk: Blob) => {
        if (processing || hasFatalError || chunk.size === 0) return;
        // Minimum chunk size to avoid sending incomplete audio data
        // WebM headers + minimal audio data typically need at least 5KB
        if (chunk.size < 5000) {
          voiceTrace('http.chunk.skipped', { traceId, size: chunk.size, reason: 'too_small' });
          return;
        }
        processing = true;
        try {
          uploads += 1;
          voiceTrace('http.upload.dispatch', {
            traceId,
            uploads,
            size: chunk.size,
            type: chunk.type || 'audio/webm',
          });
          const result = await this.transcribeAudio(chunk, engine);
          const normalized = result.text.trim().toLowerCase();
          if (normalized) {
            voiceTrace('http.transcript.dispatch', {
              traceId,
              uploads,
              textLength: normalized.length,
            });
            onTranscription({
              text: normalized,
              confidence: result.confidence,
              eventType: 'final',
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // Silently handle recoverable decode errors (invalid data, tuple index, etc.)
          const isDecodeError = this.isRecoverableChunkDecodeError(error) ||
            errorMessage.includes('tuple index') ||
            errorMessage.includes('Invalid data');
          if (isDecodeError) {
            voiceTrace('http.chunk.decode_error', { traceId, uploads, error: errorMessage });
            processing = false;
            return;
          }
          console.error('Error processing audio chunk:', error);
          voiceTrace('http.stream.error', {
            traceId,
            error: errorMessage,
          });
          if (this.isFatalServiceError(error) && !hasFatalError) {
            hasFatalError = true;
            if (mediaRecorder.state !== 'inactive') {
              try {
                mediaRecorder.stop();
              } catch {
                // no-op
              }
            }
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        } finally {
          processing = false;
        }
      };

      mediaRecorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        if (!initChunk) {
          initChunk = event.data;
          // Don't process init chunk alone - wait for more data
          return;
        } else {
          recentChunks.push(event.data);
          // Keep more chunks (4 instead of 2) for better audio context
          if (recentChunks.length > 4) {
            recentChunks.shift();
          }
        }
        // Only process after we have at least 2 chunks beyond init
        if (recentChunks.length < 2) return;
        const windowChunks = [initChunk, ...recentChunks].filter(Boolean) as Blob[];
        const bufferedBlob = new Blob(windowChunks, { type: event.data.type || 'audio/webm' });
        void processChunk(bufferedBlob);
      };

      // Cleanup function
      const cleanup = () => {
        mediaRecorder.ondataavailable = null;
        mediaRecorder.onstop = null;
        mediaRecorder.onerror = null;
      };

      mediaRecorder.onstop = () => {
        voiceTrace('http.media.stop', { traceId, uploads });
        cleanup();
        resolve();
      };

      mediaRecorder.onerror = (event) => {
        cleanup();
        reject(event.error);
      };

      if (mediaRecorder.state === 'inactive') {
        void this.startMediaRecorderWithRetry(mediaRecorder, AUDIO_TIMESLICE_MS).catch((error) => {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      }
    });
  }

  /**
   * Convert raw audio data to WAV format
   */
  private static async convertToWav(
    audioData: Float32Array,
    sampleRate: number
  ): Promise<Blob> {
    // Convert to 16-bit PCM
    const pcmData = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      const s = Math.max(-1, Math.min(1, audioData[i]));
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Create WAV header
    const buffer = new ArrayBuffer(44 + pcmData.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    // Write WAV header
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + pcmData.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono channel
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // Bits per sample
    writeString(36, 'data');
    view.setUint32(40, pcmData.length * 2, true);

    // Write audio data
    for (let i = 0; i < pcmData.length; i++) {
      view.setInt16(44 + i * 2, pcmData[i], true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }
} 
