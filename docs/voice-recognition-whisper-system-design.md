# Voice Recognition System Design (Cross-Browser, Python + Whisper)

## 1. Goal
Build reliable voice command recognition for Chrome, Firefox, Edge, and Safari by moving speech-to-text to a backend service (Python + Whisper), instead of relying on browser-native Web Speech APIs.

## 2. Scope
- In scope:
  - Real-time or near-real-time transcription for player voice commands.
  - Cross-browser mic capture in frontend.
  - Python backend transcription pipeline.
  - Command extraction and command dispatch to `VideoPlayer`.
- Out of scope:
  - Speaker diarization.
  - Full conversational assistant.
  - Long-form meeting transcription.

## 3. High-Level Architecture

### Components
1. Frontend (Next.js)
   - Captures microphone audio (`getUserMedia` + `MediaRecorder`).
   - Sends audio chunks to backend (`WebSocket` preferred, `HTTP chunk upload` fallback).
   - Receives transcript events and maps text to player commands.

2. Voice API (Python/FastAPI)
   - Authenticates session.
   - Accepts streamed audio chunks.
   - Buffers/normalizes audio to Whisper-required format.
   - Runs Whisper inference and returns partial/final transcripts.

3. Inference Layer
   - Option A (recommended first): `faster-whisper` local model.
   - Option B: OpenAI Whisper API / other managed STT provider.
   - Provider selected by environment config.

4. Observability
   - Structured logs for each session/chunk.
   - Metrics: latency, transcript confidence, error rate, active sessions.

## 4. Data Flow

### Primary flow (WebSocket streaming)
1. User opens watch page.
2. Frontend requests mic permission.
3. Frontend opens WebSocket: `/api/voice/ws?sessionId=...`.
4. Frontend streams audio chunks every ~250-1000ms.
5. Backend receives chunks, performs VAD/buffering, transcribes with Whisper.
6. Backend emits:
   - `partial_transcript`
   - `final_transcript`
   - optional `confidence`
7. Frontend receives text, runs command matching (`play`, `pause`, `subtitles on/off`, etc.).
8. `VideoPlayer` executes matched action.

### Fallback flow (HTTP upload)
1. Frontend records N-second buffer (1-2s).
2. POST `/api/voice/transcribe` with audio blob.
3. Backend responds with transcript JSON.
4. Frontend dispatches command.

## 5. API Design

### WebSocket
- `GET /api/voice/ws`
- Client -> Server messages:
  - `start` (metadata: lang, sampleRate, commandMode)
  - `audio_chunk` (binary or base64 payload, timestamp)
  - `stop`
- Server -> Client messages:
  - `ready`
  - `partial_transcript`
  - `final_transcript`
  - `error`
  - `session_summary`

### HTTP
- `POST /api/voice/transcribe`
  - multipart form-data: `file`, `lang`, `engine`
  - response: `{ text, confidence, durationMs }`

## 6. Audio and Model Settings
- Audio target format:
  - Mono, PCM16, 16kHz recommended.
- Chunk size:
  - 250-500ms for low latency, 1s for lower overhead.
- Whisper settings:
  - `task=transcribe`, `language=en`, `beam_size` tuned for latency.
- Command optimization:
  - Keep grammar narrow in frontend matcher (keyword-based plus synonyms).

## 7. Browser Support Strategy
- Chrome: native Web Speech optional fast path; server path default for consistency.
- Firefox/Edge/Safari: server transcription primary path.
- If mic denied:
  - Show actionable UI with permission instructions.
- If backend unavailable:
  - Graceful degrade to button controls; show status.

## 8. Security and Privacy
- Require authenticated session token for WS/HTTP endpoints.
- Enforce HTTPS/WSS only in production.
- Limit audio retention:
  - Default no storage; process in-memory.
  - If logging needed, redact and time-bound retention.
- Rate limit by IP/session.
- Validate file size, duration, mime type.

## 9. Reliability and Error Handling
- Client retry strategy:
  - Exponential backoff on WS disconnect.
  - Reconnect with session resume token.
- Backend safeguards:
  - Max session duration.
  - Per-session memory caps.
  - Timeout on stalled streams.
- Error classes:
  - Permission denied
  - Device unavailable
  - Network timeout
  - Inference overload
  - Unsupported codec

## 10. Performance Targets (Initial)
- End-to-end command latency: < 1200ms P95.
- Final transcript latency: < 1800ms P95.
- Session startup (ready signal): < 500ms P95.
- Error rate: < 2% of sessions.

## 11. Deployment Model
- Backend: FastAPI container behind reverse proxy.
- Workers:
  - CPU-only for development.
  - GPU workers for production scale.
- Horizontal scaling:
  - Sticky sessions for WS.
  - Queue-based inference workers optional at higher load.

## 12. Implementation Plan (Phased)

### Phase 1: MVP (1 browser-safe path)
1. Add Python FastAPI service with `/transcribe` endpoint.
2. Rewire current frontend server mode to call this endpoint.
3. Disable `annyang` fallback path.
4. Keep command parser in frontend.
5. Validate on Chrome/Firefox/Edge.

### Phase 2: Streaming
1. Add `/voice/ws`.
2. Stream chunks from frontend.
3. Emit partial/final transcripts.
4. Add reconnect and session telemetry.

### Phase 3: Hardening
1. Add auth, rate limiting, and strict validation.
2. Add metrics/dashboard alerts.
3. Tune model and chunk parameters for latency.

## 13. Required Repo Changes (Targeted)
1. `src/services/speechRecognitionPolyfill.ts`
   - Remove `annyang` as fallback.
   - Prioritize server mode where native unavailable.
   - Add transport-aware start/stop and error mapping.
2. `src/services/speechRecognition.ts`
   - Add explicit WS client and HTTP fallback methods.
   - Normalize chunk codec handling.
3. `src/hooks/useVoiceControl.ts`
   - Expose provider state (`connecting`, `ready`, `error`).
   - Keep stable callbacks and robust retry control.
4. Backend folder (new), e.g. `backend/voice-service/`
   - FastAPI app, configs, provider adapters, tests.

## 14. Open Decisions
1. Local model (`faster-whisper`) vs managed API provider.
2. Real-time streaming from day 1 vs HTTP-only MVP first.
3. Transcript retention policy (none vs short-lived audit window).
4. GPU budget and expected concurrent sessions.

## 15. Acceptance Criteria
1. Voice commands work on Chrome, Firefox, and Edge for:
   - `play`, `pause`, `skip intro`, `subtitles on`, `subtitles off`.
2. No browser-specific speech API dependency required for non-Chrome.
3. Graceful error UI on permission/network failures.
4. P95 latency meets target in staging.
