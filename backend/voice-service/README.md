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
- `LOG_LEVEL` (default: `INFO`)

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
