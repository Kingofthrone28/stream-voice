# Streaming Platform

Voice-enabled streaming player with a Next.js frontend and a FastAPI + Whisper backend for cross-browser speech recognition.

## Current Architecture

```text
Browser (Next.js/React)
  -> getUserMedia + MediaRecorder
  -> SpeechRecognitionPolyfill (server-first in VideoPlayer)
  -> SpeechRecognitionService
      -> WS /api/voice/ws?engine=whisper (preferred)
      -> POST /api/transcribe/whisper (fallback)
  <- partial/final transcript
  -> command matcher in VideoPlayer
  -> video actions (play/pause/skip/subtitles)

Backend (FastAPI)
  -> validates auth + mime + limits
  -> transcribes with faster-whisper
  -> exposes /metrics for Prometheus
```

## Tech Stack

- Frontend: Next.js 14, React 18, TypeScript, Tailwind CSS.
- Voice client: MediaRecorder, WebSocket, HTTP multipart fallback.
- Backend: FastAPI, Uvicorn, faster-whisper, prometheus-client.
- Monitoring: Prometheus + Grafana via Docker Compose.

## Voice Commands

- `play`, `resume`
- `pause`, `stop`
- `skip intro`
- `turn on subtitles`, `subtitles on`
- `turn off subtitles`, `subtitles off`

## Environment

Root `.env.local`:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_VOICE_API_KEY=your-shared-key
VOICE_API_KEY=your-shared-key
```

Optional backend tuning:

```bash
WHISPER_MODEL=base
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_LANGUAGE=en
WHISPER_VAD_FILTER=false
```

## Local Run

Frontend:

```bash
npm install
npm run dev
```

Backend:

```bash
cd backend/voice-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Monitoring:

```bash
cd monitoring
docker compose up -d
```

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`

## Backend Endpoints

- `GET /health`
- `GET /metrics`
- `GET /metrics/json`
- `POST /api/transcribe/{engine}` (`engine=whisper`)
- `WS /api/voice/ws?engine=whisper`
