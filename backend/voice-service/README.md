# Voice Service

FastAPI backend for browser-agnostic speech transcription using Whisper.

## Endpoints
- `GET /health`
- `GET /metrics` (Prometheus exposition format)
- `GET /metrics/json` (debug JSON snapshot)
- `POST /api/transcribe/{engine}` (currently `engine=whisper` only)
- `GET /api/voice/ws?engine=whisper` (WebSocket streaming)

## Run Locally
```bash
cd backend/voice-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

`WS_PIPELINE_MODE=hybrid` requires an ffmpeg binary for chunk decode.
Supported sources:
- System `ffmpeg` on `PATH`
- Python package `imageio-ffmpeg` (including a local install under `backend/voice-service/.deps`)

## Environment Variables
- `WHISPER_MODEL` (default: `base`)
- `WHISPER_DEVICE` (default: `cpu`)
- `WHISPER_COMPUTE_TYPE` (default: `int8`)
- `WHISPER_LANGUAGE` (default: `en`)
- `WHISPER_VAD_FILTER` (default: `false`)
- `CORS_ALLOW_ORIGINS` (default: `*`, comma-separated)
- `VOICE_API_KEY` (optional, enables auth enforcement for HTTP/WS)
- `MAX_AUDIO_BYTES` (default: `2000000`)
- `ALLOWED_AUDIO_MIME_TYPES` (comma-separated list)
- `HTTP_RATE_LIMIT_WINDOW_SEC` (default: `60`)
- `HTTP_RATE_LIMIT_MAX` (default: `120`)
- `WS_RATE_LIMIT_WINDOW_SEC` (default: `10`)
- `WS_RATE_LIMIT_MAX` (default: `40`)
- `WS_MAX_SESSION_SECONDS` (default: `300`)
- `WS_MAX_CHUNKS` (default: `120`)
- `WS_PARTIAL_EVERY_CHUNKS` (default: `3`)
- `MAX_CONCURRENT_WS` (default: `20`)
- `WS_PIPELINE_MODE` (default: `hybrid`, options: `hybrid|legacy`)
- `WS_AUDIO_SAMPLE_RATE` (default: `16000`)
- `WS_PARTIAL_WINDOW_MS` (default: `2200`)
- `WS_OVERLAP_MS` (default: `400`)
- `WS_ENABLE_NS` (default: `true`)
- `WS_NS_ATTENUATION` (default: `0.2`)
- `WS_VAD_START_RMS` (default: `0.015`)
- `WS_VAD_END_RMS` (default: `0.010`)
- `WS_VAD_HANGOVER_CHUNKS` (default: `2`)
- `WS_PARTIAL_BEAM_SIZE` (default: `1`)
- `WS_FINAL_BEAM_SIZE` (default: `5`)
- `WS_FINAL_VAD_FILTER` (default: `true`)
- `WS_TUNING_WINDOW_SESSIONS` (default: `100`)
- `WS_TUNING_REPORT_EVERY_SESSIONS` (default: `20`)
- `WS_TARGET_PARTIAL_LATENCY_MS` (default: `900`)
- `WS_TARGET_FINAL_LATENCY_MS` (default: `1700`)
- `WS_TARGET_DIVERGENCE_RATIO` (default: `0.40`)
- `LOG_LEVEL` (default: `INFO`)

## Streaming Pipeline Modes
- `legacy`: existing per-chunk transcription behavior.
- `hybrid`: noise-suppressed PCM decode, hybrid VAD gating, overlap-aware partial windowing, and two-pass finalize.

`hybrid` emits:
- Fast `partial_transcript` from a rolling overlap window (`beam_size=1` by default).
- Higher-quality `final_transcript` at end-of-utterance or `stop` (`beam_size=5` + optional VAD filter).

## Phase B Metrics and Tuning Traces
Additional Prometheus metrics:
- `voice_ws_decode_fallback_total{reason=...}`
- `voice_ws_partial_latency_ms` (histogram)
- `voice_ws_final_latency_ms` (histogram)
- `voice_ws_partial_final_divergence_ratio` (histogram)

`session_summary` now includes:
- `partialLatencyMsMedian`
- `finalLatencyMsMedian`
- `partialFinalDivergenceMedian`
- `decodeFallbacks`

Every `WS_TUNING_REPORT_EVERY_SESSIONS`, backend logs a `voice_tuning_window` recommendation line based on staging traces and current targets.

## Frontend Integration
Set:
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Optional for secured dev mode:
```bash
NEXT_PUBLIC_VOICE_API_KEY=your-shared-dev-key
```

The existing frontend service calls:
`POST {NEXT_PUBLIC_API_URL}/api/transcribe/whisper`

For streaming mode, frontend opens:
`ws://localhost:8000/api/voice/ws?engine=whisper`

When `NEXT_PUBLIC_VOICE_API_KEY` is set, the frontend sends:
- HTTP: `x-api-key` header
- WS: `token` query param

## Prometheus + Grafana
From repo root:
```bash
cd monitoring
docker compose up -d
```

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001` (`admin` / `admin`)
