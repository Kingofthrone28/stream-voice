/**
 * Base URL for the speech recognition API
 * Can be overridden using NEXT_PUBLIC_API_URL environment variable
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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

/**
 * Service class for handling speech recognition functionality
 */
export class SpeechRecognitionService {
  private static readonly SAMPLE_RATE = 16000; // Standard sample rate for speech recognition
  private static readonly BUFFER_SIZE = 4096;
  private static readonly CHANNELS = 1; // Mono audio

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
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');

    const response = await fetch(`${API_BASE_URL}/api/transcribe/${engine}`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to transcribe audio');
    }

    return response.json();
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
    onTranscription: (text: string) => void,
    engine: 'whisper' | 'google' = 'whisper'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const audioChunks: Blob[] = [];

      // Configure audio context with specific sample rate
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.SAMPLE_RATE,
      });

      const audioStream = mediaRecorder.stream;
      const source = audioContext.createMediaStreamSource(audioStream);

      // Create a worklet for audio processing
      const processor = audioContext.createScriptProcessor(
        this.BUFFER_SIZE,
        this.CHANNELS,
        this.CHANNELS
      );

      source.connect(processor);
      processor.connect(audioContext.destination);

      let isProcessing = false;
      processor.onaudioprocess = async (e) => {
        if (!isProcessing) {
          isProcessing = true;
          try {
            const inputData = e.inputBuffer.getChannelData(0);
            const wavBlob = await this.convertToWav(inputData, this.SAMPLE_RATE);
            audioChunks.push(wavBlob);

            // Process accumulated audio every second
            if (audioChunks.length >= 2) { // About 1 second of audio
              const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
              const result = await this.transcribeAudio(audioBlob, engine);
              if (result.text.trim()) {
                onTranscription(result.text.trim().toLowerCase());
              }
              audioChunks.length = 0; // Clear processed chunks
            }
          } catch (error) {
            console.error('Error processing audio chunk:', error);
          } finally {
            isProcessing = false;
          }
        }
      };

      // Cleanup function
      const cleanup = () => {
        processor.disconnect();
        source.disconnect();
        audioContext.close();
      };

      mediaRecorder.onstop = () => {
        cleanup();
        resolve();
      };

      mediaRecorder.onerror = (event) => {
        cleanup();
        reject(event.error);
      };

      // Start recording with specific options
      mediaRecorder.start();
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